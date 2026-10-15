import { resolveHermesPaths } from './install-paths.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { ROOT, RUNTIME, PORT, VERSION } from './paths.mjs';

const ID = 'hermes-browser-mod';
const DEFAULT_HOME = resolveHermesPaths().home;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceFiles = ['manifest.json', 'plugin.js', 'plugin.css', 'plugin_api.py'];
async function readRecord(recordPath) { try { return JSON.parse(await fs.readFile(recordPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function writeConfig(configPath, text) { const temporary = `${configPath}.hbm-desktop.tmp`; await fs.writeFile(temporary, text); await fs.rename(temporary, configPath); }

export async function installDesktop(mode, { home = DEFAULT_HOME, recordDir = RUNTIME, node = process.execPath } = {}) {
  if (!['install', 'remove'].includes(mode)) throw new Error('桌面接入操作必须是 install 或 remove');
  const destination = path.resolve(home, 'plugins', ID);
  const configPath = path.resolve(home, 'config.yaml');
  const recordPath = path.join(recordDir, 'desktop-record.json');
  const record = await readRecord(recordPath);
  if (record && record.destination !== destination) throw new Error('已有另一目录的桌面接入记录，请先撤销');
  const before = await fs.readFile(configPath, 'utf8');
  const doc = parseDocument(before);
  if (doc.errors.length) throw new Error('Hermes 配置有 YAML 错误，未修改');
  const enabled = doc.getIn(['plugins', 'enabled'])?.toJSON?.() || [];
  if (!Array.isArray(enabled)) throw new Error('plugins.enabled 不是列表，未修改');
  if (!record) {
    try { await fs.access(destination); throw new Error('已有同名桌面插件，未覆盖'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (mode === 'remove') return { changed: false, installed: false };
  } else {
    // Verify ownership of every managed file before upgrading/removing.
    for (const [relative, digest] of Object.entries(record.files)) {
      let data;
      try { data = await fs.readFile(path.join(destination, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (hash(data) !== digest) throw new Error(`插件文件 ${relative} 被外部修改，未覆盖或删除`);
    }
  }
  if (mode === 'remove') {
    if (!record.wasEnabled) doc.setIn(['plugins', 'enabled'], enabled.filter(name => name !== ID));
    if (await fs.readFile(configPath, 'utf8') !== before) throw new Error('配置同时发生变化，请重试');
    await writeConfig(configPath, doc.toString());
    for (const relative of Object.keys(record.files)) await fs.unlink(path.join(destination, relative)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    // No recursive deletion: leave any user-added files / Python caches intact.
    await fs.rmdir(path.join(destination, 'dashboard')).catch(() => {});
    await fs.rmdir(destination).catch(() => {});
    await fs.unlink(recordPath);
    return { changed: true, installed: false, requiresRefresh: true };
  }
  const files = new Map();
  for (const file of sourceFiles) files.set(`dashboard/${file}`, await fs.readFile(path.join(ROOT, 'desktop', 'dashboard', file)));
  files.set('dashboard/settings.json', Buffer.from(JSON.stringify({ root: ROOT, node, runtimeDir: RUNTIME, port: PORT }, null, 2)));
  files.set('plugin.yaml', Buffer.from(`name: ${ID}\nversion: ${VERSION}\ndescription: "可插拔的浏览器预览与手动接管面板"\n`));
  await fs.mkdir(recordDir, { recursive: true });
  await fs.mkdir(path.join(destination, 'dashboard'), { recursive: true });
  const next = { destination, configPath, wasEnabled: record?.wasEnabled ?? enabled.includes(ID), files: Object.fromEntries([...files].map(([relative, value]) => [relative, hash(value)])), version: VERSION };
  // Record before copying for recoverability after an interrupted installation.
  await fs.writeFile(recordPath, JSON.stringify(next, null, 2));
  for (const [relative, data] of files) await fs.writeFile(path.join(destination, relative), data);
  if (!enabled.includes(ID)) doc.setIn(['plugins', 'enabled'], [...enabled, ID]);
  if (await fs.readFile(configPath, 'utf8') !== before) throw new Error('配置同时发生变化，插件文件已准备好，请重试安装');
  await writeConfig(configPath, doc.toString());
  return { changed: true, installed: true, destination, requiresRefresh: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await installDesktop(process.argv[2] || 'install'), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
