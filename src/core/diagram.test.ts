import { describe, expect, it } from 'vitest';
import { diagramMessages, extractMermaid } from './diagram';

describe('extractMermaid', () => {
  it('keeps a bare diagram as-is', () => {
    expect(extractMermaid('flowchart TD\n  A --> B\n')).toBe('flowchart TD\n  A --> B');
  });

  it('unwraps a code fence', () => {
    expect(extractMermaid('Here you go:\n\n```mermaid\nsequenceDiagram\n  A->>B: hi\n```\n')).toBe(
      'sequenceDiagram\n  A->>B: hi'
    );
  });

  it('drops commentary before the diagram keyword', () => {
    const reply = 'Thinking Process:\n1. Pick a type.\n\nflowchart LR\n  A --> B';
    expect(extractMermaid(reply)).toBe('flowchart LR\n  A --> B');
  });

  it('drops <think> blocks', () => {
    expect(extractMermaid('<think>hmm</think>\npie\n  "a" : 1')).toBe('pie\n  "a" : 1');
  });

  it('returns the reply unchanged when no diagram keyword shows up', () => {
    expect(extractMermaid('  I cannot do that.  ')).toBe('I cannot do that.');
  });
});

describe('diagramMessages', () => {
  it('truncates note context but always carries the request', () => {
    const [, user] = diagramMessages('login flow', 'x'.repeat(9000));
    expect(user?.content).toContain('Diagram request: login flow');
    expect(user?.content.length).toBeLessThan(4200);
  });

  it("feeds a rejected script back as the model's own turn", () => {
    const messages = diagramMessages('login flow', '', {
      code: 'flowchart TD\n  A --> ',
      error: 'Parse error on line 2',
    });
    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
    ]);
    expect(messages[2]?.content).toBe('flowchart TD\n  A --> ');
    expect(messages[3]?.content).toContain('Parse error on line 2');
  });

  it('omits the context preamble for an empty note', () => {
    const [, user] = diagramMessages('login flow', '   ');
    expect(user?.content).toBe('Diagram request: login flow');
  });
});
