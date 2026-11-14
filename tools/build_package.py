#!/usr/bin/env python3
"""Build a reproducible architecture-independent IPK from theme sources."""
import argparse
import gzip
import io
from pathlib import Path
import re
import tarfile

from version import ROOT, resolve_version


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.GNU_FORMAT) as bundle:
        directories = set()
        for name, data, mode in entries:
            for parent in reversed(Path(name).parents):
                if str(parent) == '.' or str(parent) in directories:
                    continue
                directory = tarfile.TarInfo('./' + str(parent))
                directory.type, directory.mode, directory.mtime = tarfile.DIRTYPE, 0o755, 0
                bundle.addfile(directory)
                directories.add(str(parent))
            item = tarfile.TarInfo('./' + name)
            item.size, item.mode, item.uid, item.gid, item.mtime = len(data), mode, 0, 0, 0
            bundle.addfile(item, io.BytesIO(data))
    return gzip.compress(output.getvalue(), mtime=0)


def substitute_version(data, version):
    # Same version marker used by LuCI's SDK SubstituteVersion helper.
    return re.sub(rb'{#\s*([^\s]*)PKG_VERSION\s*#}',
                  lambda match: match[1] + version.encode(), data)


def build(root, output, info):
    makefile = (root / 'Makefile').read_text()
    release = re.search(r'^PKG_RELEASE:=(\d+)$', makefile, re.M)[1]
    license_name = re.search(r'^PKG_LICENSE:=(.+)$', makefile, re.M)[1].strip()
    version = info['version'] + '-' + release
    entries = []
    for source, destination in [('htdocs', 'www'), ('ucode', 'usr/share/ucode/luci'), ('root', '')]:
        for file in sorted((root / source).rglob('*')):
            if not file.is_file() or file.name == '.DS_Store':
                continue
            name = '/'.join(part for part in [destination, str(file.relative_to(root / source))] if part)
            data = file.read_bytes()
            if source == 'ucode':
                data = substitute_version(data, info['version'])
            mode = 0o755 if 'uci-defaults/' in name or 'etc/init.d/' in name else 0o644
            entries.append((name, data, mode))
    size = sum(len(data) for _, data, _ in entries)
    control = f'''Package: luci-theme-unifi
Version: {version}
Architecture: all
Maintainer: luci-theme-unifi contributors
Section: luci
Priority: optional
Depends: luci-base, luci-theme-bootstrap, luci-mod-status, ucode-mod-uloop, iputils-arping
Installed-Size: {size}
Description: Unifi LuCI theme with a read-only OpenWrt dashboard
License: {license_name}
'''
    control_entries = [('control', control.encode(), 0o644),
                       ('conffiles', b'/etc/config/unifi\n', 0o644)]
    for hook in ['postinst', 'prerm', 'postrm']:
        script = re.search(r'^define Package/luci-theme-unifi/' + hook + r'\n(.*?)^endef$',
                           makefile, re.M | re.S)[1].replace('$$', '$')
        control_entries.append((hook, script.encode(), 0o755))
    payload = archive(entries)
    package = archive([('debian-binary', b'2.0\n', 0o644),
                       ('control.tar.gz', archive(control_entries), 0o644),
                       ('data.tar.gz', payload, 0o644)])
    output.mkdir(parents=True, exist_ok=True)
    name = f'luci-theme-unifi_{version}_all.ipk'
    (output / name).write_bytes(package)
    return output / name


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--tag', help='require a clean checkout of this release tag')
    group.add_argument('--version', help='explicit version for sources without Git metadata')
    parser.add_argument('--output', type=Path, default=ROOT / 'artifacts/packages')
    args = parser.parse_args()
    try:
        info = resolve_version(tag=args.tag, override=args.version)
    except ValueError as error:
        parser.error(str(error))
    package = build(ROOT, args.output, info)
    print(f'{package}: {package.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
