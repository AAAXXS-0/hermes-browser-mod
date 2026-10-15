import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RUNTIME } from '../src/paths.mjs';
import { findPnpm, NPM_CACHE } from './native-toolchain.mjs';
const exec = promisify(execFile);
const source = path.join(RUNTIME, 'native-desktop-source');
const commit = '270f6ba796a291cf1397b63dee5cd697cb0c9cdf';
const run = async (binary, args, cwd) => {
  const result = await exec(binary, args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.stdout.trim()) console.log(result.stdout.trim());
};
await fs.mkdir(RUNTIME, { recursive: true });
try { await fs.access(source); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await run('git', ['clone', '--depth', '1', '--branch', 'v0.9.0', 'https://github.com/Eynzof/Hermes-CN-Desktop.git', source]);
}
const actual = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
if (actual !== commit) throw new Error('上游源码不是已验证的 v0.9.0 commit，未安装依赖或修改源码');
let pnpm = await findPnpm();
if (!pnpm) {
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('请使用 npm run native:prepare，以便找到 npm 工具链');
  await run(process.execPath, [npmCli, 'exec', '--cache', NPM_CACHE, '--yes', '--package=pnpm@9.15.0', '--', 'pnpm', '--version']);
  pnpm = await findPnpm();
}
if (!pnpm) throw new Error('无法找到 pnpm 9.15.0');
await run(process.execPath, [pnpm, '--filter', '@hermes/web...', 'install', '--frozen-lockfile', '--ignore-scripts'], source);
console.log('固定版本原生源码和依赖已准备，下一步 npm run native:build');
