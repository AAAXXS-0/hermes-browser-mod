import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { installDesktop } from '../src/desktop-adapter.mjs';
import { RUNTIME } from '../src/paths.mjs';

test('桌面接入独立安装和撤销，保留其他插件/配置及用户新增文件', async () => {
  const dir = path.join(RUNTIME, `desktop-adapter-test-${Date.now()}`);
  const home = path.join(dir, 'home'), recordDir = path.join(dir, 'record');
  await fs.mkdir(home, { recursive: true });
  const config = path.join(home, 'config.yaml');
  await fs.writeFile(config, '# user comment\nplugins:\n  enabled: [other-plugin]\nmodel: original\n');
  const installed = await installDesktop('install', { home, recordDir });
  let text = await fs.readFile(config, 'utf8');
  assert.ok(text.includes('# user comment'));
  assert.deepEqual(parse(text).plugins.enabled, ['other-plugin', 'hermes-browser-mod']);
  const manifest = JSON.parse(await fs.readFile(path.join(installed.destination, 'dashboard', 'manifest.json'), 'utf8'));
  assert.equal(manifest.tab.path, '/browser-mod');
  await fs.writeFile(config, text.replace('original', 'changed-by-user'));
  await fs.writeFile(path.join(installed.destination, 'user-note.txt'), 'keep me');
  const removed = await installDesktop('remove', { home, recordDir });
  assert.equal(removed.installed, false);
  text = await fs.readFile(config, 'utf8');
  assert.equal(parse(text).model, 'changed-by-user');
  assert.deepEqual(parse(text).plugins.enabled, ['other-plugin']);
  assert.equal(await fs.readFile(path.join(installed.destination, 'user-note.txt'), 'utf8'), 'keep me');
  await assert.rejects(fs.access(path.join(installed.destination, 'dashboard', 'plugin.js')));
});

test('桌面接入拒绝覆盖同名插件，拒绝删除外部改过的文件', async () => {
  const dir = path.join(RUNTIME, `desktop-conflict-test-${Date.now()}`);
  const home = path.join(dir, 'home'), recordDir = path.join(dir, 'record');
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, 'config.yaml'), 'plugins:\n  enabled: []\n');
  const installed = await installDesktop('install', { home, recordDir });
  await assert.rejects(installDesktop('install', { home, recordDir: path.join(dir, 'other-record') }), /同名/);
  await fs.appendFile(path.join(installed.destination, 'dashboard', 'plugin.js'), '\n// user edit');
  await assert.rejects(installDesktop('remove', { home, recordDir }), /外部修改/);
  assert.ok(parse(await fs.readFile(path.join(home, 'config.yaml'), 'utf8')).plugins.enabled.includes('hermes-browser-mod'));
});
