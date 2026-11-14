import base64
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from brand_data import Sources, parse_registry, merge_registries, pack_vendors, build_mapping, svg_paths, nmap_diff


class BrandDataTests(unittest.TestCase):
    def test_original_names_survive_parse_merge_and_pack(self):
        content = b'Registry,Assignment,Organization Name,Organization Address\nMA-L,00D861,"Micro-Star INTL CO., LTD.",TW\n'
        rows = parse_registry(content, 'MA-L', 24)
        records, counts, conflicts = merge_registries([('MA-L', 24, rows)])
        packed = pack_vendors(records)
        self.assertEqual(packed['names'], ['Micro-Star INTL CO., LTD.'])
        self.assertEqual(base64.b64decode(packed['tables']['24']), bytes.fromhex('00d8610000'))
        self.assertEqual(conflicts, [])
        for bad in [b'<html>blocked</html>', b'Registry,Assignment,Organization Name\nMA-L,INVALID,Test\n']:
            with self.assertRaises(ValueError):
                parse_registry(bad, 'MA-L', 24)

    def test_registry_sizes_padding_and_ma_s_priority_over_iab(self):
        records, counts, conflicts = merge_registries([
            ('MA-L', 24, [('001122', 'Parent')]),
            ('MA-M', 28, [('0011223', 'Medium')]),
            ('IAB', 36, [('001122334', 'Legacy')]),
            ('MA-S', 36, [('001122334', 'Small')]),
        ])
        self.assertEqual(records['001122334']['name'], 'Small')
        self.assertEqual(len(conflicts), 1)
        packed = pack_vendors(records)
        self.assertEqual(base64.b64decode(packed['tables']['28'])[:4], bytes.fromhex('00112230'))
        self.assertEqual(base64.b64decode(packed['tables']['36'])[:5], bytes.fromhex('0011223340'))

    def test_exact_and_confirmed_mappings_do_not_rename_organizations(self):
        definitions = {'msi': {'name': 'MSI', 'icon': 'msi', 'organizations': '^Micro-Star'}}
        metadata = [{'title': 'MSI'}, {'title': 'Acer'}, {'title': 'Acme'}]
        names = ['Micro-Star INTL CO., LTD.', 'ACER INC.', 'Acme Pro', 'Unknown Hardware']
        brands, mappings, pending, _ = build_mapping(names, definitions, metadata, [])
        self.assertEqual(mappings['Micro-Star INTL CO., LTD.'], 'msi')
        self.assertEqual(mappings['ACER INC.'], 'si-acer')
        self.assertNotIn('Acme Pro', mappings)
        self.assertNotIn('Unknown Hardware', mappings)
        self.assertEqual(pending[0]['organization'], 'Acme Pro')
        self.assertEqual(names[0], 'Micro-Star INTL CO., LTD.')
        self.assertEqual(brands['msi']['icon'], 'msi')

    def test_ambiguous_aliases_are_only_candidates(self):
        metadata = [{'title': 'First', 'aliases': {'aka': ['Shared']}},
                    {'title': 'Second', 'aliases': {'aka': ['Shared']}}]
        _, mappings, pending, _ = build_mapping(['Shared Ltd.'], {}, metadata, [])
        self.assertEqual(mappings, {})
        self.assertEqual(len(pending[0]['candidates']), 2)

    def test_generic_company_words_do_not_produce_misleading_candidates(self):
        metadata = [{'title': 'Kingston Technology'}, {'title': 'Zebra Technologies'}, {'title': 'Electronic Arts'},
                    {'title': 'Bank of America'}, {'title': 'GOG.com'}]
        _, mappings, pending, _ = build_mapping(['Unknown Technology Inc.', '2M Electronic A/S', '@pos.com', 'AAMP of America'], {}, metadata, [])
        self.assertEqual(mappings, {})
        self.assertEqual(pending, [])

    def test_svg_content_is_validated_before_embedding_path_text(self):
        valid = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>Test</title><path d="M0 0h24v24z"/></svg>'
        self.assertEqual(svg_paths(valid, 'Test'), ['M0 0h24v24z'])
        for bad in [valid.replace(b'<path', b'<script/><path'), valid.replace(b'd="M', b'onclick="bad" d="M')]:
            with self.assertRaises(ValueError):
                svg_paths(bad, 'Test')
        with self.assertRaises(ValueError):
            svg_paths(valid, 'Another brand')

    def test_nmap_is_a_report_and_cannot_mutate_official_assignments(self):
        records = {'001122': {'name': 'Original Name, Inc.', 'bits': 24, 'registry': 'MA-L'}}
        before = copy.deepcopy(records)
        report = nmap_diff(b'# comment\n001122 ShortName\n525400 QEMU virtual NIC\n', records)
        self.assertEqual(report['only_in_nmap'], [{'prefix': '525400', 'name': 'QEMU virtual NIC'}])
        self.assertEqual(report['label_differences'][0]['ieee'], 'Original Name, Inc.')
        self.assertEqual(records, before)
        with self.assertRaises(ValueError):
            nmap_diff(b'<html>blocked</html>', records)

    def test_cached_source_tampering_is_rejected_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, 'data.csv').write_bytes(b'changed')
            source = Sources(directory, {'https://example.test/data': {'sha256': '0' * 64}}, check=True)
            with self.assertRaises(ValueError):
                source.read('https://example.test/data', 'data.csv')

    def test_committed_generated_modules_match_their_snapshot_checksums(self):
        import hashlib
        summary = json.loads((ROOT / 'tools/brand-data-summary.json').read_text())
        self.assertGreater(summary['prefixes'], 50000)
        for name, metadata in summary['outputs'].items():
            data = (ROOT / name).read_bytes()
            self.assertEqual(hashlib.sha256(data).hexdigest(), metadata['sha256'])
            self.assertEqual(len(data), metadata['bytes'])


if __name__ == '__main__':
    unittest.main()
