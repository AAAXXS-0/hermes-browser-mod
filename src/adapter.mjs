import { resolveHermesPaths } from './install-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { ROOT, RUNTIME } from './paths.mjs';

export const ADAPTER_NAME = 'hermes-browser-mod';
const DEFAULT_HOME = resolveHermesPaths().home;

export function mcpEntry() {
  return { command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], timeout: 60, connect_timeout: 30 };
}

export async function adapterStatus(home = DEFAULT_HOME, recordDir = RUNTIME) {
  try {
    const doc = parseDocument(await fs.readFile(path.join(home, 'config.yaml'), 'utf8'));
    if (doc.errors.length) throw new Error('Hermes 配置不是有效的 YAML');
    const entry = doc.getIn(['mcp_servers', ADAPTER_NAME])?.toJSON?.();
    return { home, connected: JSON.stringify(entry) === JSON.stringify(mcpEntry()), hasEntry: !!entry, entry: entry || null };
  } catch (error) {
    if (error.code === 'ENOENT') return { home, connected: false, available: false };
    throw error;
  }
}

export async function changeAdapter(mode, home = DEFAULT_HOME, recordDir = RUNTIME) {
  if (!['connect', 'disconnect'].includes(mode)) throw new Error('适配操作必须是 connect 或 disconnect');
  const configPath = path.join(home, 'config.yaml');
  const recordPath = path.join(recordDir, 'adapter-record.json');
  const before = await fs.readFile(configPath, 'utf8');
  const doc = parseDocument(before);
  if (doc.errors.length) throw new Error('Hermes 配置存在 YAML 错误，未修改');
  const existing = doc.getIn(['mcp_servers', ADAPTER_NAME])?.toJSON?.();
  const entry = mcpEntry();
  let record = null;
  try { record = JSON.parse(await fs.readFile(recordPath, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record && path.resolve(record.configPath) !== path.resolve(configPath)) throw new Error('此项目已管理另一份 Hermes 配置，请先撤销旧接入');
  if (mode === 'connect') {
    if (JSON.stringify(existing) === JSON.stringify(entry)) return { changed: false, connected: true, home };
    if (existing) throw new Error('Hermes 已有同名 MCP 条目且内容不同，未覆盖；请检查配置');
    await fs.mkdir(recordDir, { recursive: true });
    record = { configPath, original: existing ?? null, installed: entry, createdAt: new Date().toISOString() };
    // Write restoration record first, so interrupted installation remains recoverable.
    await fs.writeFile(recordPath, JSON.stringify(record, null, 2));
    doc.setIn(['mcp_servers', ADAPTER_NAME], entry);
  } else {
    if (!record) {
      if (existing) throw new Error('没有接入记录，无法确认此条目归属，未移除');
      return { changed: false, connected: false, home };
    }
    if (existing && JSON.stringify(existing) !== JSON.stringify(record.installed)) throw new Error('接入项已被外部修改，未移除；请人工检查');
    if (record.original) doc.setIn(['mcp_servers', ADAPTER_NAME], record.original);
    else doc.deleteIn(['mcp_servers', ADAPTER_NAME]);
  }
  // Preserve unrelated keys and comments. Never restore a whole historical config.
  const latest = await fs.readFile(configPath, 'utf8');
  if (latest !== before) throw new Error('Hermes 配置在操作期间变化，请重试');
  const temporary = `${configPath}.hbm.tmp`;
  await fs.writeFile(temporary, doc.toString(), 'utf8');
  await fs.rename(temporary, configPath);
  if (mode === 'disconnect') await fs.unlink(recordPath);
  return { changed: true, connected: mode === 'connect', home, requiresReload: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode = 'status', home = DEFAULT_HOME] = process.argv.slice(2);
  try {
    console.log(JSON.stringify(mode === 'status' ? await adapterStatus(home) : await changeAdapter(mode, home), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
