#!/usr/bin/env python3
"""Compile offline vendor data, icon mappings and SVG path text; report candidate matches.

--refresh intentionally updates upstream snapshots. --check verifies cached inputs.
Nmap is optional and only produces a comparison report, never runtime assignments.
"""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import urllib.request

from brand_data import Sources, compile_data, nmap_diff, NMAP_URL

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / 'tools/brand-data-config.json'
SOURCES = ROOT / 'tools/brand-data-sources.json'
SUMMARY = ROOT / 'tools/brand-data-summary.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--update-icons', action='store_true', help='with --refresh, select the latest stable Simple Icons release')
    parser.add_argument('--audit-nmap', action='store_true', help='write an Nmap comparison, without merging it')
    parser.add_argument('--allow-shrink', action='store_true', help='allow a reviewed registry reduction larger than five percent')
    parser.add_argument('--reports-dir', type=Path, default=ROOT / 'artifacts/brand-data')
    args = parser.parse_args()
    if args.check and args.refresh or args.update_icons and not args.refresh:
        parser.error('--check/--refresh are exclusive; --update-icons requires --refresh')
    config = json.loads(CONFIG.read_text())
    if args.update_icons:
        with urllib.request.urlopen('https://registry.npmjs.org/simple-icons/latest', timeout=30) as response:
            version = json.load(response)['version']
        if not re.fullmatch(r'\d+\.\d+\.\d+', version):
            raise ValueError('Invalid stable Simple Icons version')
        config['iconVersion'] = version
    known = json.loads(SOURCES.read_text()) if SOURCES.exists() else {}
    source = Sources(ROOT / 'vendor/brand-data', known, args.refresh, args.check)
    definitions = json.loads((ROOT / 'tools/brand-definitions.json').read_text())
    outputs, summary, reports, records = compile_data(source, definitions, config['iconVersion'])
    if SUMMARY.exists() and not args.allow_shrink:
        previous = json.loads(SUMMARY.read_text())
        for key, value in summary['registries'].items():
            old = previous.get('registries', {}).get(key, {}).get('prefixes', 0)
            if value['prefixes'] < old * .95:
                raise ValueError(f'{key}: registry shrank by more than 5%; review before using --allow-shrink')
    outputs['tools/brand-data-config.json'] = json.dumps(config, indent=2) + '\n'
    outputs['tools/brand-data-sources.json'] = json.dumps(source.manifest, indent=2, sort_keys=True) + '\n'
    summary['outputs'] = {path: {'bytes': len(value if isinstance(value, bytes) else value.encode()),
                                'sha256': hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()}
                          for path, value in outputs.items() if path.startswith('htdocs/')}
    outputs['tools/brand-data-summary.json'] = json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + '\n'
    # Complete every download and comparison before changing any generated output.
    if args.audit_nmap:
        audit = Sources(ROOT / 'vendor/brand-data', {}, args.refresh, args.check)
        reports['nmap_diff'] = nmap_diff(audit.read(NMAP_URL, 'nmap-mac-prefixes.txt'), records)
        reports['nmap_diff']['sources'] = audit.manifest
    if args.check:
        for filename, value in outputs.items():
            expected = value if isinstance(value, bytes) else value.encode()
            if not (ROOT / filename).exists() or (ROOT / filename).read_bytes() != expected:
                raise ValueError(f'Generated output is stale: {filename}')
    else:
        for filename, value in outputs.items():
            path = ROOT / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            data = value if isinstance(value, bytes) else value.encode()
            temporary = path.with_suffix(path.suffix + '.new')
            temporary.write_bytes(data)
            temporary.replace(path)
        # The former combined module is replaced by the three generated modules.
        (ROOT / 'htdocs/luci-static/resources/unifi/brand-data.js').unlink(missing_ok=True)
    args.reports_dir.mkdir(parents=True, exist_ok=True)
    for key, value in reports.items():
        (args.reports_dir / (key.replace('_', '-') + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    preview = ['<!doctype html><meta charset="utf-8"><title>Icon candidates</title>',
               '<style>body{font:15px system-ui;padding:24px}section{padding:16px;border-bottom:1px solid #ccc}'
               'img{width:36px;height:36px;vertical-align:middle;margin:8px}a{margin-right:16px}</style>',
               '<h1>Icon candidates</h1><p>First 200 organizations; see icon-candidates.json for the complete list. '
               'These are proposals, not confirmed manufacturer identities. Previews load from the listed upstream sources.</p>']
    for row in reports['icon_candidates'][:200]:
        preview.append('<section><b>' + html.escape(row['organization']) + '</b><br>')
        for item in row['candidates']:
            url, title = html.escape(item['svg_url'], quote=True), html.escape(item['title'])
            preview.append(f'<a href="{url}"><img loading="lazy" src="{url}" alt="">{title}</a> '
                           + html.escape(item['reason']))
        preview.append('</section>')
    (args.reports_dir / 'icon-candidates.html').write_text('\n'.join(preview))
    audit_counts = {}
    if 'nmap_diff' in reports:
        audit_counts = {key: len(reports['nmap_diff'][key]) for key in ['only_in_nmap', 'only_in_ieee', 'label_differences']}
    body = (f"Vendor snapshot `{summary['snapshot']}`: {summary['prefixes']:,} prefixes, "
            f"{summary['organizations']:,} original organization names, {summary['svg_icons']} SVG icons.\n\n"
            f"Pending icon matches: {summary['pending_icon_matches']}; registry conflicts recorded: {summary['registry_conflicts']}.\n\n"
            'Nmap is used for comparison only; no Nmap assignments are merged. '
            f"Difference counts: {json.dumps(audit_counts)}.\n\n"
            'Candidate icon matches and registry/Nmap differences are attached as workflow reports. '
            'Partial-name candidates require an explicit mapping; original registry names are not replaced.\n')
    (args.reports_dir / 'update-summary.md').write_text(body)
    print(('Verified' if args.check else 'Generated') + f" {summary['prefixes']:,} prefixes, {summary['organizations']:,} organizations, {summary['svg_icons']} SVGs")


if __name__ == '__main__':
    main()
