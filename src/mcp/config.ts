/** When true, MCP tools read/write BlockNote JSON instead of markdown. */
export function useDirectJson(): boolean {
  const value = process.env.NOAT_MCP_DIRECT_JSON;
  return value === '1' || value === 'true';
}
