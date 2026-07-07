import * as vscode from 'vscode';

interface CursorMcpApi {
  registerServer?: (config: {
    name: string;
    server: { command: string; args: string[]; env?: Record<string, string> };
  }) => void;
  unregisterServer?: (name: string) => void;
}

/**
 * Register the bundled NOAT MCP server with Cursor so agents can access notes.
 * No-ops in plain VS Code (the `vscode.cursor` namespace only exists in Cursor);
 * there, users add the server to mcp.json manually (documented in the README).
 */
export function registerMcpServer(context: vscode.ExtensionContext, noatHome: string): void {
  const cursorApi = (vscode as unknown as { cursor?: { mcp?: CursorMcpApi } }).cursor?.mcp;
  if (!cursorApi?.registerServer) return;

  const serverPath = context.asAbsolutePath('dist/mcp-server.js');
  try {
    cursorApi.registerServer({
      name: 'noat',
      server: {
        // Run the IDE's own bundled Node (Electron in Node mode) so this works
        // even when no node binary is on PATH.
        command: process.execPath,
        args: [serverPath],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          NOAT_HOME: noatHome,
        },
      },
    });
  } catch (error) {
    console.error('NOAT: MCP server registration failed', error);
  }
}
