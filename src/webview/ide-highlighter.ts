import { codeBlockOptions } from '@blocknote/code-block';
import type { CodeBlockOptions } from '@blocknote/core';
import { createBundledHighlighter } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import type {
  DynamicImportLanguageRegistration,
  DynamicImportThemeRegistration,
  ThemeRegistrationAny,
} from '@shikijs/types';
import type { IdeThemeJson } from '../core/editor-messages';

// Same language set as @blocknote/code-block's bundle, but wired to a
// highlighter whose theme comes from the user's actual IDE color theme.
const bundledLanguages: Record<string, DynamicImportLanguageRegistration> = {
  c: () => import('@shikijs/langs-precompiled/c'),
  cpp: () => import('@shikijs/langs-precompiled/cpp'),
  'c++': () => import('@shikijs/langs-precompiled/cpp'),
  css: () => import('@shikijs/langs-precompiled/css'),
  glsl: () => import('@shikijs/langs-precompiled/glsl'),
  graphql: () => import('@shikijs/langs-precompiled/graphql'),
  gql: () => import('@shikijs/langs-precompiled/graphql'),
  haml: () => import('@shikijs/langs-precompiled/haml'),
  html: () => import('@shikijs/langs-precompiled/html'),
  java: () => import('@shikijs/langs-precompiled/java'),
  javascript: () => import('@shikijs/langs-precompiled/javascript'),
  js: () => import('@shikijs/langs-precompiled/javascript'),
  json: () => import('@shikijs/langs-precompiled/json'),
  jsonc: () => import('@shikijs/langs-precompiled/jsonc'),
  jsonl: () => import('@shikijs/langs-precompiled/jsonl'),
  jsx: () => import('@shikijs/langs-precompiled/jsx'),
  julia: () => import('@shikijs/langs-precompiled/julia'),
  jl: () => import('@shikijs/langs-precompiled/julia'),
  less: () => import('@shikijs/langs-precompiled/less'),
  markdown: () => import('@shikijs/langs-precompiled/markdown'),
  md: () => import('@shikijs/langs-precompiled/markdown'),
  mdx: () => import('@shikijs/langs-precompiled/mdx'),
  php: () => import('@shikijs/langs-precompiled/php'),
  postcss: () => import('@shikijs/langs-precompiled/postcss'),
  pug: () => import('@shikijs/langs-precompiled/pug'),
  jade: () => import('@shikijs/langs-precompiled/pug'),
  python: () => import('@shikijs/langs-precompiled/python'),
  py: () => import('@shikijs/langs-precompiled/python'),
  r: () => import('@shikijs/langs-precompiled/r'),
  regexp: () => import('@shikijs/langs-precompiled/regexp'),
  regex: () => import('@shikijs/langs-precompiled/regexp'),
  sass: () => import('@shikijs/langs-precompiled/sass'),
  scss: () => import('@shikijs/langs-precompiled/scss'),
  shellscript: () => import('@shikijs/langs-precompiled/shellscript'),
  bash: () => import('@shikijs/langs-precompiled/shellscript'),
  sh: () => import('@shikijs/langs-precompiled/shellscript'),
  shell: () => import('@shikijs/langs-precompiled/shellscript'),
  zsh: () => import('@shikijs/langs-precompiled/shellscript'),
  sql: () => import('@shikijs/langs-precompiled/sql'),
  svelte: () => import('@shikijs/langs-precompiled/svelte'),
  typescript: () => import('@shikijs/langs-precompiled/typescript'),
  ts: () => import('@shikijs/langs-precompiled/typescript'),
  vue: () => import('@shikijs/langs-precompiled/vue'),
  'vue-html': () => import('@shikijs/langs-precompiled/vue-html'),
  wasm: () => import('@shikijs/langs-precompiled/wasm'),
  wgsl: () => import('@shikijs/langs-precompiled/wgsl'),
  xml: () => import('@shikijs/langs-precompiled/xml'),
  yaml: () => import('@shikijs/langs-precompiled/yaml'),
  yml: () => import('@shikijs/langs-precompiled/yaml'),
  tsx: () => import('@shikijs/langs-precompiled/tsx'),
  typescriptreact: () => import('@shikijs/langs-precompiled/tsx'),
  haskell: () => import('@shikijs/langs-precompiled/haskell'),
  hs: () => import('@shikijs/langs-precompiled/haskell'),
  'c#': () => import('@shikijs/langs-precompiled/csharp'),
  csharp: () => import('@shikijs/langs-precompiled/csharp'),
  cs: () => import('@shikijs/langs-precompiled/csharp'),
  latex: () => import('@shikijs/langs-precompiled/latex'),
  lua: () => import('@shikijs/langs-precompiled/lua'),
  mermaid: () => import('@shikijs/langs-precompiled/mermaid'),
  mmd: () => import('@shikijs/langs-precompiled/mermaid'),
  ruby: () => import('@shikijs/langs-precompiled/ruby'),
  rb: () => import('@shikijs/langs-precompiled/ruby'),
  rust: () => import('@shikijs/langs-precompiled/rust'),
  rs: () => import('@shikijs/langs-precompiled/rust'),
  scala: () => import('@shikijs/langs-precompiled/scala'),
  swift: () => import('@shikijs/langs-precompiled/swift'),
  kotlin: () => import('@shikijs/langs-precompiled/kotlin'),
  kt: () => import('@shikijs/langs-precompiled/kotlin'),
  kts: () => import('@shikijs/langs-precompiled/kotlin'),
  'objective-c': () => import('@shikijs/langs-precompiled/objective-c'),
  objc: () => import('@shikijs/langs-precompiled/objective-c'),
};

function toShikiTheme(theme: IdeThemeJson): ThemeRegistrationAny {
  return {
    name: 'noat-ide',
    type: theme.type,
    fg: theme.fg,
    bg: theme.bg,
    colors: theme.colors,
    settings: theme.settings,
  };
}

/**
 * BlockNote caches its shiki highlighter and parser on globalThis; clear both
 * so a theme change actually re-highlights instead of reusing stale colors.
 */
export function clearHighlighterCache(): void {
  Reflect.deleteProperty(globalThis, Symbol.for('blocknote.shikiHighlighterPromise'));
  Reflect.deleteProperty(globalThis, Symbol.for('blocknote.shikiParser'));
}

/**
 * Code block options whose highlighter uses the user's IDE theme when we have
 * it, falling back to VS Code's default dark-plus/light-plus otherwise.
 */
export function createIdeCodeBlockOptions(
  ideTheme: IdeThemeJson | undefined,
  isDark: boolean
): CodeBlockOptions {
  const themes: Record<string, DynamicImportThemeRegistration> = ideTheme
    ? { 'noat-ide': () => Promise.resolve({ default: toShikiTheme(ideTheme) }) }
    : {
        'dark-plus': () => import('@shikijs/themes/dark-plus'),
        'light-plus': () => import('@shikijs/themes/light-plus'),
      };

  const createHighlighter = createBundledHighlighter<string, string>({
    langs: bundledLanguages,
    themes,
    engine: () => createJavaScriptRegexEngine(),
  });

  return {
    ...codeBlockOptions,
    createHighlighter: () =>
      createHighlighter({
        // The prosemirror-highlight parser uses the first loaded theme.
        themes: [ideTheme ? 'noat-ide' : isDark ? 'dark-plus' : 'light-plus'],
        langs: [],
      }),
  };
}
