import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RUNTIME = path.resolve(process.env.HBM_RUNTIME_DIR || path.join(ROOT, '.runtime'));
export const CONNECTION = path.join(RUNTIME, 'connection.json');
export const VERSION = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
export const PORT = Number(process.env.HBM_PORT || 17371);
export const ORIGIN = `http://127.0.0.1:${PORT}`;

export async function readConnection() {
  return JSON.parse(await fs.readFile(CONNECTION, 'utf8'));
}

export async function callService(action, args = {}) {
  const connection = await readConnection();
  const response = await fetch(`${connection.origin}/api/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${connection.token}` },
    body: JSON.stringify({ action, args }),
    signal: AbortSignal.timeout(45000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
