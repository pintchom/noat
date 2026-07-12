import { readConfig } from '../core/config';
import { getNoatHome } from '../core/paths';

/**
 * When true, MCP tools read/write BlockNote JSON instead of markdown.
 *
 * Resolved so the toggle works in ANY MCP host, not just Cursor:
 *  1. NOAT_MCP_DIRECT_JSON env var (explicit override — e.g. a manual mcp.json)
 *  2. otherwise the persisted store config, which the IDE extension writes
 */
export function useDirectJson(): boolean {
  const env = process.env.NOAT_MCP_DIRECT_JSON;
  if (env === '1' || env === 'true') return true;
  if (env === '0' || env === 'false') return false;
  return readConfig(getNoatHome()).mcp?.useDirectJson === true;
}
