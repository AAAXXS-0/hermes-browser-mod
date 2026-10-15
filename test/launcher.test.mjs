import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, RUNTIME } from '../src/paths.mjs';

test('新工具遇到旧后台时提示更新，不关闭现有服务或重复启动', async t => {
  const runtime = path.join(RUNTIME, `launcher-test-${Date.now()}`);
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ app: 'hermes-browser-mod', ready: true, version: '0.0.0' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(runtime, 'connection.json'), JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, version: '0.0.0', token: 'test-only' }));
  const child = spawn(process.execPath, [path.join(ROOT, 'src/launcher.mjs'), '--no-ui'], { env: { ...process.env, HBM_RUNTIME_DIR: runtime }, windowsHide: true });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  const code = await new Promise((resolve, reject) => { child.on('exit', resolve); child.on('error', reject); });
  assert.equal(code, 1);
  assert.match(output, /后台浏览器仍是 V0.0.0/);
  assert.match(output, /停止 \/ 启动 demo/);
  assert.deepEqual(requests, ['/health']);
});
