import fs from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME } from '../src/paths.mjs';
export const NPM_CACHE = path.resolve(process.env.HBM_NPM_CACHE || path.join(RUNTIME, 'npm-cache'));
export async function findPnpm() {
  const directory = path.join(NPM_CACHE, '_npx');
  let entries;
  try { entries = await fs.readdir(directory); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  for (const entry of entries) {
    const packageRoot = path.join(directory, entry, 'node_modules/pnpm');
    try {
      if (JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')).version === '9.15.0') return path.join(packageRoot, 'bin/pnpm.cjs');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}
