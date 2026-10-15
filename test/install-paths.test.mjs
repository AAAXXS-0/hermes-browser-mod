import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { parseInstallArguments, resolveHermesPaths, requireRuntimeRoot } from '../src/install-paths.mjs';
test('未配置桌面目录时拒绝原生安装，MCP home 使用标准默认值', () => {
  assert.equal(resolveHermesPaths({}, {}).home, path.join(os.homedir(), '.hermes'));
  assert.throws(() => requireRuntimeRoot({}, {}), /必须指定/);
});
test('自定义安装路径与配置优先级保持一致', () => {
  const desktopRoot = path.resolve('fixture', 'desktop');
  assert.deepEqual(resolveHermesPaths({ desktopRoot }, {}), { runtimeRoot: path.join(desktopRoot, 'data'), home: path.join(desktopRoot, 'data', 'hermes-home') });
  const custom = resolveHermesPaths({ desktopRoot, home: 'custom-home' }, { HBM_HERMES_RUNTIME_ROOT: 'runtime-override', HERMES_HOME: 'ignored-home' });
  assert.equal(custom.home, path.resolve('custom-home'));
  assert.equal(custom.runtimeRoot, path.resolve('runtime-override'));
  assert.deepEqual(parseInstallArguments(['install', '--desktop-root', desktopRoot]), { mode: 'install', options: { desktopRoot } });
  assert.throws(() => parseInstallArguments(['install', '--desktop-root']), /无效/);
  assert.throws(() => parseInstallArguments(['install', '--unknown', 'value']), /无效/);
});
