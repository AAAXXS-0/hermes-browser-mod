import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, RUNTIME, ORIGIN, CONNECTION, VERSION, readConnection } from './paths.mjs';

export async function ensureRunning() {
  try {
    const connection = await readConnection();
    const response = await fetch(`${connection.origin}/health`, { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    if (health.app === 'hermes-browser-mod' && health.ready) {
      if (health.version !== VERSION) {
        const error = new Error(`后台浏览器仍是 V${health.version || '未知'}，当前 MCP 为 V${VERSION}。请在方便时停止 / 启动 demo，再重新加载 Hermes MCP；当前页面未被自动关闭。`);
        error.code = 'HBM_VERSION_MISMATCH';
        throw error;
      }
      return connection;
    }
  } catch (error) { if (error.code === 'HBM_VERSION_MISMATCH') throw error; }
  await fs.mkdir(RUNTIME, { recursive: true });
  const { openSync, closeSync } = await import('node:fs');
  const logFd = openSync(path.join(RUNTIME, 'service.log'), 'a');
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.mjs')], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', logFd, logFd], env: process.env,
  });
  child.unref(); closeSync(logFd);
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      const response = await fetch(`${ORIGIN}/health`, { signal: AbortSignal.timeout(500) });
      const health = await response.json();
      if (health.app === 'hermes-browser-mod' && health.ready) return await readConnection();
    } catch {}
  }
  throw new Error(`浏览器服务未启动。请查看 ${path.join(RUNTIME, 'service.log')}`);
}

async function openWindow(origin) {
  const candidates = [process.env.HBM_BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean);
  for (const binary of candidates) {
    try { await fs.access(binary); } catch { continue; }
    const child = spawn(binary, [`--app=${origin}`, `--user-data-dir=${path.join(RUNTIME, 'ui-profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1500,980'], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    console.log(`已打开独立伴随窗口：${origin}`);
    return;
  }
  console.log(`请用浏览器打开 ${origin}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'src', 'launcher.mjs')) {
  try {
    if (process.argv.includes('--stop')) {
      try {
        const connection = await readConnection();
        const response = await fetch(`${connection.origin}/api/stop`, { method: 'POST', headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('停止请求失败');
        console.log('已请求停止独立浏览器服务。关闭伴随窗口即可。');
      } catch (error) { if (error.code === 'ENOENT') console.log('服务未运行'); else throw error; }
    } else {
      const connection = await ensureRunning();
      if (!process.argv.includes('--no-ui')) await openWindow(connection.origin);
      else console.log(`浏览器服务已就绪：${connection.origin}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
