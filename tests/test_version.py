from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from version import package_version, resolve_version
from release_notes import release_notes


class VersionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        self.git('init', '-q')
        self.git('config', 'user.name', 'Test Author')
        self.git('config', 'user.email', 'test@example.invalid')
        self.git('config', 'commit.gpgsign', 'false')
        self.git('config', 'tag.gpgsign', 'false')
        (self.root / '.gitignore').write_text('/artifacts/\n')
        (self.root / 'source').write_text('theme source\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Initial commit')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args],
                                       stderr=subprocess.DEVNULL, text=True).strip()

    def test_release_and_prerelease_package_versions(self):
        self.assertEqual(package_version('v1.2.3'), '1.2.3')
        self.assertEqual(package_version('v1.2.3-rc.1'), '1.2.3~rc.1')
        for invalid in ['1.2.3', 'v1.2', 'v01.2.3', 'v1.2.3;echo', '../v1.2.3']:
            with self.subTest(tag=invalid), self.assertRaises(ValueError):
                package_version(invalid)

    def test_tagged_checkout_and_ignored_build_outputs(self):
        self.git('tag', 'v1.2.3')
        info = resolve_version(self.root, tag='v1.2.3')
        self.assertEqual(info['version'], '1.2.3')
        self.assertEqual(info['commit'], self.git('rev-parse', 'HEAD'))
        (self.root / 'artifacts').mkdir()
        (self.root / 'artifacts/result.ipk').write_bytes(b'package')
        self.assertEqual(resolve_version(self.root)['version'], '1.2.3')

    def test_dirty_or_wrong_tag_cannot_be_published(self):
        self.git('tag', 'v1.2.3')
        with self.assertRaises(ValueError):
            resolve_version(self.root, tag='v9.9.9')
        (self.root / 'source').write_text('changed source')
        self.assertTrue(resolve_version(self.root)['version'].startswith('0~git'))
        self.assertTrue(resolve_version(self.root)['version'].endswith('+dirty'))
        with self.assertRaises(ValueError):
            resolve_version(self.root, tag='v1.2.3')

    def test_untagged_commit_is_a_development_version(self):
        self.assertRegex(resolve_version(self.root)['version'], r'^0~git\d{14}\.[0-9a-f]{12}$')

    def test_sdk_source_copy_does_not_inherit_parent_firmware_tag(self):
        self.git('tag', 'v99.0.0')
        source_copy = self.root / 'package/luci-theme-unifi'
        source_copy.mkdir(parents=True)
        self.assertEqual(resolve_version(source_copy)['version'], '0~dev')
        self.assertEqual(resolve_version(source_copy, override='1.2.3')['version'], '1.2.3')

    def test_notes_are_specific_to_the_requested_release(self):
        content = '# Changelog\n\n## [Unreleased]\n\n- Later work.\n\n## [1.2.3] - 2026-01-01\n\n- Released change.\n\n## [1.2.2] - 2025-12-01\n\n- Earlier change.\n'
        self.assertEqual(release_notes(content, 'v1.2.3'), '- Released change.\n')
        self.assertEqual(release_notes(content, 'v1.2.3', allow_unreleased=True), '- Released change.\n')
        for missing in ['v9.9.9', 'v1.2.3-rc.1']:
            with self.assertRaises(ValueError):
                release_notes(content, missing)
        with self.assertRaises(ValueError):
            release_notes('## [1.2.3] - 2026-01-01\n\n## [1.2.2] - 2025-12-01\n- Previous\n', 'v1.2.3')
        unreleased_only = '# Changelog\n\n## [Unreleased]\n\n- Pending release.\n\n## [1.2.2] - 2025-12-01\n\n- Earlier change.\n'
        self.assertEqual(release_notes(unreleased_only, 'v1.2.3', allow_unreleased=True),
                         '- Pending release.\n')
        with self.assertRaises(ValueError):
            release_notes('## [Unreleased]\n\n## [1.2.2] - 2025-12-01\n\n- Earlier change.\n',
                          'v1.2.3', allow_unreleased=True)


if __name__ == '__main__':
    unittest.main()
