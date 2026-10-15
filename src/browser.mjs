import { chromium } from 'playwright';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { RUNTIME } from './paths.mjs';
import { inspectDom, formatTargets } from './dom-targets.mjs';
import { pngDimensions, toViewportPoint, createVisualTracker, readVisualTracker, resizeScreenshotInPage } from './coordinates.mjs';
import { POINTER_BINDING, installPointerTelemetry } from './pointer.mjs';
import { frameMetadata, hitTestFrame, focusedEditable, describeEditable } from './frame-targets.mjs';

export function normalizeUrl(value) {
  const input = String(value || '').trim();
  if (input === 'about:blank') return input;
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP/HTTPS 网页');
  return url.href;
}

export class BrowserService extends EventEmitter {
  constructor({ profile = path.join(RUNTIME, 'browser-profile'), demoUrl, deviceScaleFactor = 1 } = {}) {
    super();
    this.profile = profile;
    this.demoUrl = demoUrl;
    this.deviceScaleFactor = deviceScaleFactor;
    this.owner = 'agent';
    this.pages = new Map();
    this.nextId = 1;
    this.nextElementRef = 1;
    this.pointerSequence = 0;
    this.activeId = null;
    this.events = [];
    this.tail = Promise.resolve();
    this.streamClients = 0;
    this.viewport = { width: 1280, height: 800 };
    this.closed = false;
  }

  async start() {
    await fs.mkdir(this.profile, { recursive: true });
    const artifactsDir = path.join(this.profile, '..', 'browser-artifacts');
    await fs.mkdir(artifactsDir, { recursive: true });
    this.context = await chromium.launchPersistentContext(this.profile, {
      channel: process.env.HBM_BROWSER_CHANNEL || 'msedge',
      ...(process.env.HBM_BROWSER_PATH ? { executablePath: process.env.HBM_BROWSER_PATH } : {}),
      headless: true,
      viewport: this.viewport,
      deviceScaleFactor: this.deviceScaleFactor,
      acceptDownloads: true,
      artifactsDir,
      downloadsPath: path.join(RUNTIME, 'downloads'),
      args: ['--disable-background-timer-throttling'],
    });
    this.context.setDefaultTimeout(12000);
    await this.context.exposeBinding(POINTER_BINDING, (source, payload) => this.reportPointer(source, payload));
    await this.context.addInitScript(installPointerTelemetry, { bindingName: POINTER_BINDING });
    this.context.on('page', page => this.attachPage(page).catch(error => this.log('error', error.message)));
    for (const page of this.context.pages()) await this.attachPage(page);
    if (!this.pages.size) await this.attachPage(await this.context.newPage());
    await this.activePage().goto(this.demoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.log('system', '独立浏览器已启动，使用项目专属登录资料');
    return this;
  }

  async attachPage(page) {
    const existing = [...this.pages.values()].find(entry => entry.page === page);
    if (existing) return existing.id;
    const id = `tab-${this.nextId++}`;
    // Register synchronously before awaiting: the context event and new_tab may race.
    const entry = { id, page, title: '新标签页', url: page.url(), refs: new Map(), cdp: null, visualRevision: 0, visualTrackers: new Map(), screenshot: null, pointer: null, pointerGeneration: 0 };
    this.pages.set(id, entry);
    if (!this.activeId) this.activeId = id;
    page.on('framenavigated', frame => {
      this.invalidateScreenshot(entry);
      if (frame === page.mainFrame()) {
        entry.pointer = null;
        entry.pointerGeneration++;
        this.clearRefs(entry).catch(() => {});
        this.resetVisualTracker(entry).catch(() => {});
        this.refresh(entry).catch(() => {});
      }
    });
    page.on('frameattached', () => this.invalidateScreenshot(entry));
    page.on('framedetached', () => this.invalidateScreenshot(entry));
    page.on('close', () => {
      this.clearRefs(entry).catch(() => {});
      this.resetVisualTracker(entry).catch(() => {});
      this.pages.delete(id);
      if (this.activeId === id) {
        this.activeId = this.pages.keys().next().value || null;
        this.updateStream().catch(() => {});
      }
      this.publish();
    });
    page.on('dialog', dialog => {
      entry.dialog = { type: dialog.type(), message: dialog.message() };
      entry.liveDialog = dialog;
      this.operationGeneration = (this.operationGeneration || 0) + 1;
      this.publish();
      this.emit('dialog-waiting', entry);
    });
    page.on('download', download => {
      const name = path.basename(download.suggestedFilename()).replace(/[<>:"/\\|?*]/g, '_');
      const target = path.join(RUNTIME, 'downloads', `${Date.now()}-${name}`);
      download.saveAs(target).then(() => this.log('download', `已下载：${name}`)).catch(e => this.log('error', e.message));
    });
    await this.refresh(entry);
    this.publish();
    return id;
  }

  activeEntry() {
    const entry = this.pages.get(this.activeId);
    if (!entry) throw new Error('没有可用标签页，请新建标签页');
    return entry;
  }

  activePage() { return this.activeEntry().page; }

  async refresh(entry) {
    if (entry.page.isClosed()) return;
    entry.url = entry.page.url();
    entry.title = await entry.page.title().catch(() => '加载中');
    this.publish();
  }

  state() {
    return {
      owner: this.owner, activeId: this.activeId, viewport: this.viewport,
      tabs: [...this.pages.values()].map(e => ({ id: e.id, title: e.title, url: e.url, dialog: e.dialog })),
      events: this.events.slice(-35),
      pointer: this.pages.get(this.activeId)?.pointer || null,
    };
  }

  publish() { this.emit('state', this.state()); }

  async reportPointer(source, payload) {
    const entry = [...this.pages.values()].find(item => item.page === source.page);
    if (!entry || this.closed || !['move', 'down', 'up', 'reset'].includes(payload?.phase)) return;
    const sequence = ++this.pointerSequence;
    const generation = entry.pointerGeneration;
    if (payload.phase === 'reset') {
      entry.pointer = null;
      entry.pointerGeneration++;
      this.emit('pointer', { type: 'pointer', tabId: entry.id, pointer: null });
      return;
    }
    if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
    let x = payload.x, y = payload.y, viewport = payload.viewport;
    if (source.frame.parentFrame()) {
      // frameElement.boundingBox() is in main-frame CSS coordinates. Include
      // its border and CSS scale so child-frame events align with the preview.
      const element = await source.frame.frameElement().catch(() => null);
      if (!element) return;
      try {
        const [box, metrics] = await Promise.all([
          element.boundingBox(),
          element.evaluate(node => ({ width: node.offsetWidth, height: node.offsetHeight, borderX: node.clientLeft, borderY: node.clientTop })),
        ]);
        if (!box || !metrics.width || !metrics.height) return;
        x = box.x + (metrics.borderX + x) * box.width / metrics.width;
        y = box.y + (metrics.borderY + y) * box.height / metrics.height;
        viewport = await entry.page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      } catch { return; }
      finally { await element.dispose().catch(() => {}); }
    }
    if (entry.pointerGeneration !== generation || sequence < (entry.pointer?.sequence || 0) || !viewport?.width || !viewport?.height || x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) return;
    const actor = this.owner === 'manual' ? 'manual' : 'agent';
    const pointer = {
      sequence, phase: payload.phase, x, y, viewport, actor,
      label: String(payload.label || payload.tag || '页面区域').slice(0, 100),
      context: String(payload.context || '').slice(0, 100),
      button: payload.button, clickCount: payload.clickCount,
      time: Date.now(), lastClick: entry.pointer?.lastClick || null,
    };
    if (pointer.phase === 'down') pointer.lastClick = { sequence, x, y, viewport, actor, label: pointer.label, context: pointer.context, button: pointer.button, clickCount: pointer.clickCount, time: pointer.time };
    entry.pointer = pointer;
    this.emit('pointer', { type: 'pointer', tabId: entry.id, pointer });
    if (pointer.phase === 'down') this.log(actor, `点击 ${pointer.label}${pointer.context && pointer.context !== pointer.label ? ` · ${pointer.context}` : ''} (${Math.round(x)}, ${Math.round(y)})`);
  }
  log(kind, message) {
    this.events.push({ time: new Date().toISOString(), kind, message: String(message).slice(0, 250) });
    this.events = this.events.slice(-100);
    this.publish();
  }

  async updateStream() {
    for (const entry of this.pages.values()) {
      if (entry.cdp && (entry.id !== this.activeId || !this.streamClients)) {
        await entry.cdp.send('Page.stopScreencast').catch(() => {});
        await entry.cdp.detach().catch(() => {});
        entry.cdp = null;
      }
    }
    const entry = this.pages.get(this.activeId);
    if (!entry || !this.streamClients || entry.cdp) return;
    const cdp = await this.context.newCDPSession(entry.page);
    // Active tab may have changed while the CDP connection was being opened.
    if (entry.id !== this.activeId || !this.streamClients) { await cdp.detach(); return; }
    entry.cdp = cdp;
    cdp.on('Page.screencastFrame', frame => {
      cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
      if (entry.id === this.activeId) this.emit('frame', { type: 'frame', tabId: entry.id, data: frame.data, viewport: this.viewport });
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
  }

  assertOwner(actor) {
    if (actor === 'agent' && this.owner !== 'agent') throw new Error('用户已手动接管。等待用户点击“交还 Agent”后再操作。');
    if (actor === 'manual' && this.owner !== 'manual') throw new Error('请先点击“手动接管”');
  }

  run(action, args = {}, actor = 'agent') {
    // A modal can freeze the operation at the head of the queue. Its resolver
    // and state reads must remain available while that operation is waiting.
    if (action === 'state') return Promise.resolve(this.state());
    if (action === 'dialog') return this.handleDialog(args, actor);
    // Ownership changes must preempt an in-progress demo rather than queue behind it.
    if (action === 'control') {
      if (!['agent', 'manual'].includes(args.owner)) return Promise.reject(new Error('无效控制模式'));
      if (actor === 'agent' && args.owner === 'agent' && this.owner === 'manual') return Promise.reject(new Error('只有用户可以交还控制权'));
      this.owner = args.owner;
      for (const entry of this.pages.values()) { this.invalidateScreenshot(entry); entry.pointer = null; entry.pointerGeneration++; }
      this.log('control', this.owner === 'manual' ? '用户已接管，Agent 操作暂停' : '已交还 Agent');
      return Promise.resolve(this.state());
    }
    const blocked = [...this.pages.values()].find(entry => entry.liveDialog);
    if (blocked) return Promise.reject(new Error(`标签页 ${blocked.title}（${blocked.id}）正在等待 ${blocked.dialog.type} 弹窗处理。请调用 browser_handle_dialog；beforeunload 的 accept=false 表示留在此页，accept=true 表示离开。弹窗处理前不要重复点击或刷新。`));
    const generation = this.operationGeneration || 0;
    const operation = this.tail.then(async () => {
      if (generation !== (this.operationGeneration || 0)) throw new Error('弹窗处理后已取消积压操作，请重新读取当前页面，不要直接重试之前的点击。');
      const state = { interrupted: false };
      let interrupt;
      const dialogWait = new Promise((_, reject) => {
        interrupt = entry => { state.interrupted = true; reject(new Error(`网页弹窗 ${entry.dialog?.type || ''} 暂停了本次操作；请调用 browser_handle_dialog，处理后读取快照核对，不要盲目重复点击。`)); };
      });
      this.on('dialog-waiting', interrupt);
      try { return await Promise.race([this.execute(action, args, actor, state), dialogWait]); }
      finally { this.off('dialog-waiting', interrupt); }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }

  async handleDialog(args, actor) {
    this.assertOwner(actor);
    const entry = args.tabId ? this.pages.get(args.tabId) : (this.pages.get(this.activeId)?.liveDialog ? this.pages.get(this.activeId) : [...this.pages.values()].find(item => item.liveDialog));
    const pending = entry?.liveDialog;
    if (!pending) throw new Error('没有等待处理的对话框');
    if (args.accept) await pending.accept(String(args.text || '')); else await pending.dismiss();
    if (entry.liveDialog === pending) { entry.dialog = null; entry.liveDialog = null; }
    this.operationGeneration = (this.operationGeneration || 0) + 1;
    this.log(actor, `${args.accept ? '接受' : '取消'}网页弹窗 · ${entry.title}`);
    return this.state();
  }

  async snapshot() {
    const entry = this.activeEntry();
    await this.clearRefs(entry);
    const elements = [], frames = [], trees = [];
    let totalTargets = 0;
    const pageFrames = entry.page.frames();
    try {
      for (const frame of pageFrames.slice(0, 32)) {
        let metadata;
        try {
          metadata = await frameMetadata(frame, pageFrames);
          const bundle = await frame.locator('body').evaluateHandle(inspectDom, { firstRef: this.nextElementRef, limit: Math.min(180, Math.max(0, 720 - elements.length)) }, { timeout: 1500 });
          const payloadHandle = await bundle.getProperty('payload');
          const targetArray = await bundle.getProperty('targets');
          try {
            const payload = await payloadHandle.jsonValue();
            const handles = await targetArray.getProperties();
            this.nextElementRef += payload.elements.length;
            totalTargets += payload.totalTargets;
            for (const [index, descriptor] of payload.elements.entries()) {
              const handle = handles.get(String(index))?.asElement();
              if (!handle) throw new Error('页面在快照期间变化，请重新读取');
              entry.refs.set(descriptor.ref, { handle, descriptor, frame });
              const { fingerprint, ...element } = descriptor;
              const rect = frame.parentFrame() ? await handle.boundingBox() : element.rect;
              elements.push({ ...element, frameId: metadata.frameId, frameRect: element.rect, rect,
                inViewport: !!rect && rect.x + rect.width > 0 && rect.y + rect.height > 0 && rect.x < this.viewport.width && rect.y < this.viewport.height });
            }
            const tree = await frame.locator('body').ariaSnapshot({ timeout: 1500 });
            trees.push(`[frame=${metadata.frameId}]\n${tree.slice(0, 12000)}${tree.length > 12000 ? '\n[tree truncated]' : ''}`);
            frames.push({ ...metadata, readable: true, totalTargets: payload.totalTargets, truncated: payload.truncated });
          } finally { await Promise.all([bundle.dispose(), payloadHandle.dispose(), targetArray.dispose()]); }
        } catch (error) {
          // A loading/detached child should not hide controls in the other frames.
          if (frame === entry.page.mainFrame()) throw error;
          frames.push({ ...(metadata || { frameId: `f${pageFrames.indexOf(frame)}`, url: frame.url() }), readable: false, error: '子页面正在加载或已移除，请重新读取快照' });
        }
      }
      const tree = trees.join('\n\n');
      return {
        tabId: entry.id, url: entry.page.url(), title: await entry.page.title(),
        instructions: '仅使用本次明确标注的 ref；已包含可读取的跨域/嵌套 iframe。frameId 表示控件所属子页面，ref 可直接点击/填写，无需另传 frameId。rect 是主视口 CSS 坐标，frameRect 是子页面局部坐标。tree 顺序不是编号。课程标题与更多菜单是不同目标。每次新快照使旧 ref 失效；有截断或 unreadable 时请检查 frames。',
        targets: formatTargets(elements),
        elements, frames, totalTargets, truncated: elements.length < totalTargets || pageFrames.length > 32,
        tree: tree.slice(0, 24000), treeTruncated: tree.length > 24000 || trees.some(tree => tree.includes('[tree truncated]')),
      };
    } catch (error) { await this.clearRefs(entry); throw error; }
  }

  async clearRefs(entry) {
    const references = [...entry.refs.values()];
    entry.refs.clear();
    await Promise.all(references.map(reference => reference.handle?.dispose().catch(() => {})));
  }

  invalidateScreenshot(entry = this.activeEntry()) {
    entry.visualRevision++;
    entry.screenshot = null;
  }

  async resetVisualTracker(entry) {
    this.invalidateScreenshot(entry);
    for (const tracker of entry.visualTrackers.values()) {
      await tracker.evaluate(value => value.observer.disconnect()).catch(() => {});
      await tracker.dispose().catch(() => {});
    }
    entry.visualTrackers.clear();
  }

  async visualState(entry) {
    const frames = entry.page.frames();
    for (const [frame, tracker] of entry.visualTrackers) {
      if (!frames.includes(frame)) { await tracker.dispose().catch(() => {}); entry.visualTrackers.delete(frame); }
    }
    const states = [];
    for (const frame of frames) {
      let tracker = entry.visualTrackers.get(frame);
      if (!tracker || !(await tracker.evaluate(readVisualTracker).catch(() => null))?.connected) {
        await tracker?.dispose().catch(() => {});
        tracker = await frame.evaluateHandle(createVisualTracker);
        entry.visualTrackers.set(frame, tracker);
      }
      states.push(await tracker.evaluate(readVisualTracker));
    }
    return states;
  }

  async screenshot({ maxWidth } = {}) {
    if (maxWidth !== undefined && (!Number.isInteger(maxWidth) || maxWidth < 320 || maxWidth > 1920)) throw new Error('maxWidth 必须是 320–1920 的整数');
    const entry = this.activeEntry();
    const beforeFrames = await this.visualState(entry);
    const before = beforeFrames[0];
    const revision = entry.visualRevision;
    if (!before.connected) throw new Error('页面已变化，请重新截图');
    // Publishing a newer image always invalidates the previous image's ID.
    entry.screenshot = null;
    // Keep native screenshot device metrics intact. Normalize the captured
    // bitmap offscreen instead of asking the browser to emulate a smaller DPR.
    let buffer = await entry.page.screenshot({ fullPage: false, scale: 'device', caret: 'initial' });
    const original = pngDimensions(buffer);
    const width = Math.round(Math.min(maxWidth || before.width, before.width));
    const height = Math.round(before.height * width / before.width);
    if (original.width !== width || original.height !== height) {
      const resized = await entry.page.evaluate(resizeScreenshotInPage, { data: buffer.toString('base64'), width, height });
      buffer = Buffer.from(resized, 'base64');
    }
    const afterFrames = await this.visualState(entry);
    if (this.activeId !== entry.id || entry.visualRevision !== revision || JSON.stringify(beforeFrames) !== JSON.stringify(afterFrames)) {
      throw new Error('截图期间页面或 iframe 变化，请重新调用 browser_screenshot');
    }
    const dimensions = pngDimensions(buffer);
    const metadata = {
      screenshotId: `shot-${crypto.randomUUID()}`, tabId: entry.id,
      url: entry.page.url(), imageWidth: dimensions.width, imageHeight: dimensions.height,
      viewport: { width: before.width, height: before.height },
      scroll: { x: before.scrollX, y: before.scrollY },
      capturedAt: new Date().toISOString(),
      instructions: '坐标相对于这张截图的网页内容左上角，不含窗口、地址栏或侧栏。browser_click_at / browser_hover_at 必须携带此 screenshotId。image 使用实际图像像素；viewport 使用页面 CSS 像素；normalized 使用 0–1 比例（不含 1）。操作后重新截图。',
    };
    entry.screenshot = { ...metadata, visualState: afterFrames, visualRevision: revision, capturedTime: Date.now() };
    return { ...metadata, mimeType: 'image/png', data: buffer.toString('base64') };
  }

  async coordinateAction(action, args, actor) {
    const entry = this.activeEntry();
    const shot = entry.screenshot;
    if (!shot || args.screenshotId !== shot.screenshotId) throw new Error('截图编号已失效或不属于当前标签页，请重新调用 browser_screenshot');
    const current = await this.visualState(entry).catch(() => null);
    if (!current?.every(state => state.connected) || entry.visualRevision !== shot.visualRevision || JSON.stringify(current) !== JSON.stringify(shot.visualState) || Date.now() - shot.capturedTime > 120000) {
      this.invalidateScreenshot(entry);
      throw new Error('截图已过期：页面、滚动位置或视口已变化，请重新截图后定位');
    }
    const point = toViewportPoint(args, shot);
    const button = args.button ?? 'left';
    const clickCount = args.clickCount ?? 1;
    if (!['left', 'right', 'middle'].includes(button) || ![1, 2].includes(clickCount)) throw new Error('不支持的鼠标按钮或点击次数');
    const hit = await hitTestFrame(entry.page, point);
    this.assertOwner(actor);
    this.invalidateScreenshot(entry);
    if (action === 'click_at') await entry.page.mouse.click(point.x, point.y, { button, clickCount });
    else await entry.page.mouse.move(point.x, point.y);
    this.lastActionResult = {
      action, screenshotId: shot.screenshotId, tabId: entry.id,
      inputPoint: { x: args.x, y: args.y, coordinateSpace: args.coordinateSpace || 'image' },
      viewportPoint: point, ...hit,
      message: '已向独立浏览器发送鼠标事件；未移动系统鼠标。此截图编号已失效，请截图或读取 DOM 核对结果。',
    };
    this.log(actor, `${action} (${Math.round(point.x)}, ${Math.round(point.y)})`);
  }

  async locator(args) {
    if (args.ref) {
      const reference = this.activeEntry().refs.get(String(args.ref).replace(/^@/, ''));
      if (!reference) throw new Error('元素引用已失效或不属于当前标签页，请先调用 browser_snapshot');
      let current;
      try { current = await reference.handle.evaluate(inspectDom, { describeOnly: true }); } catch {}
      if (!current?.connected || current.fingerprint !== reference.descriptor.fingerprint) throw new Error('目标已移除或含义已改变，请重新调用 browser_snapshot，不会点击其他元素');
      return reference.handle;
    }
    if (!args.selector) throw new Error('需要 ref 或 selector');
    return this.activePage().locator(args.selector);
  }

  async typeText(args, actor) {
    const text = String(args.text ?? '');
    const delayMs = args.delayMs ?? 5;
    if (text.length > 500 || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 50) throw new Error('逐字输入每次最多 500 字符，delayMs 为 0–50；长文请分段输入并核对');
    const page = this.activePage();
    let element, disposable = false, typed = 0;
    const deadline = Date.now() + 30000;
    try {
      if (args.ref || args.selector) {
        element = await this.locator(args);
        if (args.selector) { element = await element.elementHandle(); disposable = true; }
        if (!(await element.evaluate(describeEditable)).editable) throw new Error('目标不是可输入编辑器，请重新读取快照');
        await element.scrollIntoViewIfNeeded();
        await element.focus();
      } else {
        ({ element } = await focusedEditable(page));
        disposable = true;
      }
      const descriptor = await element.evaluate(describeEditable);
      if (!descriptor.editable) throw new Error('当前焦点不是可输入编辑器，请点击编辑器或提供 ref；不会把文本发往页面其他区域');
      for (const character of text.replace(/\r\n?/g, '\n')) {
        this.assertOwner(actor);
        if (Date.now() > deadline) throw new Error('本段输入已达到 30 秒，请核对后分段继续');
        const focused = await element.evaluate(node => node.isConnected && document.hasFocus() && (document.activeElement === node || node.contains(document.activeElement)));
        if (!focused || !(await element.evaluate(describeEditable)).editable) throw new Error('编辑器焦点或状态已变化，请检查已输入内容后继续');
        this.assertOwner(actor);
        if (character === '\n') await page.keyboard.press('Enter');
        else await page.keyboard.type(character);
        typed++;
        if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      this.lastActionResult = { action: 'type', target: { ref: args.ref, tag: descriptor.tag, label: descriptor.label }, charactersTyped: typed, message: '已逐字符向独立浏览器发送输入，不使用系统键盘或剪贴板。请读取快照核对内容和网站保存状态。' };
    } catch (error) { throw new Error(`${error.message}（本次已发送 ${typed} 字符，重试前请核对，避免重复输入）`); }
    finally { if (disposable) await element?.dispose().catch(() => {}); }
  }

  async execute(action, args, actor, operationState = {}) {
    const readOnly = ['state', 'snapshot', 'screenshot'];
    const uiManagement = ['new_tab', 'close_tab', 'activate_tab', 'viewport', 'demo'];
    if (!readOnly.includes(action) && !(actor === 'ui' && uiManagement.includes(action))) this.assertOwner(actor);
    if (action === 'state') return this.state();
    if (action === 'snapshot') return this.snapshot();
    if (action === 'screenshot') return this.screenshot(args);
    if (action === 'new_tab') {
      this.invalidateScreenshot();
      const page = await this.context.newPage();
      const id = await this.attachPage(page);
      this.activeId = id;
      if (args.url) await page.goto(normalizeUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this.updateStream();
      this.publish();
      return this.state();
    }
    if (action === 'activate_tab') {
      if (!this.pages.has(args.tabId)) throw new Error('标签页不存在');
      this.invalidateScreenshot();
      this.activeId = args.tabId;
      this.invalidateScreenshot();
      await this.updateStream(); this.publish(); return this.state();
    }
    if (action === 'close_tab') {
      const entry = this.pages.get(args.tabId || this.activeId);
      if (!entry) throw new Error('标签页不存在');
      if (this.pages.size === 1) throw new Error('请保留至少一个标签页');
      await entry.page.close(); await this.updateStream(); return this.state();
    }
    if (action === 'viewport') {
      for (const entry of this.pages.values()) { this.invalidateScreenshot(entry); entry.pointer = null; entry.pointerGeneration++; }
      this.viewport = { width: Math.min(1920, Math.max(640, Number(args.width) || 1280)), height: Math.min(1080, Math.max(480, Number(args.height) || 800)) };
      await Promise.all([...this.pages.values()].map(e => e.page.setViewportSize(this.viewport)));
      this.publish(); return this.state();
    }
    if (action === 'demo') return this.demo();
    const page = this.activePage();
    if (!['click_at', 'hover_at'].includes(action)) this.invalidateScreenshot();
    switch (action) {
      case 'navigate': await page.goto(normalizeUrl(args.url), { waitUntil: 'domcontentloaded', timeout: 30000 }); break;
      case 'back': await page.goBack({ waitUntil: 'domcontentloaded' }); break;
      case 'forward': await page.goForward({ waitUntil: 'domcontentloaded' }); break;
      case 'reload': await page.reload({ waitUntil: 'domcontentloaded' }); break;
      case 'click': {
        const target = await this.locator(args);
        const descriptor = await target.evaluate(inspectDom, { describeOnly: true });
        await target.click();
        this.lastActionResult = { action: 'click', target: { ref: args.ref, kind: descriptor.kind, label: descriptor.label, context: descriptor.context }, message: '已对上述目标执行点击；是否达到目的请检查新快照，不能把点击成功当作已进入目标页面。' };
        break;
      }
      case 'fill': await (await this.locator(args)).fill(String(args.text ?? '')); break;
      case 'type': await this.typeText(args, actor); break;
      case 'click_at': case 'hover_at': await this.coordinateAction(action, args, actor); break;
      case 'press': await page.keyboard.press(String(args.key)); break;
      case 'scroll': await page.mouse.wheel(Number(args.x) || 0, Number(args.y) || 600); break;
      case 'input': await this.input(args); break;
      default: throw new Error(`未知操作：${action}`);
    }
    if (operationState.interrupted) return this.state();
    if (action !== 'input') this.log(actor, `${action}${args.ref ? ` @${args.ref}` : ''}`);
    await this.refresh(this.activeEntry());
    const result = this.state();
    if (['click', 'click_at', 'hover_at', 'type'].includes(action)) result.actionResult = this.lastActionResult;
    return result;
  }

  async input(args) {
    const page = this.activePage();
    const x = Math.max(0, Math.min(this.viewport.width - 1, Number(args.x) || 0));
    const y = Math.max(0, Math.min(this.viewport.height - 1, Number(args.y) || 0));
    switch (args.kind) {
      case 'click': await page.mouse.click(x, y, { button: args.button === 'right' ? 'right' : 'left', clickCount: args.count === 2 ? 2 : 1 }); break;
      case 'wheel': await page.mouse.move(x, y); await page.mouse.wheel(Number(args.deltaX) || 0, Number(args.deltaY) || 0); break;
      case 'text': await page.keyboard.insertText(String(args.text || '')); break;
      case 'key': await page.keyboard.press(String(args.key)); break;
      default: throw new Error('不支持的输入事件');
    }
  }

  async demo() {
    this.assertOwner('agent');
    const page = this.activePage();
    const step = async (message, fn) => {
      this.assertOwner('agent');
      this.invalidateScreenshot();
      this.log('demo', message);
      await fn();
      await new Promise(resolve => setTimeout(resolve, 700));
    };
    await step('1/5 打开演示页面', () => page.goto(this.demoUrl));
    await step('2/5 通过 DOM 找到姓名输入框', () => page.getByLabel('姓名').fill('Hermes 浏览器助手'));
    await step('3/5 输入中文任务说明', () => page.getByLabel('任务说明').fill('我正在独立浏览器里操作，你可以继续在左边打字。'));
    await step('4/5 点击保存按钮', () => page.getByRole('button', { name: '保存任务' }).click());
    await step('5/5 读取完成结果', async () => { this.log('demo', await page.locator('#result').innerText()); });
    return this.snapshot();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.all([...this.pages.values()].map(entry => this.clearRefs(entry)));
    await Promise.all([...this.pages.values()].map(entry => this.resetVisualTracker(entry)));
    await this.context?.close();
  }
}
