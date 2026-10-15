import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createModServer } from '../src/server.mjs';
import { toViewportPoint, pngDimensions } from '../src/coordinates.mjs';
import { ROOT, RUNTIME } from '../src/paths.mjs';

test('截图像素、CSS 像素和归一化坐标换算，越界不会被静默夹到其他位置', () => {
  const shot = { viewport: { width: 1280, height: 800 }, imageWidth: 640, imageHeight: 400 };
  assert.deepEqual(toViewportPoint({ x: 160, y: 95 }, shot), { x: 320, y: 190 });
  assert.deepEqual(toViewportPoint({ x: 0.25, y: 0.2375, coordinateSpace: 'normalized' }, shot), { x: 320, y: 190 });
  assert.deepEqual(toViewportPoint({ x: 320, y: 190, coordinateSpace: 'viewport' }, shot), { x: 320, y: 190 });
  for (const args of [{ x: -1, y: 10 }, { x: 640, y: 20 }, { x: 10, y: NaN }, { x: 1, y: 0.2, coordinateSpace: 'normalized' }]) assert.throws(() => toViewportPoint(args, shot));
});

const fixture = `<!doctype html><html><head><title>Visual coordinate fixture</title><style>body{margin:0;height:2000px;font-family:sans-serif;background:#f4f6f2}canvas{position:absolute;left:220px;top:120px;border:0}.hover-zone{position:absolute;left:700px;top:100px;width:180px;height:130px;background:#d3dfcb}.hover-menu{position:absolute;left:40px;top:65px;visibility:hidden}.hover-zone:hover .hover-menu{visibility:visible}#result{position:absolute;left:220px;top:370px}</style></head><body><canvas id="surface" width="360" height="220"></canvas><div class="hover-zone">Hover here<button class="hover-menu">Menu action</button></div><div id="result">Waiting</div><script>window.clicks=0;window.doubleClicks=0;window.rightClicks=0;const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');ctx.fillStyle='#326d4e';ctx.fillRect(0,0,360,220);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('Canvas action',30,85);canvas.onclick=e=>{window.clicks++;window.lastPoint={x:e.offsetX,y:e.offsetY};document.querySelector('#result').textContent='Canvas clicked '+window.clicks};canvas.ondblclick=()=>window.doubleClicks++;canvas.oncontextmenu=e=>{e.preventDefault();window.rightClicks++};document.querySelector('.hover-menu').onclick=()=>document.querySelector('#result').textContent='Hover menu clicked';</script></body></html>`;

test('真实 MCP 坐标操作：缩小截图、Canvas、悬停、右键双击、旧图拒绝与接管', { timeout: 120000 }, async t => {
  const port = 17383;
  const runtime = path.join(RUNTIME, `coordinate-test-${Date.now()}`);
  const mod = await createModServer({ port, runtimeDir: runtime, profile: path.join(runtime, 'profile'), deviceScaleFactor: 2 });
  let client;
  t.after(async () => { await client?.close(); await mod.close(); });
  const page = mod.browser.activePage();
  assert.equal(await page.evaluate(() => devicePixelRatio), 2);
  await page.setContent(fixture);
  client = new Client({ name: 'coordinate-regression', version: '1.1.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], env: { ...process.env, HBM_PORT: String(port), HBM_RUNTIME_DIR: runtime } }));
  const invoke = (name, args = {}) => client.callTool({ name, arguments: args });
  const assertSuccess = result => { assert.ok(!result.isError, JSON.stringify(result)); return JSON.parse(result.content.find(item => item.type === 'text').text); };
  const screenshot = async (args = {}) => {
    const result = await invoke('browser_screenshot', args);
    const metadata = assertSuccess(result);
    const image = result.content.find(item => item.type === 'image');
    const bytes = Buffer.from(image.data, 'base64');
    assert.deepEqual(pngDimensions(bytes), { width: metadata.imageWidth, height: metadata.imageHeight });
    return { ...metadata, bytes };
  };
  const pixelAt = (shot, x, y) => page.evaluate(async ({ data, x, y }) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const surface = new OffscreenCanvas(image.width, image.height);
    const context = surface.getContext('2d'); context.drawImage(image, 0, 0);
    return [...context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data];
  }, { data: shot.bytes.toString('base64'), x, y });
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 16);
  assert.ok(tools.tools.some(tool => tool.name === 'browser_click_at'));
  assert.ok(tools.tools.some(tool => tool.name === 'browser_hover_at'));
  const dom = assertSuccess(await invoke('browser_snapshot'));
  assert.ok(!dom.elements.some(element => element.tag === 'canvas'), 'Canvas 内部按钮没有 DOM 引用，坐标路径仍能操作');

  const small = await screenshot({ maxWidth: 640 });
  assert.equal(small.imageWidth, 640);
  assert.equal(small.imageHeight, 400);
  assert.deepEqual(small.viewport, { width: 1280, height: 800 });
  await fs.mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'artifacts', 'V1.1.0-coordinate-canvas.png'), small.bytes);
  const clicked = assertSuccess(await invoke('browser_click_at', { screenshotId: small.screenshotId, x: 160, y: 95 }));
  assert.deepEqual(clicked.actionResult.viewportPoint, { x: 320, y: 190 });
  assert.equal(clicked.actionResult.target.tag, 'canvas');
  assert.equal(await page.evaluate(() => window.clicks), 1);
  assert.deepEqual(await page.evaluate(() => window.lastPoint), { x: 100, y: 70 });
  assert.equal((await invoke('browser_click_at', { screenshotId: small.screenshotId, x: 160, y: 95 })).isError, true);

  let shot = await screenshot();
  assertSuccess(await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 0.25, y: 0.2375, coordinateSpace: 'normalized', clickCount: 2 }));
  assert.equal(await page.evaluate(() => window.doubleClicks), 1);
  shot = await screenshot();
  assertSuccess(await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 320, y: 190, coordinateSpace: 'viewport', button: 'right' }));
  assert.equal(await page.evaluate(() => window.rightClicks), 1);

  shot = await screenshot();
  assertSuccess(await invoke('browser_hover_at', { screenshotId: shot.screenshotId, x: 800, y: 130, coordinateSpace: 'viewport' }));
  assert.equal(await page.locator('.hover-menu').isVisible(), true);
  shot = await screenshot();
  const menu = await page.locator('.hover-menu').boundingBox();
  assertSuccess(await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: menu.x + menu.width / 2, y: menu.y + menu.height / 2, coordinateSpace: 'viewport' }));
  assert.equal(await page.locator('#result').innerText(), 'Hover menu clicked');

  shot = await screenshot();
  await page.locator('canvas').evaluate(element => { element.style.left = '400px'; });
  const moved = await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 320, y: 190 });
  assert.equal(moved.isError, true);
  assert.match(moved.content[0].text, /页面.*变化/);

  shot = await screenshot();
  await page.evaluate(() => scrollTo(0, 80));
  assert.equal((await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 450, y: 190 })).isError, true);
  // A reduced screenshot after scroll still maps current image coordinates to
  // the current viewport, rather than accidentally using document coordinates.
  const scrolled = await screenshot({ maxWidth: 640 });
  const canvas = await page.locator('canvas').boundingBox();
  assert.equal(scrolled.scroll.y, 80);
  assert.deepEqual(await pixelAt(scrolled, (canvas.x + 300) / 2, (canvas.y + 180) / 2), [50, 109, 78, 255], '缩小且滚动后的截图确实包含对应 Canvas 像素');
  assertSuccess(await invoke('browser_click_at', { screenshotId: scrolled.screenshotId, x: (canvas.x + 100) / 2, y: (canvas.y + 70) / 2 }));
  assert.deepEqual(await page.evaluate(() => window.lastPoint), { x: 100, y: 70 });

  shot = await screenshot();
  await mod.browser.run('viewport', { width: 960, height: 720 }, 'ui');
  assert.equal((await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 450, y: 100 })).isError, true);
  shot = await screenshot();
  const countBefore = await page.evaluate(() => window.clicks);
  assert.equal((await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: shot.imageWidth + 1, y: 20 })).isError, true);
  assert.equal((await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 450, y: 100, coordinateSpace: 'desktop' })).isError, true);
  assert.equal(await page.evaluate(() => window.clicks), countBefore);

  // Emulate a retina/DPI=2 browser. Default and reduced screenshots should both
  // advertise their real dimensions and preserve the same viewport mapping.
  shot = await screenshot();
  assert.equal(shot.imageWidth, 960);
  assert.equal(shot.imageHeight, 720);
  const retina = await screenshot({ maxWidth: 480 });
  assert.equal(retina.imageWidth, 480);
  assert.equal(retina.imageHeight, 360);
  const retinaCanvas = await page.locator('canvas').boundingBox();
  assert.deepEqual(await pixelAt(retina, (retinaCanvas.x + 300) / 2, (retinaCanvas.y + 180) / 2), [50, 109, 78, 255]);
  assertSuccess(await invoke('browser_click_at', { screenshotId: retina.screenshotId, x: (retinaCanvas.x + 100) / 2, y: (retinaCanvas.y + 70) / 2 }));
  assert.deepEqual(await page.evaluate(() => window.lastPoint), { x: 100, y: 70 });
  assert.equal(await page.evaluate(() => devicePixelRatio), 2, '截图不改变浏览器真实 DPI');
  shot = await screenshot();

  const previousId = shot.screenshotId;
  await screenshot();
  assert.equal((await invoke('browser_hover_at', { screenshotId: previousId, x: 450, y: 100 })).isError, true);
  shot = await screenshot();
  await invoke('browser_release_control');
  assert.equal((await invoke('browser_click_at', { screenshotId: shot.screenshotId, x: 450, y: 100 })).isError, true);
  await mod.browser.run('control', { owner: 'agent' }, 'ui');

  shot = await screenshot();
  await mod.browser.run('new_tab', { url: `${mod.origin}/demo.html` });
  assert.equal((await invoke('browser_hover_at', { screenshotId: shot.screenshotId, x: 450, y: 100 })).isError, true);
  const current = await screenshot();
  await mod.browser.run('navigate', { url: `${mod.origin}/demo.html` });
  assert.equal((await invoke('browser_click_at', { screenshotId: current.screenshotId, x: 100, y: 100 })).isError, true);
});
