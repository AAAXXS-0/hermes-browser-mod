import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createModServer } from '../src/server.mjs';
import { normalizeUrl } from '../src/browser.mjs';
import { ROOT, RUNTIME, VERSION } from '../src/paths.mjs';

test('URL 规范化只支持网页协议', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('http://127.0.0.1:3000/a'), 'http://127.0.0.1:3000/a');
  assert.throws(() => normalizeUrl('file:///C:/secret'), /HTTP/);
});

test('真实浏览器：预览帧、MCP 同会话、手动输入、接管中断、重启持久化', { timeout: 120000 }, async t => {
  const runtime = path.join(RUNTIME, `browser-test-${Date.now()}`);
  const profile = path.join(runtime, 'profile');
  const port = 17381;
  const mod = await createModServer({ port, runtimeDir: runtime, profile });
  let uiBrowser;
  let client;
  t.after(async () => { await client?.close(); await uiBrowser?.close(); await mod.close(); });
  const authHeaders = { authorization: `Bearer ${mod.token}`, 'content-type': 'application/json' };
  const call = async (action, args = {}, actor = 'action') => {
    const response = await fetch(`${mod.origin}/api/${actor}`, { method: 'POST', headers: authHeaders, body: JSON.stringify({ action, args }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const unauthorized = await fetch(`${mod.origin}/api/state`);
  assert.equal(unauthorized.status, 401);
  const crossOrigin = await fetch(`${mod.origin}/api/state`, { headers: { ...authHeaders, origin: 'https://other.example' } });
  assert.equal(crossOrigin.status, 403);

  const ws = new WebSocket(`${mod.origin.replace('http:', 'ws:')}/stream`, { headers: { authorization: `Bearer ${mod.token}` } });
  t.after(() => ws.close());
  const firstFrame = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('实时画面没有首帧')), 10000);
    ws.on('error', reject);
    ws.on('message', data => { const message = JSON.parse(data); if (message.type === 'frame') { clearTimeout(timer); resolve(message); } });
  });
  assert.equal(firstFrame.tabId, mod.browser.activeId);
  assert.ok(firstFrame.data.length > 1000);

  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], env: { ...process.env, HBM_PORT: String(port), HBM_RUNTIME_DIR: runtime } });
  client = new Client({ name: 'mod-verification', version: '1.0.0' });
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'browser_snapshot'));
  const snapshotResult = await client.callTool({ name: 'browser_snapshot', arguments: {} });
  assert.ok(!snapshotResult.isError, JSON.stringify(snapshotResult));
  const snapshot = JSON.parse(snapshotResult.content[0].text);
  assert.equal(snapshot.tabId, mod.browser.activeId);
  const nameRef = snapshot.elements.find(el => el.label === '姓名').ref;
  const textRef = snapshot.elements.find(el => el.label === '任务说明').ref;
  const saveRef = snapshot.elements.find(el => el.label === '保存任务').ref;
  for (const request of [
    { name: 'browser_fill', arguments: { ref: nameRef, text: 'MCP 验证' } },
    { name: 'browser_fill', arguments: { ref: textRef, text: '操作的是同一张页面' } },
    { name: 'browser_click', arguments: { ref: saveRef } },
  ]) assert.ok(!(await client.callTool(request)).isError);
  assert.match(await mod.browser.activePage().locator('#result').innerText(), /MCP 验证/);

  await fs.mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  uiBrowser = await chromium.launch({ channel: 'msedge', headless: true, artifactsDir: path.join(runtime, 'ui-artifacts') });
  const ui = await uiBrowser.newPage({ viewport: { width: 1480, height: 940 } });
  await ui.goto(mod.origin);
  await ui.locator('#frame').waitFor({ state: 'visible' });
  const uiErrors = [];
  ui.on('pageerror', error => uiErrors.push(error.message));
  await ui.getByRole('button', { name: '运行自动操作演示', exact: false }).click();
  await ui.locator('#scratchpad').fill('自动浏览期间，用户仍然可以自由输入中文。');
  await ui.getByRole('button', { name: '再运行一次演示', exact: false }).waitFor({ timeout: 15000 });
  assert.equal(await ui.locator('#scratchpad').inputValue(), '自动浏览期间，用户仍然可以自由输入中文。');
  assert.match(await mod.browser.activePage().locator('#result').innerText(), /Hermes 浏览器助手/);
  await ui.screenshot({ path: path.join(ROOT, 'artifacts', `V${VERSION}-workbench.png`), fullPage: true });

  await ui.getByRole('button', { name: '手动接管', exact: true }).click();
  await ui.getByRole('button', { name: '交还 Agent', exact: true }).waitFor();
  const blocked = await client.callTool({ name: 'browser_navigate', arguments: { url: `${mod.origin}/demo.html` } });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /接管/);
  const inputBox = await mod.browser.activePage().locator('#name').boundingBox();
  const screenBox = await ui.locator('#screen').boundingBox();
  const viewport = mod.browser.viewport;
  const scale = Math.min(screenBox.width / viewport.width, screenBox.height / viewport.height);
  const x = screenBox.x + (screenBox.width - viewport.width * scale) / 2 + (inputBox.x + inputBox.width / 2) * scale;
  const y = screenBox.y + (screenBox.height - viewport.height * scale) / 2 + (inputBox.y + inputBox.height / 2) * scale;
  await ui.mouse.click(x, y);
  await ui.keyboard.press('Control+A');
  await ui.keyboard.insertText('用户中文手动输入');
  await mod.browser.activePage().waitForFunction(() => document.querySelector('#name').value === '用户中文手动输入');
  await ui.screenshot({ path: path.join(ROOT, 'artifacts', `V${VERSION}-manual.png`), fullPage: true });
  await ui.getByRole('button', { name: '交还 Agent', exact: true }).click();
  await ui.getByRole('button', { name: '手动接管', exact: true }).waitFor();

  const originalId = mod.browser.activeId;
  const newState = await call('new_tab', { url: `${mod.origin}/demo.html` });
  assert.equal(newState.tabs.length, 2);
  assert.notEqual(newState.activeId, originalId);
  await call('close_tab', { tabId: newState.activeId });
  assert.equal(mod.browser.activeId, originalId);

  // Takeover must interrupt the multi-step demo while it is running.
  const pendingDemo = call('demo').then(() => null, error => error);
  await new Promise(resolve => setTimeout(resolve, 950));
  await call('control', { owner: 'manual' }, 'ui');
  assert.match((await pendingDemo).message, /接管/);
  assert.equal(mod.browser.owner, 'manual');
  assert.deepEqual(uiErrors, []);

  await mod.browser.activePage().evaluate(() => localStorage.setItem('hbm-test-persistence', 'retained'));
  await client.close(); client = null;
  await uiBrowser.close(); uiBrowser = null;
  ws.close();
  await mod.close();
  const restarted = await createModServer({ port, runtimeDir: runtime, profile });
  try { assert.equal(await restarted.browser.activePage().evaluate(() => localStorage.getItem('hbm-test-persistence')), 'retained'); }
  finally { await restarted.close(); }
});
