#!/usr/bin/env python3
"""Extract the changelog section matching a release tag."""
import argparse
from pathlib import Path
import re

from version import ROOT, package_version


def release_notes(content, tag, allow_unreleased=False):
    package_version(tag)
    version = tag[1:]
    match = re.search(r'^## \[' + re.escape(version) + r'\] - \d{4}-\d{2}-\d{2}\s*\n(.*?)(?=^## |\Z)',
                      content, re.M | re.S)
    if match and match[1].strip():
        return match[1].strip() + '\n'
    if allow_unreleased:
        fallback = re.search(r'^## \[Unreleased\]\s*\n(.*?)(?=^## |\Z)', content, re.M | re.S)
        if fallback and fallback[1].strip():
            return fallback[1].strip() + '\n'
        raise ValueError(
            f'Add a dated, nonempty [{version}] section or a nonempty [Unreleased] section to CHANGELOG.md before tagging'
        )
    raise ValueError(f'Add a dated, nonempty [{version}] section to CHANGELOG.md before tagging')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--allow-unreleased', action='store_true')
    args = parser.parse_args()
    try:
        notes = release_notes((ROOT / 'CHANGELOG.md').read_text(), args.tag,
                              allow_unreleased=args.allow_unreleased)
    except ValueError as error:
        parser.error(str(error))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(notes)
    else:
        print(notes, end='')


if __name__ == '__main__':
    main()
