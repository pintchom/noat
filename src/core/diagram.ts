/**
 * Mermaid generation against an OpenAI-compatible chat endpoint — by default
 * a local server (oMLX, LM Studio, Ollama, llama.cpp), so diagrams cost no
 * tokens and work offline. Only the diagram source travels back; rendering
 * happens in the webview, so the same script always draws the same picture.
 */

export interface DiagramLlmConfig {
  /** Base URL of the OpenAI-compatible API, e.g. "http://127.0.0.1:8000/v1". */
  baseUrl: string;
  /** Model id; empty means "whatever the server lists first". */
  model?: string;
  /** Bearer token; local servers usually need one only if configured. */
  apiKey?: string;
}

const SYSTEM_PROMPT = `You write Mermaid diagram definitions.

Rules:
- Output ONLY Mermaid source. No prose, no explanation, no markdown fences.
- Start with the diagram keyword: flowchart TD, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram, mindmap, gantt, pie, timeline, journey.
- Pick the type that fits the request; use flowchart TD when in doubt.
- Quote any label containing punctuation: A["Parse (fast path)"].
- Keep it under 20 nodes, labels short.`;

// Every diagram keyword Mermaid accepts on the first line. Used to find where
// the diagram starts when a chatty model prefixes it with commentary.
const DIAGRAM_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram-v2',
  'stateDiagram',
  'erDiagram',
  'journey',
  'gantt',
  'pie',
  'quadrantChart',
  'requirementDiagram',
  'gitGraph',
  'mindmap',
  'timeline',
  'zenuml',
  'sankey-beta',
  'xychart-beta',
  'block-beta',
  'packet-beta',
  'architecture-beta',
  'kanban',
  'radar-beta',
  'treemap',
  'C4Context',
];

const FENCE = /```(?:mermaid)?\s*\n([\s\S]*?)```/;

/** Note text sent as context; enough for a long note, short enough to stay fast. */
const MAX_CONTEXT_CHARS = 4000;

/**
 * Pull the diagram out of a model reply: unwrap a code fence, drop <think>
 * blocks and any commentary before the first diagram keyword. Returns the
 * trimmed reply unchanged when nothing looks like a diagram — the webview
 * shows Mermaid's own parse error next to the source, which says more than a
 * generic "generation failed".
 */
export function extractMermaid(raw: string): string {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
  const fenced = withoutThinking.match(FENCE)?.[1];
  const text = (fenced ?? withoutThinking).trim();
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    DIAGRAM_KEYWORDS.some((keyword) => line.trimStart().startsWith(keyword))
  );
  return start <= 0 ? text : lines.slice(start).join('\n').trim();
}

/** A script Mermaid rejected, handed back to the model to fix. */
export interface DiagramRepair {
  code: string;
  error: string;
}

/** The conversation sent to the model. Exported for tests. */
export function diagramMessages(
  prompt: string,
  context: string,
  repair?: DiagramRepair
): Array<{ role: 'system' | 'assistant' | 'user'; content: string }> {
  const trimmed = context.trim().slice(0, MAX_CONTEXT_CHARS);
  const note = trimmed.length > 0 ? `Note this diagram goes into:\n${trimmed}\n\n` : '';
  const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${note}Diagram request: ${prompt}` },
  ];
  // A rejected script goes back as the model's own turn, so the fix is a
  // normal next turn rather than a fresh attempt at the same prompt.
  if (repair) {
    messages.push(
      { role: 'assistant', content: repair.code },
      {
        role: 'user',
        content: `Mermaid rejected that with:\n${repair.error}\n\nReply with the corrected diagram only.`,
      }
    );
  }
  return messages;
}

async function callApi(
  config: DiagramLlmConfig,
  path: string,
  body?: unknown,
  timeoutMs = 180_000
): Promise<Record<string, unknown>> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `${response.status} ${response.statusText}: ${(await response.text()).slice(0, 200)}`
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

/** The configured model, or the first one the server offers. */
async function resolveModel(config: DiagramLlmConfig): Promise<string> {
  if (config.model) return config.model;
  const listed = await callApi(config, '/models', undefined, 10_000);
  const first = (listed.data as Array<{ id?: string }> | undefined)?.[0]?.id;
  if (!first) throw new Error(`no models available at ${config.baseUrl}`);
  return first;
}

/** Ask the model for a Mermaid diagram. Throws with a human-readable reason. */
export async function generateMermaid(
  config: DiagramLlmConfig,
  prompt: string,
  context: string,
  repair?: DiagramRepair
): Promise<string> {
  const completion = await callApi(config, '/chat/completions', {
    model: await resolveModel(config),
    messages: diagramMessages(prompt, context, repair),
    // Same request, same diagram — and no reasoning preamble to wade through.
    // Qwen-style servers read enable_thinking; others ignore the extra field.
    temperature: 0,
    max_tokens: 1200,
    chat_template_kwargs: { enable_thinking: false },
  });
  const choices = completion.choices as Array<{ message?: { content?: string } }> | undefined;
  const code = extractMermaid(choices?.[0]?.message?.content ?? '');
  if (!code) throw new Error('the model returned an empty diagram');
  return code;
}
