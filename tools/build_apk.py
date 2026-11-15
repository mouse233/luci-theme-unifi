#!/usr/bin/env python3
"""Build an APK (OpenWrt 25.12+) from the repository's IPK payload and hooks."""
import argparse
import hashlib
import io
import shutil
import re
import subprocess
import tarfile
import tempfile
from pathlib import Path

from build_package import build
from version import resolve_version

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'luci-theme-unifi'


def ipk_contents(path):
    with tarfile.open(path, 'r:gz') as outer:
        members = {member.name.removeprefix('./'): outer.extractfile(member).read()
                   for member in outer.getmembers()}
    with tarfile.open(fileobj=io.BytesIO(members['control.tar.gz']), mode='r:gz') as control:
        hooks = {member.name.removeprefix('./'): control.extractfile(member).read().decode()
                 for member in control.getmembers()}
    return hooks, members['data.tar.gz']


def payload_tree(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        archive.extractall(destination)


def strip_shebang(text):
    lines = text.splitlines()
    if lines and lines[0].startswith('#!'):
        lines = lines[1:]
    return '\n'.join(lines).strip('\n') + '\n'


def script_text(body, upgrade=False):
    lines = ['#!/bin/sh']
    if upgrade:
        lines.append('export PKG_UPGRADE=1')
    lines += [
        '[ "${IPKG_NO_SCRIPT}" = "1" ] && exit 0',
        '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0',
        '. ${IPKG_INSTROOT}/lib/functions.sh',
        'export root="${IPKG_INSTROOT}"',
        f'export pkgname="{PACKAGE}"',
        'add_group_and_user',
        'default_postinst',
        strip_shebang(body).rstrip('\n'),
    ]
    return '\n'.join(lines) + '\n'


def deinstall_text(prerm):
    return ('#!/bin/sh\n'
            '[ -s ${IPKG_INSTROOT}/lib/functions.sh ] || exit 0\n'
            '. ${IPKG_INSTROOT}/lib/functions.sh\n'
            'export root="${IPKG_INSTROOT}"\n'
            f'export pkgname="{PACKAGE}"\n'
            'default_prerm\n'
            f'{strip_shebang(prerm).rstrip()}\n')


def apk_version(version):
    """Map IPK versions to apk's version grammar without losing identity."""
    match = re.fullmatch(r'(\d+\.\d+\.\d+)(?:~([0-9A-Za-z.-]+))?', version)
    if match:
        return match[1] + ('~' + match[2].encode().hex() if match[2] else '')
    return '0.0.0~' + version.encode().hex()


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--version')
    group.add_argument('--tag')
    parser.add_argument('--apk', type=Path, required=True, help='Path to the ImmortalWrt SDK apk executable')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/packages')
    args = parser.parse_args()

    info = resolve_version(tag=args.tag, override=args.version)
    work = Path(tempfile.mkdtemp(prefix='unifi-apk-'))
    try:
        ipk = build(ROOT, work, info)
        hooks, data = ipk_contents(ipk)
        tree = work / 'root'
        tree.mkdir()
        payload_tree(data, tree)

        files = sorted(str(path.relative_to(tree)) for path in tree.rglob('*') if path.is_file())
        control = tree / 'lib/apk/packages'
        control.mkdir(parents=True)
        listing = '\n'.join('/' + name for name in files) + '\n'
        (control / f'{PACKAGE}.list').write_text(listing)
        conffile = 'etc/config/unifi'
        checksum = hashlib.sha256((tree / conffile).read_bytes()).hexdigest()
        (control / f'{PACKAGE}.conffiles').write_text(f'/{conffile}\n')
        (control / f'{PACKAGE}.conffiles_static').write_text(f'/{conffile} {checksum}\n')

        scripts = work / 'scripts'
        scripts.mkdir()
        outputs = {
            'post-install': script_text(hooks['postinst']),
            'post-upgrade': script_text(hooks['postinst'], upgrade=True),
            'pre-deinstall': deinstall_text(hooks['prerm']),
            'post-deinstall': hooks['postrm'],
        }
        for name, text in outputs.items():
            (scripts / name).write_text(text)

        release = re.search(r'^PKG_RELEASE:=(\d+)$', (ROOT / 'Makefile').read_text(), re.M)[1]
        package_version = apk_version(info['version']) + '-r' + release
        command = [
            str(args.apk.resolve()), 'mkpkg',
            '--info', f'name:{PACKAGE}',
            '--info', f'version:{package_version}',
            '--info', 'arch:noarch',
            '--info', 'description:Unifi LuCI theme with a read-only OpenWrt dashboard',
            '--info', 'license:' + re.search(r'^PKG_LICENSE:=(.+)$', (ROOT / 'Makefile').read_text(), re.M)[1].strip(),
            '--info', 'origin:luci-theme-unifi',
            '--info', 'maintainer:luci-theme-unifi contributors',
            '--info', 'url:https://github.com/mouse233/luci-theme-unifi',
            '--info', 'depends:luci-base luci-theme-bootstrap luci-mod-status ucode-mod-uloop iputils-arping',
            '--script', f'post-install:{scripts / "post-install"}',
            '--script', f'post-upgrade:{scripts / "post-upgrade"}',
            '--script', f'pre-deinstall:{scripts / "pre-deinstall"}',
            '--script', f'post-deinstall:{scripts / "post-deinstall"}',
            '--files', str(tree),
            '--output', str(work / f'{PACKAGE}-{package_version}.apk'),
        ]
        subprocess.run(command, check=True)
        args.output.mkdir(parents=True, exist_ok=True)
        target = args.output / f'{PACKAGE}-{package_version}.apk'
        shutil.copy2(work / f'{PACKAGE}-{package_version}.apk', target)
        print(target)
    finally:
        shutil.rmtree(work)


if __name__ == '__main__':
    main()
