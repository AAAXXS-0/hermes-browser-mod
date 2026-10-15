import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createModServer } from '../src/server.mjs';
import { RUNTIME } from '../src/paths.mjs';

test('原生壳跨站 iframe：一次性连接、无 cookie 预览/接管、刷新及权限边界', { timeout: 90000 }, async t => {
  const runtime = path.join(RUNTIME, `embed-session-test-${Date.now()}`);
  const mod = await createModServer({ port: 17395, runtimeDir: runtime, profile: path.join(runtime, 'profile') });
  const browser = await chromium.launch({ channel: 'msedge', headless: true, artifactsDir: path.join(runtime, 'ui-artifacts') });
  t.after(async () => { await browser.close(); await mod.close(); });
  const context = await browser.newContext({ permissions: ['local-network-access'] });
  const page = await context.newPage({ viewport: { width: 900, height: 850 } });
  const response = await fetch(`${mod.origin}/api/embed-ticket`, { method: 'POST', headers: { authorization: `Bearer ${mod.token}` } });
  const { embedUrl } = await response.json();
  await page.route('http://hermesui.localhost/**', route => route.fulfill({ contentType: 'text/html', body: `<iframe title="native browser" src="${embedUrl}" style="width:520px;height:800px;border:0"></iframe>` }));
  await page.goto('http://hermesui.localhost/');
  const view = page.frameLocator('iframe');
  await view.locator('#frame').waitFor({ state: 'visible' });
  assert.equal((await fetch(embedUrl)).status, 401, '连接 ticket 不可复用');
  await context.clearCookies();
  await view.getByRole('button', { name: '手动接管', exact: true }).click();
  await view.getByRole('button', { name: '交还 Agent', exact: true }).waitFor();
  assert.equal(mod.browser.owner, 'manual');
  const child = page.frames().find(frame => frame.url().startsWith(mod.origin));
  assert.ok(!child.url().includes('ticket='));
  const denied = await child.evaluate(async () => {
    const response = await fetch('/api/action', { method: 'POST', headers: { authorization: `Bearer ${window.__HBM_EMBED_SESSION__}`, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'navigate', args: { url: 'https://example.com' } }) });
    return response.status;
  });
  assert.equal(denied, 403, '嵌入凭据不能执行 Agent 动作');
  await child.evaluate(() => location.reload());
  await view.locator('#frame').waitFor({ state: 'visible' });
  await view.getByRole('button', { name: '交还 Agent', exact: true }).click();
  await view.getByRole('button', { name: '手动接管', exact: true }).waitFor();
  assert.equal(mod.browser.owner, 'agent');
});
