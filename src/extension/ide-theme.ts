import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';
import * as vscode from 'vscode';
import type { IdeThemeJson } from '../core/editor-messages';

interface ThemeContribution {
  id?: string;
  label?: string;
  uiTheme?: string;
  path: string;
}

interface ThemeFileContents {
  colors: Record<string, string>;
  tokenColors: IdeThemeJson['settings'];
}

/** Read a theme JSON file, following its `include` chain (base themes). */
async function readThemeFile(filePath: string): Promise<ThemeFileContents> {
  const raw = await fs.readFile(filePath, 'utf8');
  const json = parseJsonc(raw) as {
    include?: string;
    colors?: Record<string, string>;
    tokenColors?: unknown;
  };

  const base: ThemeFileContents = json.include
    ? await readThemeFile(path.join(path.dirname(filePath), json.include))
    : { colors: {}, tokenColors: [] };

  const ownTokenColors = Array.isArray(json.tokenColors)
    ? (json.tokenColors.filter(
        (entry) => typeof entry === 'object' && entry !== null
      ) as IdeThemeJson['settings'])
    : [];

  return {
    colors: { ...base.colors, ...(json.colors ?? {}) },
    tokenColors: [...base.tokenColors, ...ownTokenColors],
  };
}

function findThemeContribution(
  themeName: string
): { extensionPath: string; theme: ThemeContribution } | undefined {
  for (const extension of vscode.extensions.all) {
    const themes = (
      extension.packageJSON as {
        contributes?: { themes?: ThemeContribution[] };
      }
    ).contributes?.themes;
    if (!themes) continue;
    const match = themes.find((t) => t.id === themeName || t.label === themeName);
    if (match) return { extensionPath: extension.extensionPath, theme: match };
  }
  return undefined;
}

/**
 * Resolve the user's active color theme to its full JSON (colors +
 * tokenColors), so code blocks in notes highlight exactly like the IDE.
 * Returns undefined when the theme can't be located; callers fall back to
 * shiki's dark-plus/light-plus.
 */
export async function resolveActiveIdeTheme(): Promise<IdeThemeJson | undefined> {
  const themeName = vscode.workspace.getConfiguration('workbench').get<string>('colorTheme');
  if (!themeName) return undefined;

  const contribution = findThemeContribution(themeName);
  if (!contribution) return undefined;

  try {
    const filePath = path.join(contribution.extensionPath, contribution.theme.path);
    const { colors, tokenColors } = await readThemeFile(filePath);

    const kind = vscode.window.activeColorTheme.kind;
    const isDark =
      kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
    const fg = colors['editor.foreground'] ?? (isDark ? '#d4d4d4' : '#333333');
    const bg = colors['editor.background'] ?? (isDark ? '#1e1e1e' : '#ffffff');

    return {
      name: themeName,
      type: isDark ? 'dark' : 'light',
      fg,
      bg,
      colors,
      settings: [{ settings: { foreground: fg, background: bg } }, ...tokenColors],
    };
  } catch (error) {
    console.error('NOAT: failed to read theme file', error);
    return undefined;
  }
}
