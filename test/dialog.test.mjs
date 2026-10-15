import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chromium } from 'playwright';
import { createModServer } from '../src/server.mjs';
import { RUNTIME } from '../src/paths.mjs';

const within = (promise, ms = 3000, label = 'operation') => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error(`弹窗处理仍被动作队列阻塞: ${label}`)), ms); timer.unref(); })]);

test('真实离开确认：状态与弹窗处理绕过等待队列，取消保留页面，恢复后可继续操作', { timeout: 60000 }, async t => {
  const runtime = path.join(RUNTIME, `dialog-test-${Date.now()}`);
  const mod = await createModServer({ port: 17402, runtimeDir: runtime, profile: path.join(runtime, 'profile') });
  const uiBrowser = await chromium.launch({ channel: 'msedge', headless: true, artifactsDir: path.join(runtime, 'ui-artifacts') });
  t.after(async () => { for (const entry of mod.browser.pages.values()) await entry.liveDialog?.dismiss().catch(() => {}); await uiBrowser.close(); await mod.close(); });
  const ui = await uiBrowser.newPage({ viewport: { width: 520, height: 800 } });
  await ui.goto(mod.origin + '/?embedded=1');
  await ui.locator('#frame').waitFor({ state: 'visible' });
  const page = mod.browser.activePage();
  await page.locator('#name').fill('离开确认前的未保存内容');
  await page.locator('#name').click(); // trusted activation required by beforeunload
  await page.evaluate(() => addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; }));
  const waiting = page.waitForEvent('dialog');
  const reload = mod.browser.run('reload', {}, 'ui').catch(error => error);
  const backlog = mod.browser.run('fill', { selector: '#name', text: '积压操作不应写入' }, 'agent').catch(error => error);
  assert.equal((await waiting).type(), 'beforeunload');
  const state = await within(mod.browser.run('state'));
  assert.equal(state.tabs.find(tab => tab.id === state.activeId).dialog.type, 'beforeunload');
  await assert.rejects(mod.browser.run('snapshot'), /browser_handle_dialog/);
  await ui.getByRole('button', { name: '留在此页', exact: true }).waitFor();
  assert.match(await ui.locator('#dialog-message').textContent(), /保留当前页面/);
  await ui.getByRole('button', { name: '留在此页', exact: true }).click();
  assert.match((await within(reload, 3000, 'cancelled reload')).message, /browser_handle_dialog/);
  assert.match((await within(backlog)).message, /积压操作/);
  await ui.locator('#dialog-bar').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#name').inputValue(), '离开确认前的未保存内容');
  assert.equal(await within(mod.browser.run('snapshot')).then(value => value.tabId), mod.browser.activeId);
  // A background tab may also block the shared queue. Resolve that tab directly.
  const other = await mod.browser.context.newPage();
  const otherEntry = [...mod.browser.pages.values()].find(entry => entry.page === other);
  const dialogEvent = other.waitForEvent('dialog');
  const alert = other.evaluate(() => alert('后台标签弹窗')).catch(error => error);
  await dialogEvent;
  await within(mod.browser.run('dialog', { accept: true, tabId: otherEntry.id }), 3000, 'background dialog');
  await within(alert, 3000, 'background alert');
  assert.equal(otherEntry.liveDialog, null);
  // Resolving must still respect the user's manual ownership.
  const nextDialog = page.waitForEvent('dialog');
  const blocked = page.evaluate(() => confirm('接管验证')).catch(error => error);
  await nextDialog;
  await mod.browser.run('control', { owner: 'manual' }, 'ui');
  await assert.rejects(mod.browser.run('dialog', { accept: true }, 'agent'), /接管/);
  await within(mod.browser.run('dialog', { accept: false }, 'ui'));
  assert.equal(await within(blocked), false);
});
