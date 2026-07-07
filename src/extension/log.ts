import * as vscode from 'vscode';

export const noatLog = vscode.window.createOutputChannel('NOAT');

export function logError(context: string, error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  noatLog.appendLine(`[${new Date().toISOString()}] ${context}: ${message}`);
}
