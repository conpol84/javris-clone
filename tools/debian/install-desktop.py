#!/usr/bin/env python3
"""Install pinned local desktop assets, preserving pairing and a rollback copy.

Run on Debian as its logged-in user. --apply is the explicit local opt-in.
The server release and vision route are separate prerequisites.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

# Generated from the tested source files; the source ref must be an immutable SHA.
FILES = {
    "firbo-connector.mjs": "aba9e58920355cf7c73d25dc0501c4916dd1d767ec0f98b52c2a66ef807a68e2",
    "firbo-browser.mjs": "12e6c0595aae55ae97090b67246a337d9531af9dcfbf2d5ef1c508a79e19fd78",
    "firbo-desktop.mjs": "3cb4f820213d67931750cf69980ae1dbdeae9c5d91c3c4328313582bb9c1b428",
    "firbo-desktop.py": "5c65a5fcaa96af709643cdb5c99ec4e2b948964ff231359142237ba0f42af4a5"
}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=40, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if os.geteuid() == 0 or not pathlib.Path('/etc/debian_version').is_file():
        raise RuntimeError('Run on the Debian computer as its desktop user, NOT VPS/root')
    if not re.fullmatch(r'[0-9a-f]{40}', args.source):
        raise RuntimeError('Full immutable source SHA required')
    home = pathlib.Path.home()
    config = home / '.firbo-connector.json'
    target = home / 'Downloads'
    if config.is_symlink() or not config.is_file():
        raise RuntimeError('Existing regular Connector config required; do not pair again')
    raw_config = config.read_bytes()
    cfg = json.loads(raw_config)
    if cfg.get('fullControl') is not True:
        raise RuntimeError('Enable local full-control first')
    if not shutil.which('xdotool'):
        raise RuntimeError('Install dependencies on Debian: sudo apt-get install xdotool python3-pil')
    run(['/usr/bin/python3', '-c', 'from PIL import ImageGrab'])
    unit = 'firbo-connector.service'
    pid = run(['systemctl', '--user', 'show', unit, '-p', 'MainPID', '--value'], capture_output=True, text=True).stdout.strip()
    proc = pathlib.Path('/proc') / pid
    command = (proc / 'cmdline').read_bytes().split(b'\0')
    if str(target / 'firbo-connector.mjs').encode() not in command:
        raise RuntimeError('Unexpected service executable; no changes made')
    environ = dict(x.split('=', 1) for x in (proc / 'environ').read_text().split('\0') if '=' in x)
    env = os.environ.copy()
    for key in ('DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','WAYLAND_DISPLAY'):
        env.pop(key, None)
        if environ.get(key):
            env[key] = environ[key]
    if not env.get('DISPLAY') or env.get('WAYLAND_DISPLAY'):
        raise RuntimeError('A running X11 desktop is required')
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with tempfile.TemporaryDirectory(prefix='firbo-desktop-stage-', dir=home) as folder:
        staged = pathlib.Path(folder)
        for name, digest in FILES.items():
            with opener.open(f'https://raw.githubusercontent.com/conpol84/javris-clone/{args.source}/frontend/public/{name}', timeout=30) as response:
                data = response.read(2000001)
            if hashlib.sha256(data).hexdigest() != digest:
                raise RuntimeError('Asset hash mismatch: ' + name)
            (staged / name).write_bytes(data)
            (staged / name).chmod(0o600)
            if name.endswith('.mjs'):
                run(['node','--check',str(staged / name)])
        probe = run(['/usr/bin/python3',str(staged/'firbo-desktop.py')],input='{"action":"observe"}',text=True,capture_output=True,env=env)
        frame = json.loads(probe.stdout)
        if not frame.get('image'):
            raise RuntimeError('Desktop capture failed')
        print('X11_SCREEN_CAPTURE_PASSED',frame['screen_width'],frame['screen_height'],flush=True)
        if not args.apply:
            print('Read-only preflight complete. Use --apply for local desktop consent and install.')
            return
        old = {}
        for name in FILES:
            path = target / name
            if path.is_symlink() or (path.exists() and not path.is_file()):
                raise RuntimeError('Non-regular target')
            old[name] = path.read_bytes() if path.exists() else None
        backup = pathlib.Path(tempfile.mkdtemp(prefix='firbo-desktop-backup-',dir=home))
        for name, data in {**old,'config.json':raw_config}.items():
            if data is not None:
                path=backup/name
                path.touch(mode=0o600)
                path.write_bytes(data)
        print('BACKUP:',backup,flush=True)
        stopped = False
        changed = False
        try:
            run(['systemctl','--user','stop',unit])
            stopped = True
            if config.read_bytes()!=raw_config:
                raise RuntimeError('Config changed during installation')
            for name,data in old.items():
                path=target/name
                if path.is_symlink() or (path.read_bytes() if path.exists() else None)!=data:
                    raise RuntimeError('Asset changed during installation')
            changed = True
            for name in FILES:
                os.replace(staged/name,target/name)
            cfg['allowDesktop']=True
            new_config=staged/'config.json'
            new_config.write_text(json.dumps(cfg,indent=2))
            new_config.chmod(0o600)
            os.replace(new_config,config)
            run(['systemctl','--user','start',unit])
            time.sleep(3)
            run(['systemctl','--user','is-active',unit])
        except Exception:
            if stopped:
                run(['systemctl','--user','stop',unit])
                if changed:
                    for name,data in old.items():
                        path=target/name
                        if data is None:
                            path.unlink(missing_ok=True)
                        else:
                            path.write_bytes(data)
                            path.chmod(0o600)
                    config.write_bytes(raw_config)
                    config.chmod(0o600)
                run(['systemctl','--user','start',unit])
            raise
        print('LOCAL_DESKTOP_INSTALLED. Verify the server capability, CEO result and physical Stop separately.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('STOP:',str(error))
        raise SystemExit(1)
