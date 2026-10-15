import fs from 'node:fs/promises';
import path from 'node:path';
import { installDesktop } from './desktop-adapter.mjs';
import { installNative } from './native-adapter.mjs';
import { parseInstallArguments, resolveHermesPaths, requireRuntimeRoot } from './install-paths.mjs';
import { RUNTIME, VERSION } from './paths.mjs';

try {
  const { mode, options } = parseInstallArguments(process.argv.slice(2));
  if (!['install', 'remove'].includes(mode)) throw new Error('操作必须是 install 或 remove');
  const runtimeRoot = requireRuntimeRoot(options);
  const { home } = resolveHermesPaths(options);
  if (mode === 'install') {
    const buildDir = path.join(RUNTIME, 'native-ui', 'V' + VERSION);
    const metadata = JSON.parse(await fs.readFile(path.join(buildDir, 'browser-mod-build.json'), 'utf8'));
    if (metadata.modVersion !== VERSION || metadata.desktopVersion !== '0.9.0' || metadata.desktopCommit !== '270f6ba796a291cf1397b63dee5cd697cb0c9cdf') throw new Error('缺少与当前版本匹配的已验证界面包，请先执行 npm run native:build');
    await fs.access(path.join(buildDir, 'index.html'));
    await fs.access(path.join(home, 'config.yaml'));
    const backend = await installDesktop(mode, { home });
    const native = await installNative(mode, { runtimeRoot, buildDir });
    console.log(JSON.stringify({ backend, native }, null, 2));
  } else {
    const native = await installNative(mode, { runtimeRoot });
    const backend = await installDesktop(mode, { home });
    console.log(JSON.stringify({ native, backend }, null, 2));
  }
} catch (error) {
  console.error(error.code === 'ENOENT' ? '缺少构建文件或指定的 Hermes 配置，请先构建，并检查安装路径。' : error.message);
  process.exitCode = 1;
}
