import { findPnpm } from './native-toolchain.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, RUNTIME, VERSION } from '../src/paths.mjs';
const exec = promisify(execFile);
const source = path.join(RUNTIME, 'native-desktop-source');
const commit = '270f6ba796a291cf1397b63dee5cd697cb0c9cdf';
const current = (await exec('git', ['rev-parse', 'HEAD'], { cwd: source })).stdout.trim();
if (current !== commit) throw new Error('原生前端只支持已验证的 v0.9.0 / 270f6ba 源码，请勿把其他版本直接套用');
const panel = path.join(source, 'web/src/components/chat/preview-rail/preview-rail.tsx');
let text = await fs.readFile(panel, 'utf8');
if (!text.includes('import { BrowserModTab }')) {
  const expected = ['import { WebPreviewTab } from "./web-preview-tab";', '{ key: "web", label: "网页", icon: Globe, hidden: true }', '<WebPreviewTab url={selection.webUrl} onUrlChange={(url) => patchSelection({ webUrl: url })} />'];
  if (!expected.every(value => text.includes(value))) throw new Error('预览源文件与已验证版本不一致，未改写');
  text = text.replace(expected[0], 'import { BrowserModTab } from "./browser-mod-tab";').replace(expected[1], '{ key: "web", label: "浏览器", icon: Globe }').replace(expected[2], '<BrowserModTab />').replace('  // 网页预览暂时隐藏（用处不大）。保留代码与 WebPreviewTab，方便后续按需重启用。', '  // Local Browser Mod: reuse the existing preview rail without core changes.');
  await fs.writeFile(panel, text);
}
text = text.replace('<BrowserModTab />', '<BrowserModTab sessionId={sessionId} />');
await fs.writeFile(panel, text);
for (const name of await fs.readdir(path.join(ROOT, 'desktop/native'))) await fs.copyFile(path.join(ROOT, 'desktop/native', name), path.join(path.dirname(panel), name));
const detailPath = path.join(source, 'web/src/routes/detail.tsx');
let detail = await fs.readFile(detailPath, 'utf8');
if (!detail.includes('useBrowserModAutoReveal')) {
  const anchor = '  const taskId = activeSessionId ?? urlTaskId;';
  if (!detail.includes(anchor)) throw new Error('对话源码与已验证版本不一致，未接入自动展开');
  detail = 'import { useBrowserModAutoReveal } from "@/components/chat/preview-rail/browser-mod-auto-reveal";\n' + detail.replace(anchor, `${anchor}\n  useBrowserModAutoReveal(taskId);`);
  await fs.writeFile(detailPath, detail);
}
const pnpm = await findPnpm();
if (!pnpm) throw new Error('缺少 pnpm 9.15.0，请先执行 npm run native:prepare');
console.log('构建原生中文版前端副本…');
const result = await exec(process.execPath, [pnpm, '--filter', '@hermes/web', 'build:desktop'], { cwd: source, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
console.log(result.stdout.trim().split('\n').at(-1));
const output = path.join(RUNTIME, 'native-ui', `V${VERSION}`);
await fs.mkdir(output, { recursive: true });
await fs.cp(path.join(source, 'web/dist'), output, { recursive: true });
await fs.copyFile(path.join(source, 'LICENSE'), path.join(output, 'LICENSE.hermes-cn-desktop.txt'));
await fs.copyFile(path.join(ROOT, 'LICENSE'), path.join(output, 'LICENSE.browser-mod.txt'));
await fs.copyFile(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), path.join(output, 'THIRD_PARTY_NOTICES.md'));
await fs.writeFile(path.join(output, 'browser-mod-build.json'), JSON.stringify({ modVersion: VERSION, desktopVersion: '0.9.0', desktopCommit: commit }, null, 2));
console.log(`原生前端已构建：${output}`);
