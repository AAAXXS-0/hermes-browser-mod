import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { changeAdapter, adapterStatus, ADAPTER_NAME } from '../src/adapter.mjs';
import { RUNTIME } from '../src/paths.mjs';

test('适配器只管理自己的 MCP 项，撤销保留接入期间的其他修改', async () => {
  const root = path.join(RUNTIME, `adapter-test-${Date.now()}`);
  const home = path.join(root, 'hermes');
  const record = path.join(root, 'record');
  await fs.mkdir(home, { recursive: true });
  const file = path.join(home, 'config.yaml');
  await fs.writeFile(file, '# 用户注释\nmodel: original\nmcp_servers:\n  other:\n    command: original-tool\n');
  assert.equal((await changeAdapter('connect', home, record)).changed, true);
  assert.equal((await adapterStatus(home)).connected, true);
  assert.equal((await changeAdapter('connect', home, record)).changed, false);
  let text = await fs.readFile(file, 'utf8');
  assert.ok(text.includes('# 用户注释'));
  await fs.writeFile(file, text.replace('model: original', 'model: user-updated'));
  await changeAdapter('disconnect', home, record);
  const finalText = await fs.readFile(file, 'utf8');
  const config = parse(finalText);
  assert.equal(config.model, 'user-updated');
  assert.equal(config.mcp_servers.other.command, 'original-tool');
  assert.equal(config.mcp_servers[ADAPTER_NAME], undefined);
  assert.ok(finalText.includes('# 用户注释'));
  assert.equal((await changeAdapter('disconnect', home, record)).changed, false);
});

test('已有同名配置或接入条目被外部改动时不覆盖、不移除', async () => {
  const root = path.join(RUNTIME, `adapter-conflict-${Date.now()}`);
  const home = path.join(root, 'hermes');
  const record = path.join(root, 'record');
  await fs.mkdir(home, { recursive: true });
  const file = path.join(home, 'config.yaml');
  await fs.writeFile(file, `mcp_servers:\n  ${ADAPTER_NAME}:\n    command: user-command\n`);
  const original = await fs.readFile(file, 'utf8');
  await assert.rejects(changeAdapter('connect', home, record), /同名/);
  assert.equal(await fs.readFile(file, 'utf8'), original);
  await fs.writeFile(file, 'model: test\n');
  await changeAdapter('connect', home, record);
  const connected = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, connected.replace(/timeout: 60/, 'timeout: 99'));
  await assert.rejects(changeAdapter('disconnect', home, record), /外部修改/);
  assert.ok((await fs.readFile(file, 'utf8')).includes('timeout: 99'));
});
