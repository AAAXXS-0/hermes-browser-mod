import { previewGeometry, viewportToPreview, previewToViewport } from './preview-geometry.js';

if (new URLSearchParams(location.search).get('embedded') === '1') document.documentElement.classList.add('embedded');
let embedSession = window.__HBM_EMBED_SESSION__ || null;
if (document.documentElement.classList.contains('embedded')) {
  try {
    if (embedSession) sessionStorage.setItem('hbm-embed-session', embedSession);
    else embedSession = sessionStorage.getItem('hbm-embed-session');
  } catch {}
  const url = new URL(location.href);
  if (url.searchParams.has('ticket')) { url.searchParams.delete('ticket'); history.replaceState(null, '', url); }
}

const $ = id => document.getElementById(id);
let state = null;
let socket;
let toastTimer;
let reconnectTimer;
let lastFrame = 0;
let latestFrame = null;
let rendering = false;
let stopped = false;
let demoRunning = false;
let displayedFrame = null;
let remotePointer = null;
let clickSequence = 0;
let pointerEnabled = localStorage.getItem('hbm-pointer-visible') !== 'false';
let embeddedFrameReported = false;

function frameGeometry(viewport = displayedFrame?.viewport || state?.viewport) {
  const rect = $('screen').getBoundingClientRect();
  return viewport ? previewGeometry(rect, { width: $('frame').naturalWidth, height: $('frame').naturalHeight }, viewport) : null;
}

function renderPointer() {
  const visible = pointerEnabled && remotePointer && displayedFrame?.tabId === state?.activeId && !$('frame').hidden && remotePointer.viewport.width === displayedFrame.viewport.width && remotePointer.viewport.height === displayedFrame.viewport.height;
  $('pointer-layer').hidden = !visible;
  $('pointer-toggle').textContent = pointerEnabled ? '指针：开' : '指针：关';
  $('pointer-toggle').setAttribute('aria-pressed', String(pointerEnabled));
  const lastClick = remotePointer?.lastClick;
  $('pointer-caption').textContent = lastClick ? `最近点击：${lastClick.label}${lastClick.context && lastClick.context !== lastClick.label ? ` · ${lastClick.context}` : ''} (${Math.round(lastClick.x)}, ${Math.round(lastClick.y)})` : remotePointer ? `${remotePointer.actor === 'manual' ? '你' : 'Agent'} 指针 (${Math.round(remotePointer.x)}, ${Math.round(remotePointer.y)})` : '等待鼠标操作';
  $('pointer-caption').title = $('pointer-caption').textContent;
  if (!visible) return;
  const geometry = frameGeometry(remotePointer.viewport);
  const point = viewportToPreview(remotePointer, geometry);
  if (!point) { $('pointer-layer').hidden = true; return; }
  $('remote-cursor').hidden = false;
  $('remote-cursor').style.left = `${point.x}px`; $('remote-cursor').style.top = `${point.y}px`;
  $('pointer-layer').classList.toggle('manual-pointer', remotePointer.actor === 'manual');
  $('cursor-label').textContent = remotePointer.actor === 'manual' ? '你' : 'Agent';
  const clicked = lastClick && viewportToPreview(lastClick, geometry);
  $('click-marker').hidden = !clicked;
  if (clicked) {
    $('click-marker').style.left = `${clicked.x}px`; $('click-marker').style.top = `${clicked.y}px`;
    if (lastClick.sequence !== clickSequence) {
      clickSequence = lastClick.sequence;
      const ring = $('click-marker').querySelector('.click-ring');
      ring.getAnimations().forEach(animation => animation.cancel());
      if (Date.now() - lastClick.time < 1800) ring.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 0 }], { duration: 900, iterations: 2 });
    }
  }
}
$('pointer-toggle').onclick = () => { pointerEnabled = !pointerEnabled; localStorage.setItem('hbm-pointer-visible', String(pointerEnabled)); renderPointer(); };
new ResizeObserver(() => renderPointer()).observe($('screen'));
$('frame').onload = () => renderPointer();

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

async function api(path, data) {
  const headers = { ...(embedSession ? { authorization: `Bearer ${embedSession}` } : {}) };
  const response = await fetch(`/api/${path}`, data === undefined ? { headers } : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function action(actionName, args = {}) {
  try { return await api('ui', { action: actionName, args }); }
  catch (error) { toast(error.message, true); throw error; }
}
function fire(actionName, args) { action(actionName, args).catch(() => {}); }
function render(next) {
  const switched = state?.activeId && state.activeId !== next.activeId;
  state = next;
  if (switched) { $('frame').hidden = true; $('screen-placeholder').hidden = false; latestFrame = null; displayedFrame = null; }
  remotePointer = next.pointer || null;
  renderPointer();
  const manual = state.owner === 'manual';
  $('control').textContent = manual ? '交还 Agent' : '手动接管';
  $('control').classList.toggle('manual', manual);
  $('screen').classList.toggle('manual', manual);
  $('owner-label').textContent = manual ? '● 用户手动控制中' : '● Agent 控制中';
  $('owner-label').style.color = manual ? 'var(--amber)' : 'var(--mint)';
  $('version').textContent = `V${state.version || '1.6.0'}`;
  const tab = state.tabs.find(t => t.id === state.activeId);
  if (document.activeElement !== $('address')) $('address').value = tab?.url || '';
  $('tab-label').textContent = `${state.tabs.length} 个标签页 · ${state.activeId}`;
  $('tabs').replaceChildren();
  for (const item of state.tabs) {
    const tabButton = document.createElement('button');
    tabButton.className = `tab${item.id === state.activeId ? ' active' : ''}`;
    tabButton.title = item.url;
    const title = document.createElement('span'); title.className = 'tab-name'; title.textContent = item.title || '新标签页';
    const close = document.createElement('span'); close.className = 'tab-close'; close.textContent = '×'; close.setAttribute('aria-label', '关闭标签页');
    close.addEventListener('click', event => { event.stopPropagation(); fire('close_tab', { tabId: item.id }); });
    tabButton.append(title, close); tabButton.addEventListener('click', () => fire('activate_tab', { tabId: item.id })); $('tabs').append(tabButton);
  }
  const add = document.createElement('button'); add.className = 'new-tab'; add.textContent = '+'; add.title = '新建标签页'; add.setAttribute('aria-label', '新建标签页'); add.onclick = () => fire('new_tab', { url: `${location.origin}/demo.html` }); $('tabs').append(add);
  $('events').replaceChildren();
  for (const event of state.events.slice(-18)) {
    const row = document.createElement('div'); row.className = `event ${event.kind}`;
    const time = document.createElement('time'); time.textContent = new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false });
    const text = document.createElement('p'); text.textContent = event.message;
    row.append(time, text); $('events').append(row);
  }
  $('events').scrollTop = $('events').scrollHeight;
  $('activity-status').textContent = demoRunning ? '自动演示运行中' : manual ? '手动接管中' : '已连接';
  const dialogTab = tab?.dialog ? tab : state.tabs.find(item => item.dialog);
  $('dialog-bar').hidden = !dialogTab;
  if (dialogTab) {
    const leaving = dialogTab.dialog.type === 'beforeunload';
    $('dialog-message').textContent = `${dialogTab.title}：${dialogTab.dialog.message || (leaving ? '网页正在确认是否离开。留在此页可保留当前页面；离开可能丢失未保存内容。' : '网页等待处理弹窗，页面操作暂停。')}`;
    $('dialog-bar').dataset.tabId = dialogTab.id;
    $('dialog-dismiss').textContent = leaving ? '留在此页' : '取消';
    $('dialog-accept').textContent = leaving ? '离开此页' : '确定';
  }
}

async function drawFrames() {
  if (rendering) return;
  rendering = true;
  while (latestFrame) {
    const frame = latestFrame; latestFrame = null;
    const image = new Image();
    await new Promise(resolve => { image.onload = resolve; image.onerror = resolve; image.src = `data:image/jpeg;base64,${frame.data}`; });
    if (frame.tabId === state?.activeId && image.naturalWidth) {
      $('frame').src = image.src; $('frame').hidden = false; $('screen-placeholder').hidden = true;
      displayedFrame = frame;
      renderPointer();
      lastFrame = Date.now(); $('frame-status').textContent = '实时画面';
      if (!embeddedFrameReported && document.documentElement.classList.contains('embedded') && window.parent !== window) {
        embeddedFrameReported = true;
        window.parent.postMessage({ type: 'hbm-frame-ready' }, '*');
      }
    }
  }
  rendering = false;
}

function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/stream${embedSession ? `?embedSession=${encodeURIComponent(embedSession)}` : ''}`);
  socket.onopen = () => { $('connection').classList.remove('off'); $('connection').innerHTML = '<i></i>浏览器已连接'; };
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'state') render(message);
    if (message.type === 'frame') { latestFrame = message; drawFrames(); }
    if (message.type === 'pointer' && message.tabId === state?.activeId) { remotePointer = message.pointer; renderPointer(); }
  };
  socket.onclose = () => {
    $('connection').classList.add('off'); $('connection').innerHTML = '<i></i>连接已断开';
    $('frame-status').textContent = '连接中断';
    remotePointer = null; renderPointer();
    if (!stopped) reconnectTimer = setTimeout(connect, 2000);
  };
}

$('navigation').onsubmit = event => { event.preventDefault(); $('address').blur(); fire('navigate', { url: $('address').value }); };
for (const name of ['back', 'forward', 'reload']) $(name).onclick = () => fire(name);
document.querySelectorAll('[data-url]').forEach(button => button.onclick = () => fire('navigate', { url: button.dataset.url === 'demo' ? `${location.origin}/demo.html` : button.dataset.url }));
$('open-demo').onclick = () => fire('navigate', { url: `${location.origin}/demo.html` });
$('control').onclick = () => fire('control', { owner: state?.owner === 'manual' ? 'agent' : 'manual' });
$('viewport').onchange = () => { const [width, height] = $('viewport').value.split(',').map(Number); fire('viewport', { width, height }); };
$('run-demo').onclick = async () => {
  if (demoRunning) return;
  demoRunning = true; $('run-demo').disabled = true; $('run-demo').textContent = '◌ 演示运行中';
  try { await action('demo'); toast('演示完成。你也可以手动接管，修改右侧表单。'); }
  catch {} finally { demoRunning = false; $('run-demo').disabled = false; $('run-demo').textContent = '▶ 再运行一次演示'; if (state) render(state); }
};
$('scratchpad').value = localStorage.getItem('hbm-scratchpad') || '';
function saveScratchpad() { $('char-count').textContent = `${$('scratchpad').value.length} 字`; localStorage.setItem('hbm-scratchpad', $('scratchpad').value); }
$('scratchpad').oninput = saveScratchpad; saveScratchpad();

function point(event) {
  const rect = $('screen').getBoundingClientRect();
  return previewToViewport({ x: event.clientX - rect.left, y: event.clientY - rect.top }, frameGeometry());
}
$('screen').onclick = event => {
  if (event.target === $('input-capture')) return;
  if (state?.owner !== 'manual') { toast('点击“手动接管”后，即可操作网页'); return; }
  const p = point(event); if (!p) return;
  fire('input', { kind: 'click', ...p, count: event.detail > 1 ? 2 : 1 });
  $('input-capture').focus({ preventScroll: true });
};
$('screen').addEventListener('wheel', event => {
  if (state?.owner !== 'manual') return;
  const p = point(event); if (!p) return;
  event.preventDefault(); fire('input', { kind: 'wheel', ...p, deltaX: event.deltaX, deltaY: event.deltaY });
}, { passive: false });
$('input-capture').addEventListener('input', event => {
  if (event.isComposing) return;
  if (state?.owner === 'manual' && $('input-capture').value) fire('input', { kind: 'text', text: $('input-capture').value });
  $('input-capture').value = '';
});
$('input-capture').onkeydown = event => {
  if (event.isComposing || event.key === 'Process' || state?.owner !== 'manual') return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') return;
  const control = event.key.length > 1 && !['Shift', 'Control', 'Alt', 'Meta', 'Dead'].includes(event.key);
  if (control || event.ctrlKey || event.metaKey || event.altKey) {
    event.preventDefault();
    const modifiers = [event.ctrlKey || event.metaKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : ''].filter(Boolean);
    const key = event.key === ' ' ? 'Space' : event.key;
    fire('input', { kind: 'key', key: [...modifiers, key].join('+') });
  }
};
$('dialog-dismiss').onclick = () => fire('dialog', { accept: false, tabId: $('dialog-bar').dataset.tabId });
$('dialog-accept').onclick = () => fire('dialog', { accept: true, tabId: $('dialog-bar').dataset.tabId });

document.querySelectorAll('[data-workspace]').forEach(button => button.onclick = () => {
  document.querySelectorAll('[data-workspace]').forEach(b => b.classList.toggle('selected', b === button));
  $('demo-workspace').hidden = button.dataset.workspace !== 'demo'; $('hermes-workspace').hidden = button.dataset.workspace !== 'hermes';
});
$('dashboard-url').value = localStorage.getItem('hbm-dashboard-url') || '';
$('dashboard-load').onclick = () => {
  try {
    const url = new URL($('dashboard-url').value);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('初版只接入本地 Hermes Dashboard 地址');
    $('dashboard-frame').src = url.href; $('dashboard-frame').hidden = false; localStorage.setItem('hbm-dashboard-url', url.href);
    toast('Dashboard 连接已提交。若页面拒绝嵌入，请继续使用原 Hermes 窗口。');
  } catch (error) { toast(error.message, true); }
};

async function integration() {
  try {
    const data = await api('integration');
    $('integration-state').textContent = `${data.connected ? '✓ 本项目 MCP 已写入 Hermes 配置' : '尚未启用本项目 MCP'}\n${data.home}`;
    $('mcp-config').textContent = JSON.stringify({ mcp_servers: { 'hermes-browser-mod': data.mcp } }, null, 2);
    $('adapter-connect').disabled = data.connected || data.available === false;
    $('adapter-disconnect').disabled = !data.hasEntry;
  } catch (error) { $('integration-state').textContent = error.message; }
}
for (const id of ['integration-open', 'integration-open-2']) $(id).onclick = () => { $('integration-dialog').showModal(); integration(); };
$('integration-close').onclick = () => $('integration-dialog').close();
for (const mode of ['connect', 'disconnect']) $(`adapter-${mode}`).onclick = async () => {
  try {
    await api('integration', { mode }); await integration();
    toast(mode === 'connect' ? '已启用。请在 Hermes 重新加载 MCP，或在方便时重启内核。' : '已撤销。请重新加载 MCP 以移除已加载工具。');
  } catch (error) { toast(error.message, true); }
};
$('stop').onclick = async () => {
  try { await api('stop', {}); stopped = true; clearTimeout(reconnectTimer); toast('服务已停止，可关闭此窗口。双击“启动 demo.cmd”可再次启动。'); }
  catch (error) { toast(error.message, true); }
};
setInterval(() => { if (socket?.readyState === 1 && lastFrame && Date.now() - lastFrame > 5000) $('frame-status').textContent = '页面静止'; }, 1000);
window.addEventListener('beforeunload', () => { stopped = true; socket?.close(); });
connect();
