import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createModServer } from '../src/server.mjs';
import { previewGeometry, viewportToPreview, previewToViewport } from '../public/preview-geometry.js';
import { ROOT, RUNTIME } from '../src/paths.mjs';

test('指针与人工点击共用预览缩放映射，留白处不落到网页', () => {
  const geometry = previewGeometry({ width: 900, height: 700 }, { width: 1280, height: 800 }, { width: 1280, height: 800 });
  const rendered = viewportToPreview({ x: 300, y: 150 }, geometry);
  assert.deepEqual(previewToViewport(rendered, geometry), { x: 300, y: 150 });
  assert.equal(previewToViewport({ x: 20, y: 5 }, geometry), null);
  assert.equal(viewportToPreview({ x: 1280, y: 150 }, geometry), null);
});

const fixture = `<!doctype html><html><head><title>Pointer fixture</title><style>body{margin:0;height:1800px;background:#f4f6f2;font-family:sans-serif}button#target{position:absolute;left:220px;top:120px;width:160px;height:60px;background:#326d4e;color:white;border:0;border-radius:8px}iframe{position:absolute;left:600px;top:100px;width:200px;height:140px;border:6px solid #326d4e;transform:scale(1.2);transform-origin:top left}#result{position:absolute;left:220px;top:220px}</style></head><body><button id="target">可见点击目标</button><iframe title="子页面" srcdoc="<style>body{margin:0}button{position:absolute;left:20px;top:20px;width:100px;height:40px}</style><button>框内按钮</button>"></iframe><div id="result">等待点击</div><script>document.querySelector('#target').onclick=()=>document.querySelector('#result').textContent='已点击';</script></body></html>`;

test('真实操作指针：DOM 点击、坐标悬停、iframe、缩放、接管与开关', { timeout: 120000 }, async t => {
  const runtime = path.join(RUNTIME, `pointer-test-${Date.now()}`);
  const port = 17384;
  const mod = await createModServer({ port, runtimeDir: runtime, profile: path.join(runtime, 'profile') });
  let client, uiBrowser;
  t.after(async () => { await client?.close(); await uiBrowser?.close(); await mod.close(); });
  const page = mod.browser.activePage();
  await page.route('**/pointer-fixture', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture }));
  await page.goto(`${mod.origin}/pointer-fixture`);
  client = new Client({ name: 'pointer-regression', version: '1.2.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], env: { ...process.env, HBM_PORT: String(port), HBM_RUNTIME_DIR: runtime } }));
  const invoke = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  uiBrowser = await chromium.launch({ channel: 'msedge', headless: true, artifactsDir: path.join(runtime, 'ui-artifacts') });
  const ui = await uiBrowser.newPage({ viewport: { width: 1480, height: 940 } });
  const errors = [];
  ui.on('pageerror', error => errors.push(error.message));
  await ui.goto(mod.origin);
  await ui.locator('#frame').waitFor({ state: 'visible' });
  const snapshot = await invoke('browser_snapshot');
  const ref = snapshot.elements.find(element => element.label === '可见点击目标').ref;
  await invoke('browser_click', { ref });
  await ui.waitForFunction(() => document.querySelector('#pointer-caption').textContent.includes('可见点击目标'));
  assert.equal(await page.locator('#result').innerText(), '已点击');
  const pointer = mod.browser.state().pointer;
  assert.equal(pointer.lastClick.label, '可见点击目标');
  assert.equal(pointer.lastClick.x, 300);
  assert.equal(pointer.lastClick.y, 150);
  assert.equal(await ui.locator('#remote-cursor').isVisible(), true);
  assert.equal(await ui.locator('#click-marker .click-dot').isVisible(), true);
  assert.equal(await ui.locator('#cursor-label').innerText(), 'Agent');
  assert.equal(await page.locator('#pointer-layer').count(), 0, '叠加层不进入真实网页');

  const checkAlignment = async () => {
    const actual = await ui.locator('#remote-cursor').boundingBox();
    const expected = await ui.evaluate(({ x, y }) => {
      const rect = document.querySelector('#screen').getBoundingClientRect();
      const image = document.querySelector('#frame');
      const scale = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
      return { x: rect.x + (rect.width - image.naturalWidth * scale) / 2 + x / 1280 * image.naturalWidth * scale, y: rect.y + (rect.height - image.naturalHeight * scale) / 2 + y / 800 * image.naturalHeight * scale };
    }, { x: 300, y: 150 });
    assert.ok(Math.abs(actual.x - expected.x) < 1, `${actual.x} != ${expected.x}`);
    assert.ok(Math.abs(actual.y - expected.y) < 1, `${actual.y} != ${expected.y}`);
  };
  await checkAlignment();
  await fs.mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  await ui.screenshot({ path: path.join(ROOT, 'artifacts', 'V1.2.0-pointer.png'), fullPage: true });
  await ui.setViewportSize({ width: 1280, height: 1000 });
  await ui.waitForTimeout(100);
  await checkAlignment();
  await ui.locator('#pointer-toggle').click();
  assert.equal(await ui.locator('#pointer-layer').isVisible(), false);
  await ui.locator('#pointer-toggle').click();
  assert.equal(await ui.locator('#pointer-layer').isVisible(), true);

  let shot = await invoke('browser_screenshot');
  await invoke('browser_hover_at', { screenshotId: shot.screenshotId, x: 350, y: 170, coordinateSpace: 'viewport' });
  for (let attempt = 0; attempt < 100 && mod.browser.state().pointer?.x !== 350; attempt++) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(mod.browser.state().pointer.x, 350);
  assert.equal(mod.browser.state().pointer.y, 170);

  // Frame clicks must report main-frame coordinates, including border + scale.
  const frame = page.frames().find(item => item.parentFrame());
  const frameButton = await frame.getByRole('button', { name: '框内按钮' }).boundingBox();
  const targetPoint = { x: frameButton.x + frameButton.width / 2, y: frameButton.y + frameButton.height / 2 };
  shot = await invoke('browser_screenshot');
  await invoke('browser_click_at', { screenshotId: shot.screenshotId, ...targetPoint, coordinateSpace: 'viewport' });
  await ui.waitForFunction(() => document.querySelector('#pointer-caption').textContent.includes('框内按钮'));
  const framePointer = mod.browser.state().pointer.lastClick;
  assert.ok(Math.abs(framePointer.x - targetPoint.x) < 1);
  assert.ok(Math.abs(framePointer.y - targetPoint.y) < 1);

  await mod.browser.run('control', { owner: 'manual' }, 'ui');
  await mod.browser.run('input', { kind: 'click', x: 300, y: 150 }, 'manual');
  await ui.waitForFunction(() => document.querySelector('#cursor-label').textContent === '你');
  assert.equal(mod.browser.state().pointer.lastClick.actor, 'manual');
  await page.evaluate(() => scrollTo(0, 100));
  await ui.waitForFunction(() => document.querySelector('#pointer-layer').hidden);
  await mod.browser.run('control', { owner: 'agent' }, 'ui');
  await mod.browser.run('new_tab', { url: `${mod.origin}/demo.html` });
  await ui.waitForFunction(() => document.querySelector('#pointer-layer').hidden);
  assert.deepEqual(errors, []);
});
