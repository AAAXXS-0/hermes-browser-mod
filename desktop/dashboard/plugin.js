/* Hermes CN Dashboard SDK 1.1.0. No host bundle or agent-core changes. */
(function () {
  const SDK = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!SDK?.React || !registry?.registerSlot) throw new Error('需要 Hermes CN Dashboard 插件 SDK');
  const React = SDK.React;
  const h = React.createElement;
  const ID = 'hermes-browser-mod';
  function preference(key, fallback) { try { return JSON.parse(localStorage.getItem(`${ID}:${key}`)) ?? fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(`${ID}:${key}`, JSON.stringify(value)); } catch {} }
  async function api(action, method = 'GET') {
    const response = await SDK.authedFetch(`/api/plugins/${ID}/${action}`, { method });
    const result = await response.json();
    if (response.status === 404) throw new Error('首次安装后，请重启一次 Hermes 桌面端以加载浏览器插件。');
    if (!response.ok) throw new Error(result.detail || result.error || `HTTP ${response.status}`);
    return result;
  }
  function BrowserView({ onClose }) {
    const [connection, setConnection] = React.useState(null);
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(true);
    const mounted = React.useRef(true);
    const connect = React.useCallback(async () => {
      setBusy(true); setError('');
      try { const next = await api('start', 'POST'); if (mounted.current) setConnection(next); }
      catch (e) { if (mounted.current) setError(e.message); }
      finally { if (mounted.current) setBusy(false); }
    }, []);
    React.useEffect(() => { mounted.current = true; connect(); return () => { mounted.current = false; }; }, [connect]);
    const frame = connection?.running && h('iframe', { className: 'hbm-frame', title: 'Hermes 浏览器', src: connection.embedUrl || `${connection.origin}/?embedded=1`, referrerPolicy: 'no-referrer' });
    return h(React.Fragment, null,
      h('div', { className: 'hbm-bar' }, h('strong', null, '浏览器'), connection?.version && h('span', null, `V${connection.version}`),
        h('button', { className: 'hbm-button', disabled: busy, onClick: connect }, busy ? '连接中…' : '重新连接'),
        onClose && h('button', { className: 'hbm-button', onClick: onClose, 'aria-label': '收起浏览器' }, '收起')),
      error && h('div', { className: 'hbm-empty', role: 'alert' }, h('p', { className: 'hbm-error' }, error), h('button', { className: 'hbm-button', onClick: connect, disabled: busy }, '重试')),
      frame || !error && h('div', { className: 'hbm-empty' }, busy ? '正在连接独立浏览器…' : '浏览器尚未连接'));
  }
  function ChatDock() {
    const anchor = React.useRef(null);
    const [open, setOpen] = React.useState(() => preference('open', true));
    const [width, setWidth] = React.useState(() => preference('width', 560));
    const [bounds, setBounds] = React.useState({ width: 1200 });
    const actualWidth = Math.min(Math.max(320, width), Math.max(320, bounds.width - 360));
    const narrow = bounds.width < 760;
    React.useEffect(() => { save('open', open); save('width', width); }, [open, width]);
    React.useEffect(() => {
      const root = anchor.current?.parentElement;
      if (!root) return;
      const observer = new ResizeObserver(([entry]) => setBounds({ width: entry.contentRect.width + parseFloat(getComputedStyle(root).paddingRight || 0) }));
      observer.observe(root);
      return () => observer.disconnect();
    }, []);
    React.useLayoutEffect(() => {
      const root = anchor.current?.parentElement;
      if (!root || !open) return;
      const previous = { position: root.style.position, paddingRight: root.style.paddingRight, boxSizing: root.style.boxSizing };
      root.style.position = 'relative'; root.style.boxSizing = 'border-box'; root.style.paddingRight = narrow ? previous.paddingRight : `${actualWidth + 12}px`;
      return () => { Object.assign(root.style, previous); };
    }, [open, actualWidth, narrow]);
    const resize = event => {
      event.currentTarget.setPointerCapture(event.pointerId);
      const start = event.clientX, initial = actualWidth;
      const move = e => setWidth(Math.min(960, Math.max(320, initial + start - e.clientX)));
      const target = event.currentTarget;
      const end = () => { target.removeEventListener('pointermove', move); };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', () => { target.removeEventListener('pointermove', move); }, { once: true });
      target.addEventListener('lostpointercapture', end, { once: true });
    };
    return h('div', { className: 'hbm-slot', ref: anchor },
      h('button', { className: 'hbm-button', onClick: () => setOpen(!open), 'aria-expanded': open }, open ? '浏览器已展开' : '打开浏览器'),
      open && h('aside', { className: 'hbm-dock', 'aria-label': '浏览器侧栏', style: { width: narrow ? '100%' : actualWidth, top: narrow ? 34 : 0 } },
        !narrow && h('div', { className: 'hbm-resizer', onPointerDown: resize, role: 'separator', 'aria-label': '调整浏览器宽度', 'aria-orientation': 'vertical' }),
        h(BrowserView, { onClose: () => setOpen(false) })));
  }
  function BrowserPage() { return h('div', { className: 'hbm-page' }, h(BrowserView, {})); }
  registry.register(ID, BrowserPage);
  registry.registerSlot(ID, 'chat:top', ChatDock);
})();
