#!/usr/bin/env python3
"""Extract the changelog section matching a release tag."""
import argparse
from datetime import date as date_cls
from pathlib import Path
import re

from version import ROOT, package_version


def _release_section(content, title, require_date=False):
    date_suffix = r' - \d{4}-\d{2}-\d{2}' if require_date else r'(?: - \d{4}-\d{2}-\d{2})?'
    return re.search(r'^## \[' + re.escape(title) + r'\]' + date_suffix + r'\s*\n(.*?)(?=^## |\Z)',
                     content, re.M | re.S)


def release_notes(content, tag, allow_unreleased=False):
    package_version(tag)
    version = tag[1:]
    match = _release_section(content, version, require_date=True)
    if match and match[1].strip():
        return match[1].strip() + '\n'
    if allow_unreleased:
        fallback = _release_section(content, 'Unreleased')
        if fallback and fallback[1].strip():
            return fallback[1].strip() + '\n'
        raise ValueError(
            f'Add a dated, nonempty [{version}] section or a nonempty [Unreleased] section to CHANGELOG.md before tagging'
        )
    raise ValueError(f'Add a dated, nonempty [{version}] section to CHANGELOG.md before tagging')


def promote_unreleased(content, tag, release_date=None):
    package_version(tag)
    version = tag[1:]
    current = _release_section(content, version, require_date=True)
    if current and current[1].strip():
        return content, False
    unreleased = _release_section(content, 'Unreleased')
    if not unreleased or not unreleased[1].strip():
        raise ValueError(
            f'Add a dated, nonempty [{version}] section or a nonempty [Unreleased] section to CHANGELOG.md before tagging'
        )
    release_date = release_date or date_cls.today().isoformat()
    normalized_body = unreleased[1].strip() + '\n'
    replacement = f'## [Unreleased]\n\n## [{version}] - {release_date}\n\n{normalized_body}\n'
    return content[:unreleased.start()] + replacement + content[unreleased.end():], True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('tag')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--allow-unreleased', action='store_true')
    parser.add_argument('--promote-unreleased', action='store_true')
    parser.add_argument('--date')
    args = parser.parse_args()
    path = ROOT / 'CHANGELOG.md'
    content = path.read_text()
    try:
        if args.promote_unreleased:
            content, changed = promote_unreleased(content, args.tag, release_date=args.date)
            if changed:
                path.write_text(content)
        notes = release_notes(content, args.tag, allow_unreleased=args.allow_unreleased or args.promote_unreleased)
    except ValueError as error:
        parser.error(str(error))
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(notes)
    else:
        print(notes, end='')


if __name__ == '__main__':
    main()
