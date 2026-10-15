import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BrowserService } from './browser.mjs';
import { ROOT, RUNTIME, CONNECTION, PORT, VERSION } from './paths.mjs';
import { adapterStatus, changeAdapter, mcpEntry } from './adapter.mjs';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export async function createModServer({ port = PORT, runtimeDir = RUNTIME, profile, hermesHome, deviceScaleFactor } = {}) {
  const origin = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('hex');
  const browser = new BrowserService({ profile, demoUrl: `${origin}/demo.html`, deviceScaleFactor });
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: 65536 });
  let cachedFrame = null;
  let closing = false;
  const embedTickets = new Map();
  const embedSessions = new Map();
  const json = (res, status, data) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); };
  const embedAuthorized = req => {
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    const query = new URL(req.url, origin).searchParams.get('embedSession');
    return [bearer, query].some(value => value && embedSessions.get(value) > Date.now());
  };
  const authorized = req => req.headers.authorization === `Bearer ${token}` || (req.headers.cookie || '').split(';').some(cookie => cookie.trim() === `hbm_session=${token}`) || embedAuthorized(req);
  const allowedHost = req => [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host);
  const allowedOrigin = req => !req.headers.origin || req.headers.origin === origin || req.headers.origin === `http://localhost:${port}`;
  async function body(req) {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Error('请求过大'); }
    return JSON.parse(data || '{}');
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHost(req) || !allowedOrigin(req)) return json(res, 403, { error: '来源不匹配' });
      const url = new URL(req.url, origin);
      if (url.pathname === '/health') return json(res, 200, { ok: true, app: 'hermes-browser-mod', version: VERSION, ready: !!browser.context });
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(req)) return json(res, 401, { error: '连接未授权，请重新打开 demo' });
        if (embedAuthorized(req) && !['/api/state', '/api/ui'].includes(url.pathname)) return json(res, 403, { error: '嵌入视图仅允许页面状态与手动控制' });
        if (req.method === 'POST' && url.pathname === '/api/embed-ticket') {
          for (const [key, expiry] of embedTickets) if (expiry < Date.now()) embedTickets.delete(key);
          for (const [key, expiry] of embedSessions) if (expiry < Date.now()) embedSessions.delete(key);
          const ticket = crypto.randomBytes(24).toString('hex');
          embedTickets.set(ticket, Date.now() + 60000);
          return json(res, 200, { embedUrl: `${origin}/?embedded=1&ticket=${ticket}` });
        }
        if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, { ...browser.state(), version: VERSION, origin });
        if (req.method === 'GET' && url.pathname === '/api/integration') return json(res, 200, { ...await adapterStatus(hermesHome), mcp: mcpEntry() });
        if (req.method !== 'POST') return json(res, 405, { error: '不支持的请求方法' });
        const input = await body(req);
        if (url.pathname === '/api/action' || url.pathname === '/api/ui') {
          const actor = url.pathname === '/api/ui' ? (input.action === 'input' ? 'manual' : 'ui') : 'agent';
          return json(res, 200, await browser.run(input.action, input.args || {}, actor));
        }
        if (url.pathname === '/api/integration') return json(res, 200, await changeAdapter(input.mode, hermesHome));
        if (url.pathname === '/api/stop') {
          json(res, 200, { ok: true });
          setTimeout(() => close().then(() => { if (direct) process.exit(0); }), 100);
          return;
        }
        return json(res, 404, { error: '接口不存在' });
      }
      const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/preview-geometry.js': 'preview-geometry.js', '/style.css': 'style.css', '/embedded.css': 'embedded.css', '/demo.html': 'demo.html' };
      const file = files[url.pathname];
      if (!file) return json(res, 404, { error: '页面不存在' });
      let contents = await fs.readFile(path.join(PUBLIC, file));
      if (file === 'index.html' && url.searchParams.has('ticket')) {
        const ticket = url.searchParams.get('ticket');
        if (!(embedTickets.get(ticket) > Date.now())) return json(res, 401, { error: '嵌入连接已过期，请重新连接' });
        embedTickets.delete(ticket);
        const session = crypto.randomBytes(32).toString('hex');
        embedSessions.set(session, Date.now() + 24 * 60 * 60 * 1000);
        contents = Buffer.from(contents.toString().replace('<head>', `<head><script>window.__HBM_EMBED_SESSION__=${JSON.stringify(session)};</script>`));
      }
      const headers = { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
      if (file === 'index.html') headers['set-cookie'] = `hbm_session=${token}; HttpOnly; SameSite=Strict; Path=/`;
      res.writeHead(200, headers); res.end(contents);
    } catch (error) { json(res, 400, { error: error.message }); }
  });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, origin).pathname !== '/stream' || !allowedHost(req) || !allowedOrigin(req) || !authorized(req)) { socket.destroy(); return; }
    wsServer.handleUpgrade(req, socket, head, client => wsServer.emit('connection', client));
  });
  let streamChange = Promise.resolve();
  const updateClients = () => {
    browser.streamClients = wsServer.clients.size;
    streamChange = streamChange.then(() => browser.updateStream()).catch(error => browser.log('error', error.message));
  };
  wsServer.on('connection', client => {
    client.send(JSON.stringify({ type: 'state', ...browser.state(), version: VERSION }));
    if (cachedFrame?.tabId === browser.activeId) client.send(JSON.stringify(cachedFrame));
    updateClients();
    client.on('close', updateClients);
  });
  browser.on('state', state => {
    const message = JSON.stringify({ type: 'state', ...state, version: VERSION });
    for (const client of wsServer.clients) if (client.readyState === 1) client.send(message);
  });
  browser.on('frame', frame => {
    cachedFrame = frame;
    const message = JSON.stringify(frame);
    for (const client of wsServer.clients) if (client.readyState === 1 && client.bufferedAmount < 1_000_000) client.send(message);
  });
  browser.on('pointer', event => {
    if (event.tabId !== browser.activeId) return;
    const message = JSON.stringify(event);
    for (const client of wsServer.clients) if (client.readyState === 1) client.send(message);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  try { await browser.start(); } catch (error) { server.close(); await browser.close().catch(() => {}); throw error; }
  await fs.mkdir(runtimeDir, { recursive: true });
  const connectionPath = path.join(runtimeDir, 'connection.json');
  await fs.writeFile(connectionPath, JSON.stringify({ origin, token, pid: process.pid, version: VERSION, startedAt: new Date().toISOString() }, null, 2));

  async function close() {
    if (closing) return;
    closing = true;
    for (const client of wsServer.clients) client.close();
    await browser.close();
    wsServer.close();
    await new Promise(resolve => server.close(resolve));
    try {
      const current = JSON.parse(await fs.readFile(connectionPath, 'utf8'));
      if (current.token === token) await fs.unlink(connectionPath);
    } catch (error) { if (error.code !== 'ENOENT') console.error(error.message); }
  }
  return { origin, token, server, browser, close };
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  try {
    const mod = await createModServer();
    console.log(`Hermes Browser Mod V${VERSION} ready: ${mod.origin}`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => mod.close().then(() => process.exit(0)));
  } catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
