import * as path from 'node:path';

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ tolist: () => number[][] }>;

let extractorPromise: Promise<Extractor> | undefined;

/**
 * Lazily load the local embedding pipeline. The model (~25 MB) is downloaded
 * once and cached under the NOAT home so the extension and MCP server share it.
 */
function getExtractor(noatHome: string): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers');
      env.cacheDir = path.join(noatHome, '.cache', 'models');
      env.allowLocalModels = false;
      const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL, {
        device: 'cpu',
        dtype: 'q8',
      });
      return extractor as unknown as Extractor;
    })();
  }
  return extractorPromise;
}

/** True once the pipeline has been created (model downloaded + loaded). */
export function isEmbedderReady(): boolean {
  return extractorPromise !== undefined;
}

export async function embedTexts(noatHome: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor(noatHome);
  const batchSize = 16;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize).map((text) => text.slice(0, 2000));
    const output = await extractor(batch, { pooling: 'mean', normalize: true });
    vectors.push(...output.tolist());
  }
  return vectors;
}

export async function embedQuery(noatHome: string, query: string): Promise<number[]> {
  const [vector] = await embedTexts(noatHome, [query]);
  return vector ?? [];
}
