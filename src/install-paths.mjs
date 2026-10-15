import os from 'node:os';
import path from 'node:path';

export function resolveHermesPaths(options = {}, env = process.env) {
  const desktop = options.desktopRoot ?? env.HBM_HERMES_DESKTOP_ROOT;
  const runtime = options.runtimeRoot ?? env.HBM_HERMES_RUNTIME_ROOT ?? (desktop ? path.join(desktop, 'data') : undefined);
  const home = options.home ?? env.HERMES_HOME ?? (runtime ? path.join(runtime, 'hermes-home') : path.join(os.homedir(), '.hermes'));
  return { home: path.resolve(home), runtimeRoot: runtime ? path.resolve(runtime) : undefined };
}

export function requireRuntimeRoot(options = {}, env = process.env) {
  const result = resolveHermesPaths(options, env);
  if (!result.runtimeRoot) throw new Error('原生桌面接入必须指定 --desktop-root 或 HBM_HERMES_DESKTOP_ROOT（桌面安装目录），也可显式指定 --runtime-root。未修改任何宿主文件。');
  return result.runtimeRoot;
}

export function parseInstallArguments(args) {
  const [mode = 'install', ...flags] = args;
  const options = {};
  const keys = { '--desktop-root': 'desktopRoot', '--runtime-root': 'runtimeRoot', '--home': 'home' };
  for (let i = 0; i < flags.length; i += 2) {
    const key = keys[flags[i]], value = flags[i + 1];
    if (!key || !value || value.startsWith('--')) throw new Error('安装参数无效；支持 --desktop-root、--runtime-root 和 --home，每项后接路径。');
    options[key] = value;
  }
  return { mode, options };
}
