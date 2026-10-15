import { requireRuntimeRoot, parseInstallArguments } from './install-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RUNTIME, VERSION } from './paths.mjs';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function readOptional(file) { try { return await fs.readFile(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

export async function installNative(mode, { runtimeRoot, buildDir = path.join(RUNTIME, 'native-ui', `V${VERSION}`), recordDir = RUNTIME } = {}) {
  if (!['install', 'remove'].includes(mode)) throw new Error('原生接入操作必须是 install 或 remove');
  runtimeRoot = requireRuntimeRoot({ runtimeRoot });
  const currentPath = path.resolve(runtimeRoot, 'ui/current.json');
  const recordPath = path.join(recordDir, 'native-ui-record.json');
  const previous = await readOptional(currentPath);
  const saved = await readOptional(recordPath);
  const record = saved ? JSON.parse(saved) : null;
  if (record && record.currentPath !== currentPath) throw new Error('本项目已管理另一份原生界面，请先撤销');
  if (record && digest(previous ?? '') !== record.installedDigest) throw new Error('原生界面指向已被其他更新修改，未覆盖；请检查接入记录');
  if (mode === 'remove') {
    if (!record) return { changed: false, installed: false };
    if (record.original !== null) await fs.writeFile(currentPath, record.original);
    else await fs.unlink(currentPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.unlink(recordPath);
    return { changed: true, installed: false, requiresReload: true };
  }
  const metadataText = await fs.readFile(path.join(buildDir, 'browser-mod-build.json'), 'utf8');
  const metadata = JSON.parse(metadataText);
  if (metadata.desktopVersion !== '0.9.0' || metadata.desktopCommit !== '270f6ba796a291cf1397b63dee5cd697cb0c9cdf') throw new Error('界面包不是已验证的 v0.9.0 原生版本');
  if (metadata.modVersion !== VERSION) throw new Error('界面包与当前 mod 版本不一致，请重新构建');
  const index = await fs.readFile(path.join(buildDir, 'index.html'), 'utf8');
  if (!index.includes('assets/')) throw new Error('原生界面包不完整');
  const original = record ? record.original : previous;
  const ui = { schemaVersion: 1, uiVersion: `0.9.1-browser-mod.${metadata.modVersion}`, appVersionFloor: '0.9.0', channel: 'local-browser-mod', path: path.resolve(buildDir), sha256: digest(metadataText), source: 'local-browser-mod', installedAt: new Date().toISOString(), previousUiVersion: original ? JSON.parse(original).uiVersion : null };
  const installed = JSON.stringify(ui, null, 2);
  await fs.mkdir(path.dirname(currentPath), { recursive: true });
  await fs.mkdir(recordDir, { recursive: true });
  await fs.writeFile(recordPath, JSON.stringify({ currentPath, original, installedDigest: digest(installed), modVersion: VERSION }, null, 2));
  if (await readOptional(currentPath) !== previous) throw new Error('界面指向同时发生变化，请重试');
  const temporary = `${currentPath}.hbm.tmp`;
  await fs.writeFile(temporary, installed);
  await fs.rename(temporary, currentPath);
  return { changed: true, installed: true, currentPath, buildDir: path.resolve(buildDir), requiresReload: true };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const { mode, options } = parseInstallArguments(process.argv.slice(2)); console.log(JSON.stringify(await installNative(mode, { runtimeRoot: requireRuntimeRoot(options) }), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
