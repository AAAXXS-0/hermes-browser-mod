"""Thin, removable bridge to this mod's own Node launcher.

Never runs shell strings or imports/modifies Hermes agent internals.
"""
import json
import os
import subprocess
import threading
from pathlib import Path
from urllib.request import Request, urlopen
from fastapi import APIRouter, HTTPException

router = APIRouter()
_lock = threading.Lock()

def _settings():
    return json.loads(Path(__file__).with_name('settings.json').read_text(encoding='utf-8'))

def _status():
    settings = _settings()
    try:
        connection = json.loads((Path(settings.get('runtimeDir', str(Path(settings['root']) / '.runtime'))) / 'connection.json').read_text(encoding='utf-8'))
        with urlopen(connection['origin'] + '/health', timeout=2) as response:
            health = json.load(response)
        if health.get('app') != 'hermes-browser-mod' or not health.get('ready'):
            return {'running': False}
        return {'running': True, 'origin': connection['origin'], 'version': health['version']}
    except (OSError, ValueError, KeyError):
        return {'running': False}

@router.get('/status')
def status():
    return _status()

@router.post('/start')
def start():
    with _lock:
        settings = _settings()
        root = Path(settings['root'])
        try:
            environment = {**os.environ, 'HBM_RUNTIME_DIR': settings.get('runtimeDir', str(root / '.runtime')), 'HBM_PORT': str(settings.get('port', 17371))}
            completed = subprocess.run([settings['node'], str(root / 'src' / 'launcher.mjs'), '--no-ui'], cwd=root, env=environment, capture_output=True, text=True, encoding='utf-8', timeout=35, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        except (OSError, subprocess.TimeoutExpired) as error:
            raise HTTPException(503, '浏览器启动失败，请使用项目内启动脚本检查') from error
        if completed.returncode:
            raise HTTPException(503, completed.stderr.strip()[-1000:] or '浏览器未启动')
        result = _status()
        if not result['running']:
            raise HTTPException(503, '浏览器启动后没有响应，请检查项目运行日志')
        connection = json.loads((Path(settings.get('runtimeDir', str(root / '.runtime'))) / 'connection.json').read_text(encoding='utf-8'))
        request = Request(connection['origin'] + '/api/embed-ticket', method='POST', data=b'{}', headers={'Authorization': 'Bearer ' + connection['token'], 'Content-Type': 'application/json'})
        with urlopen(request, timeout=3) as response:
            result.update(json.load(response))
        return result
