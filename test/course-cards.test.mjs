import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createModServer } from '../src/server.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, RUNTIME } from '../src/paths.mjs';

// Reproduce the site's structure without storing private page HTML/session data:
// a clickable div containing a course heading and a separate unnamed menu.
const fixture = `<!doctype html><html lang="zh-CN"><head><title>课程卡片回归测试</title><style>.card{cursor:pointer;width:400px;border:1px solid;margin:20px;padding:20px}.menu{float:right}</style></head><body><main id="list"><div class="card" data-course="alg"><h1>算法分析与设计C</h1><p>算法老师</p><span class="menu" role="button">…</span></div><div class="card" data-course="os"><h1>操作系统</h1><p>苏老师</p><span class="menu" role="button">…</span></div></main><div id="result"></div><script>window.menuClicks=0;window.courseClicks=0;document.querySelectorAll('.card').forEach(card=>card.onclick=()=>{window.courseClicks++;document.querySelector('#result').textContent='进入：'+card.querySelector('h1').textContent});document.querySelectorAll('.menu').forEach(menu=>menu.onclick=e=>{e.stopPropagation();window.menuClicks++;document.querySelector('#result').textContent='菜单：'+menu.closest('.card').querySelector('h1').textContent});</script></body></html>`;

test('课程卡片与菜单明确区分，引用变化拒绝误点，MCP 返回实际目标', { timeout: 90000 }, async t => {
  const port = 17382;
  const runtime = path.join(RUNTIME, `course-test-${Date.now()}`);
  const mod = await createModServer({ port, runtimeDir: runtime, profile: path.join(runtime, 'profile') });
  let client;
  t.after(async () => { await client?.close(); await mod.close(); });
  const page = mod.browser.activePage();
  await page.setContent(fixture);
  client = new Client({ name: 'course-regression', version: '1.0.1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src', 'mcp.mjs')], env: { ...process.env, HBM_PORT: String(port), HBM_RUNTIME_DIR: runtime } }));
  const invoke = (name, args = {}) => client.callTool({ name, arguments: args });
  const readSnapshot = async () => {
    const result = await invoke('browser_snapshot');
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const first = await readSnapshot();
  const course = first.elements.find(element => element.label === '操作系统' && element.kind === 'heading');
  const algorithmMenu = first.elements.find(element => element.label === '…' && element.context.includes('算法分析与设计C'));
  const osMenu = first.elements.find(element => element.label === '…' && element.context.includes('操作系统'));
  assert.ok(course && algorithmMenu && osMenu);
  assert.notEqual(course.ref, osMenu.ref);
  assert.ok(first.elements.some(element => element.kind === 'clickable-container' && element.label.includes('操作系统')));
  assert.ok(first.targets.includes(`[ref=${course.ref}] heading "操作系统"`));

  const hoverResult = await invoke('browser_click', { ref: algorithmMenu.ref, action: 'hover' });
  assert.equal(hoverResult.isError, true);
  assert.match(hoverResult.content[0].text, /不支持参数 action/);
  assert.equal(await page.evaluate(() => window.menuClicks), 0);

  const courseResult = await invoke('browser_click', { ref: course.ref });
  assert.ok(!courseResult.isError, JSON.stringify(courseResult));
  assert.equal(await page.locator('#result').innerText(), '进入：操作系统');
  assert.equal(await page.evaluate(() => window.menuClicks), 0);
  assert.equal(JSON.parse(courseResult.content[0].text).actionResult.target.label, '操作系统');

  const second = await readSnapshot();
  assert.ok(second.elements.every(element => !first.elements.some(old => old.ref === element.ref)));
  assert.equal((await invoke('browser_click', { ref: course.ref })).isError, true);

  const stableCourse = second.elements.find(element => element.label === '操作系统' && element.kind === 'heading');
  await page.evaluate(() => document.querySelector('[data-course="os"] h1').textContent = '另一门课程');
  const changed = await invoke('browser_click', { ref: stableCourse.ref });
  assert.equal(changed.isError, true);
  assert.match(changed.content[0].text, /含义已改变/);
  assert.equal(await page.evaluate(() => window.courseClicks), 1);

  const third = await readSnapshot();
  const removedCourse = third.elements.find(element => element.label === '另一门课程' && element.kind === 'heading');
  await page.evaluate(() => {
    const previous = document.querySelector('[data-course="os"] h1');
    const replacement = document.createElement('h1'); replacement.textContent = previous.textContent; previous.replaceWith(replacement);
  });
  const replaced = await invoke('browser_click', { ref: removedCourse.ref });
  assert.equal(replaced.isError, true);
  assert.equal(await page.evaluate(() => window.courseClicks), 1);

  const fourth = await readSnapshot();
  const oldTabRef = fourth.elements.find(element => element.label === '另一门课程' && element.kind === 'heading').ref;
  await mod.browser.run('new_tab', { url: `${mod.origin}/demo.html` });
  await readSnapshot();
  assert.equal((await invoke('browser_click', { ref: oldTabRef })).isError, true);

  await fs.mkdir(path.join(ROOT, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(ROOT, 'artifacts', 'V1.0.1-course-targets.txt'), first.targets);
});
