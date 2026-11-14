"""Offline vendor compiler helpers. Original registry names are never canonicalized."""
import base64
import csv
from concurrent.futures import ThreadPoolExecutor
import difflib
import hashlib
import io
import json
from pathlib import Path
import re
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET

REGISTRIES = [
    ('MA-L', 24, 'oui.csv', 'https://standards-oui.ieee.org/oui/oui.csv', 30000),
    ('MA-M', 28, 'mam.csv', 'https://standards-oui.ieee.org/oui28/mam.csv', 3000),
    ('IAB', 36, 'iab.csv', 'https://standards-oui.ieee.org/iab/iab.csv', 1000),
    ('MA-S', 36, 'oui36.csv', 'https://standards-oui.ieee.org/oui36/oui36.csv', 3000),
]
SELFHST_URL = 'https://raw.githubusercontent.com/selfhst/icons/main/index.json'
NMAP_URL = 'https://raw.githubusercontent.com/nmap/nmap/master/nmap-mac-prefixes'
SUFFIXES = set(('inc incorporated corp corporation co company ltd limited llc llp plc gmbh ag sa sarl bv '
                'pte pty oy oyj ab as asa aps nv srl spa sro sas pvt kg kgaa se kk bhd sdn').split())
GENERIC_WORDS = SUFFIXES | set(('technology technologies electronic electronics system systems network networks '
                              'communication communications international solution solutions device devices digital '
                              'intelligent smart hardware software industrial industries industry group holding holdings '
                              'shenzhen beijing shanghai hangzhou guangzhou dongguan china home global '
                              'com net org www one link computer computers security america electric electrical '
                              'bank information service services research product products laboratory laboratories '
                              'equipment semiconductor semiconductors wireless audio video control controls '
                              'automation medical instrument instruments science scientific engineering '
                              'enterprise enterprises development advanced design testing').split())
SVG_PATH = re.compile(r'[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\s-]+')


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


class Sources:
    def __init__(self, cache, known, refresh=False, check=False):
        self.cache, self.known = Path(cache), known
        self.refresh, self.check, self.manifest = refresh, check, {}

    def read(self, url, filename):
        path = self.cache / filename
        if self.refresh or not path.exists():
            if self.check:
                raise ValueError(f'Missing cached source {path}; populate the cache first.')
            req = urllib.request.Request(url, headers={'User-Agent': 'luci-theme-unifi-brand-builder'})
            with urllib.request.urlopen(req, timeout=60) as response:
                data = response.read()
            self.verify(url, data)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        data = path.read_bytes()
        self.verify(url, data)
        self.manifest[url] = {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
        return data

    def verify(self, url, data):
        if not self.refresh and url in self.known:
            if hashlib.sha256(data).hexdigest() != self.known[url]['sha256']:
                raise ValueError(f'Source changed: {url}; use --refresh to update intentionally.')


def parse_registry(content, registry, bits):
    reader = csv.DictReader(io.StringIO(content.decode('utf-8-sig')))
    if not {'Registry', 'Assignment', 'Organization Name'}.issubset(reader.fieldnames or []):
        raise ValueError(f'{registry}: missing CSV headers')
    rows = []
    for row in reader:
        prefix = row.get('Assignment', '').strip().upper()
        name = row.get('Organization Name', '').strip()
        if row.get('Registry') != registry or not re.fullmatch('[0-9A-F]{%d}' % (bits // 4), prefix) or not name:
            raise ValueError(f'{registry}: malformed registry row: {row}')
        rows.append((prefix, name))
    if not rows:
        raise ValueError(f'{registry}: empty registry')
    return rows


def merge_registries(inputs):
    """Last row wins within a registry; MA-S takes priority over legacy IAB."""
    records, conflicts, counts = {}, [], {}
    for registry, bits, rows in inputs:
        counts[registry] = {'rows': len(rows), 'prefixes': len({p for p, _ in rows})}
        for prefix, name in rows:
            previous = records.get(prefix)
            if previous and previous['name'] != name:
                conflicts.append({'prefix': prefix, 'previous': previous, 'selected': {'registry': registry, 'name': name}})
            records[prefix] = {'name': name, 'bits': bits, 'registry': registry}
    return records, counts, conflicts


def normalize(name):
    text = unicodedata.normalize('NFKC', name).casefold()
    tokens = ''.join(c if c.isalnum() else ' ' for c in text).split()
    while len(tokens) > 1 and tokens[-1] in SUFFIXES:
        tokens.pop()
    return ' '.join(tokens)


def slug(title):
    # A conservative candidate filename; the downloaded SVG's title is also verified.
    title = title.lower().replace('+', 'plus').replace('#', 'sharp').replace('&', 'and').replace('.', 'dot')
    return ''.join(c for c in unicodedata.normalize('NFKD', title) if c.isascii() and c.isalnum())


def icon_index(metadata, secondary):
    if not isinstance(metadata, list) or not all(isinstance(x, dict) and x.get('title') for x in metadata):
        raise ValueError('Invalid Simple Icons metadata')
    if not isinstance(secondary, list) or not all(isinstance(x, dict) and x.get('Name') and x.get('Reference') for x in secondary):
        raise ValueError('Invalid selfh.st icon index')
    exact, tokens, icons = {}, {}, {}
    for item in metadata:
        icon_slug = item.get('slug') or slug(item['title'])
        if not re.fullmatch('[a-z0-9]+', icon_slug):
            continue
        icon = {'provider': 'simple-icons', 'slug': icon_slug, 'title': item['title'],
                'source': item.get('source'), 'license': item.get('license'), 'hex': item.get('hex', '34373d'),
                'guidelines': item.get('guidelines')}
        icons[icon_slug] = icon
        for name in [item['title']] + item.get('aliases', {}).get('aka', []):
            exact.setdefault(normalize(name), []).append(icon)
    for item in secondary:
        if item.get('SVG') != 'Yes':
            continue
        icon = {'provider': 'selfhst', 'slug': item['Reference'], 'title': item['Name'],
                'source': SELFHST_URL, 'license': {'type': 'CC-BY-4.0'}}
        exact.setdefault(normalize(item['Name']), []).append(icon)
    for name, values in exact.items():
        for token in name.split():
            if len(token) >= 3 and token not in GENERIC_WORDS:
                tokens.setdefault(token, set()).add(name)
    return exact, tokens, icons


def candidates(name, exact, tokens):
    normalized = normalize(name)
    matches = exact.get(normalized, [])
    if matches:
        return [dict(item, reason='normalized-exact') for item in matches]
    nearby = set()
    for token in normalized.split():
        nearby.update(tokens.get(token, set()))
    scores = {key: difflib.SequenceMatcher(None, normalized, key).ratio() for key in nearby}
    def first_specific(key):
        return next((word for word in key.split() if len(word) >= 3 and word not in GENERIC_WORDS), None)
    first = first_specific(normalized)
    ranked = sorted((key for key in nearby if first and first_specific(key) == first and scores[key] >= .55),
                    key=lambda key: (-scores[key], key))[:3]
    return [dict(item, reason='partial-name', similarity=round(difflib.SequenceMatcher(None, normalized, key).ratio(), 3))
            for key in ranked for item in exact[key]][:5]


def build_mapping(names, definitions, metadata, secondary):
    exact, tokens, icons = icon_index(metadata, secondary)
    patterns = [(key, re.compile(value['organizations'], re.IGNORECASE)) for key, value in definitions.items()]
    brands, mappings, pending = {}, {}, []
    for key, definition in definitions.items():
        brand = {k: v for k, v in definition.items() if k not in ('organizations', 'icon')}
        icon = definition.get('icon')
        if not icon and definition.get('name'):
            matches = {m['slug'] for m in exact.get(normalize(definition['name']), []) if m['provider'] == 'simple-icons'}
            if len(matches) == 1:
                icon = matches.pop()
        if icon in icons:
            brand['icon'] = icon
            brand.pop('letter', None)
        elif brand.get('name'):
            brand['letter'] = brand.get('letter') or brand['name'][0]
        brands[key] = brand
    for name in names:
        for key, pattern in patterns:
            if pattern.search(name):
                mappings[name] = key
                break
        else:
            matches = candidates(name, exact, tokens)
            primary = {m['slug']: m for m in matches if m['provider'] == 'simple-icons' and m['reason'] == 'normalized-exact'}
            # Only a unique exact title/declared alias can create a new mapping.
            if len(primary) == 1:
                icon_slug, item = next(iter(primary.items()))
                key = 'si-' + icon_slug
                brands.setdefault(key, {'name': item['title'], 'color': '#' + item['hex'], 'icon': icon_slug})
                mappings[name] = key
            elif matches:
                pending.append({'organization': name, 'candidates': matches})
    return brands, mappings, pending, icons


def svg_paths(content, title):
    root = ET.fromstring(content)
    tag = '{http://www.w3.org/2000/svg}'
    if root.tag != tag + 'svg' or root.get('viewBox') != '0 0 24 24':
        raise ValueError(f'Unsupported SVG for {title}')
    svg_title = root.find(tag + 'title')
    if svg_title is None or normalize(svg_title.text or '') != normalize(title):
        raise ValueError(f'SVG title does not match metadata: {title}')
    paths = []
    for child in root:
        if child.tag == tag + 'title':
            continue
        if child.tag != tag + 'path' or set(child.attrib) != {'d'} or not SVG_PATH.fullmatch(child.get('d', '')):
            raise ValueError(f'Unsupported SVG element or attribute for {title}')
        paths.append(child.attrib['d'])
    if not paths:
        raise ValueError(f'Empty SVG for {title}')
    return paths


def pack_vendors(records):
    names = sorted({item['name'] for item in records.values()})
    if len(names) > 65536:
        raise ValueError('Registry organization indexes no longer fit in two bytes')
    indexes = {name: index for index, name in enumerate(names)}
    tables = {}
    for bits in (24, 28, 36):
        width = (bits + 7) // 8
        packed = b''.join(bytes.fromhex(prefix.ljust(width * 2, '0')) + indexes[item['name']].to_bytes(2, 'big')
                          for prefix, item in sorted(records.items()) if item['bits'] == bits)
        tables[str(bits)] = base64.b64encode(packed).decode()
    return {'names': names, 'tables': tables}


def nmap_diff(content, records):
    entries = {}
    for line in content.decode('utf-8').splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        parts = line.split(None, 1)
        if len(parts) != 2 or not re.fullmatch(r'(?:[0-9A-F]{6}|[0-9A-F]{7}|[0-9A-F]{9})', parts[0]):
            raise ValueError('Invalid Nmap prefix record: ' + line)
        entries[parts[0]] = parts[1]
    if not entries:
        raise ValueError('Empty Nmap prefix source')
    return {
        'note': 'Comparison only. Nmap names are often abbreviations; label differences are not proof of conflicting registrations.',
        'nmap_entries': len(entries),
        'only_in_nmap': [{'prefix': p, 'name': n} for p, n in sorted(entries.items()) if p not in records],
        'only_in_ieee': [{'prefix': p, **v} for p, v in sorted(records.items()) if p not in entries],
        'label_differences': [{'prefix': p, 'ieee': records[p]['name'], 'nmap': n}
                              for p, n in sorted(entries.items()) if p in records and n != records[p]['name']],
    }


def module(payload, comment):
    return f"/* Generated by tools/generate_brands.py. {comment} */\n'use strict';\n'require baseclass';\n\nreturn baseclass.extend({compact(payload)});\n"


def compile_data(source, definitions, version):
    inputs = []
    for registry, bits, filename, url, minimum in REGISTRIES:
        rows = parse_registry(source.read(url, filename), registry, bits)
        if len(rows) < minimum:
            raise ValueError(f'{registry}: unexpectedly small registry ({len(rows)} rows)')
        inputs.append((registry, bits, rows))
    records, counts, conflicts = merge_registries(inputs)
    base = f'https://raw.githubusercontent.com/simple-icons/simple-icons/{version}'
    metadata = json.loads(source.read(base + '/data/simple-icons.json', f'simple-icons-{version}.json'))
    secondary = json.loads(source.read(SELFHST_URL, 'selfhst-index.json'))
    if len(metadata) < 1000 or len(secondary) < 100:
        raise ValueError('Unexpectedly small icon directory')
    vendors = pack_vendors(records)
    brands, mappings, pending, icons = build_mapping(vendors['names'], definitions, metadata, secondary)
    for row in pending:
        for candidate in row['candidates']:
            candidate['svg_url'] = (base + f"/icons/{candidate['slug']}.svg" if candidate['provider'] == 'simple-icons'
                                    else f"https://raw.githubusercontent.com/selfhst/icons/main/svg/{candidate['slug']}.svg")
    selected = sorted({b['icon'] for b in brands.values() if b.get('icon')})

    def fetch_icon(icon):
        return icon, svg_paths(source.read(base + f'/icons/{icon}.svg', f'icons-{version}/{icon}.svg'), icons[icon]['title'])

    with ThreadPoolExecutor(max_workers=6) as pool:
        paths = dict(pool.map(fetch_icon, selected))
    license_text = source.read(base + '/LICENSE.md', f'Simple-Icons-{version}-LICENSE.md')
    disclaimer = source.read(base + '/DISCLAIMER.md', f'Simple-Icons-{version}-DISCLAIMER.md')
    snapshot = hashlib.sha256(compact({'vendors': vendors, 'brands': brands, 'mappings': mappings, 'paths': paths}).encode()).hexdigest()[:16]
    vendors['snapshot'] = snapshot
    mapping = {'snapshot': snapshot, 'brands': brands, 'organizations': mappings}
    icon_data = {'snapshot': snapshot, 'version': version, 'paths': paths}
    notice = {'version': version, 'disclaimer': 'Simple-Icons-DISCLAIMER.md',
              'icons': {key: icons[key] for key in selected}}
    summary = {'snapshot': snapshot, 'registries': counts, 'prefixes': len(records), 'organizations': len(vendors['names']),
               'mapped_organizations': len(mappings), 'brands': sum(bool(b.get('name')) for b in brands.values()),
               'svg_icons': len(paths), 'pending_icon_matches': len(pending),
               'unmapped_organizations': len(vendors['names']) - len(mappings), 'registry_conflicts': len(conflicts)}
    outputs = {
        'htdocs/luci-static/resources/unifi/vendor-data.js': module(vendors, 'IEEE MA-L, MA-M, MA-S and IAB; original organization names.'),
        'htdocs/luci-static/resources/unifi/brand-map.js': module(mapping, 'Brand/icon associations only; registry names are preserved.'),
        'htdocs/luci-static/resources/unifi/icon-data.js': module(icon_data, 'SVG path text from Simple Icons; see bundled per-icon source notices.'),
        'root/usr/share/licenses/luci-theme-unifi/Simple-Icons-CC0.txt': license_text,
        'root/usr/share/licenses/luci-theme-unifi/Simple-Icons-DISCLAIMER.md': disclaimer,
        'root/usr/share/licenses/luci-theme-unifi/Simple-Icons-NOTICE.json': json.dumps(notice, ensure_ascii=False, indent=2) + '\n',
    }
    unavailable = [{'brand': key, 'icon': item['icon']} for key, item in definitions.items()
                   if item.get('icon') and item['icon'] not in icons]
    automatic = [{'organization': name, 'brand': brands[key]['name'], 'icon': brands[key]['icon'],
                  'reason': 'unique-normalized-exact', 'source': base + '/data/simple-icons.json'}
                 for name, key in mappings.items() if key.startswith('si-')]
    return outputs, summary, {'icon_candidates': pending, 'registry_conflicts': conflicts,
                             'automatic_icon_matches': automatic, 'unavailable_icons': unavailable}, records
