import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, VERSION } from '../src/paths.mjs';
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const files = git(['ls-files', '-z']);
// Git -z produces real NULs; do not split escaped textual separators.
const tracked = files.split(String.fromCharCode(0)).filter(Boolean);
if (!tracked.length) throw new Error('没有待检查的跟踪文件，请先 git add');
const issues = [];
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['API key', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\b/],
  ['private session identifier', /\b20\d{6}_\d{6}_[a-f0-9]{6}\b/],
  ['private classroom URL', /\/lesson\/fullscreen\/v\d\/\d{10,}/],
  ['private machine path', /(?:H:[\/]+Hermes-Browser-Mod|D:[\/]+Hermes Agent CN Desktop)/i],
];
const isImage = file => /\.(?:png|jpe?g|gif|webp|ico)$/i.test(file);
function inspect(file, data, where) {
  if (/^(?:\.runtime|node_modules|artifacts)(?:\/|$)/.test(file) || /^\.env(?:\.|$)/.test(file) && file !== '.env.example') issues.push(where + ': excluded runtime path: ' + file);
  if (/\.(?:exe|dll|pyc|pyo|db|sqlite|log|zip|7z|pfx|p12)$/i.test(file)) issues.push(where + ': non-source payload: ' + file);
  if (data.subarray(0, 2).toString() === 'MZ' || data.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || data.subarray(0, 4).equals(Buffer.from([0, 0x61, 0x73, 0x6d]))) issues.push(where + ': executable header: ' + file);
  if (isImage(file)) return;
  const text = data.toString('utf8');
  for (const [label, pattern] of patterns) if (pattern.test(text.replaceAll(String.fromCharCode(92), "/"))) issues.push(where + ': ' + label + ': ' + file);
}
for (const file of tracked) {
  const data = await fs.readFile(path.join(ROOT, file));
  inspect(file, data, 'working tree');
  if (file.endsWith('.md')) {
    for (const match of data.toString('utf8').matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const target = decodeURIComponent(href.split('#')[0]);
      if (target) try { await fs.access(path.resolve(ROOT, path.dirname(file), target)); } catch { issues.push('broken link: ' + file + ' -> ' + href); }
    }
  }
}
const listed = git(['rev-list', '--objects', '--all']).trim();
let history = 0;
for (const line of listed ? listed.split('\n') : []) {
  const split = line.indexOf(' '); if (split < 0) continue;
  const oid = line.slice(0, split), file = line.slice(split + 1);
  if (git(['cat-file', '-t', oid]).trim() !== 'blob') continue;
  history++;
  const data = execFileSync('git', ['cat-file', 'blob', oid], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
  inspect(file, data, 'Git history');
}
const pkg = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(await fs.readFile(path.join(ROOT, 'package-lock.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'desktop/dashboard/manifest.json'), 'utf8'));
if (pkg.license !== 'MIT' || lock.version !== VERSION || lock.packages[''].version !== VERSION || manifest.version !== VERSION) issues.push('version / license metadata mismatch');
const license = await fs.readFile(path.join(ROOT, 'LICENSE'), 'utf8');
const upstream = await fs.readFile(path.join(ROOT, 'licenses/Hermes-CN-Desktop-v0.9.0.LICENSE.txt'), 'utf8');
if (!license.startsWith('MIT License') || !upstream.includes('PolyForm Noncommercial License 1.0.0') || upstream.split('\n').filter(l => l.startsWith('Required Notice:')).length !== 2) issues.push('missing or incomplete license notices');
if (issues.length) { console.error(issues.join('\n')); process.exitCode = 1; }
else console.log('发布检查通过：' + tracked.length + ' 个跟踪文件，' + history + ' 个历史 blob；版本 V' + VERSION + '。有限模式扫描不代替人工审查。');
