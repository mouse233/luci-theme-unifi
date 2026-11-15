import io
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from build_package import build


def contents(data):
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as bundle:
        return {entry.name.removeprefix('./'): (bundle.extractfile(entry).read(), entry.mode)
                for entry in bundle.getmembers() if entry.isfile()}


class PackageTests(unittest.TestCase):
    def test_ipk_payload_version_permissions_and_reproducibility(self):
        info = {'version': '1.2.3~rc.1', 'tag': 'v1.2.3-rc.1', 'commit': 'a' * 40, 'dirty': False}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / 'unrelated.txt').write_text('not a build product')
            package = build(ROOT, output, info)
            first = package.read_bytes()
            outer = contents(first)
            self.assertEqual(set(outer), {'debian-binary', 'control.tar.gz', 'data.tar.gz'})
            self.assertEqual(outer['debian-binary'][0], b'2.0\n')
            control = contents(outer['control.tar.gz'][0])
            self.assertIn(b'Version: 1.2.3~rc.1-1\n', control['control'][0])
            self.assertEqual(control['conffiles'][0], b'/etc/config/unifi\n')
            for hook in ['postinst', 'prerm', 'postrm']:
                self.assertEqual(control[hook][1], 0o755)
            self.assertIn(b'unifi-activity start', control['postinst'][0])
            payload = contents(outer['data.tar.gz'][0])
            expected = set()
            for source, prefix in [('htdocs', 'www/'), ('ucode', 'usr/share/ucode/luci/'), ('root', '')]:
                expected.update(prefix + str(file.relative_to(ROOT / source))
                                for file in (ROOT / source).rglob('*')
                                if file.is_file() and file.name != '.DS_Store')
            self.assertEqual(set(payload), expected)
            self.assertEqual(payload['etc/init.d/unifi-activity'][1], 0o755)
            self.assertEqual(payload['etc/uci-defaults/30_luci-theme-unifi'][1], 0o755)
            self.assertIn(b"option activity_always '1'", payload['etc/config/unifi'][0])
            templates = [data for name, (data, _) in payload.items() if name.endswith('.ut')]
            self.assertTrue(templates)
            self.assertTrue(all(b'PKG_VERSION' not in data for data in templates))
            header = payload['usr/share/ucode/luci/template/themes/unifi/header.ut'][0]
            self.assertIn(b'appearance.js?v=1.2.3~rc.1', header)
            footer = payload['usr/share/ucode/luci/template/themes/unifi/footer.ut'][0]
            self.assertIn(b'-unifi-1.2.3~rc.1', footer)
            self.assertEqual(package.name, 'luci-theme-unifi_1.2.3~rc.1-1_all.ipk')
            self.assertEqual({file.name for file in output.iterdir()}, {package.name, 'unrelated.txt'})
            self.assertEqual((output / 'unrelated.txt').read_text(), 'not a build product')
            build(ROOT, output, info)
            self.assertEqual(first, package.read_bytes(), 'identical inputs produce identical IPKs')


class ApkVersionTests(unittest.TestCase):
    def test_apk_versions_preserve_release_and_encode_other_versions(self):
        from build_apk import apk_version
        self.assertEqual(apk_version('1.2.3'), '1.2.3')
        self.assertEqual(apk_version('1.2.3~rc.1'), '1.2.3_alpha1114099046049')
        self.assertEqual(apk_version('0~dev'), '0.0.0_alpha1048126100101118')
        self.assertNotEqual(apk_version('0~git123.abcdef'),
                            apk_version('0~git123.abcdef+dirty'))


class PackageLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        info = {'version': '1.2.3', 'tag': 'v1.2.3', 'commit': 'a' * 40, 'dirty': False}
        with tempfile.TemporaryDirectory() as directory:
            package = build(ROOT, Path(directory), info)
            cls.control = contents(contents(package.read_bytes())['control.tar.gz'][0])

    def run_removal(self, theme, action, offline=False):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            theme_file = work / 'theme'
            registration = work / 'registration'
            log = work / 'commands'
            theme_file.write_text(theme + '\n')
            registration.write_text('/luci-static/unifi\n')
            log.touch()
            uci = work / 'uci'
            uci.write_text('''#!/bin/sh
printf 'uci %s\\n' "$*" >> "$TEST_COMMANDS"
[ "$1" = '-q' ] && shift
case "$1" in
 get) cat "$TEST_THEME" ;;
 set) printf '%s\\n' "${2#*=}" > "$TEST_THEME" ;;
 delete) rm -f "$TEST_REGISTRATION" ;;
 commit) exit 0 ;;
 *) exit 1 ;;
esac
''')
            uci.chmod(0o755)
            service = work / 'service'
            service.write_text('''#!/bin/sh
printf 'service %s\\n' "$*" >> "$TEST_COMMANDS"
''')
            service.chmod(0o755)
            env = dict(os.environ, PATH=str(work) + os.pathsep + os.environ['PATH'],
                       TEST_THEME=str(theme_file), TEST_REGISTRATION=str(registration),
                       TEST_COMMANDS=str(log), IPKG_INSTROOT=str(work) if offline else '')
            for hook in ['prerm', 'postrm']:
                script = self.control[hook][0].decode()
                script = script.replace('/etc/init.d/unifi-activity', str(service))
                script = script.replace('/etc/init.d/unifi-presence', str(service))
                script = script.replace('/tmp/luci-indexcache.', str(work / 'luci-indexcache.'))
                result = subprocess.run(['sh', '-c', script, hook, action, '1.2.3-1'],
                                        env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr, '')
            return theme_file.read_text().strip(), registration.exists(), log.read_text()

    def run_postinst(self, defaults_present, offline=False):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            defaults = work / '30_luci-theme-unifi'
            log = work / 'commands'
            log.touch()
            if defaults_present:
                defaults.write_text('#!/bin/sh\nprintf "defaults\\n" >> "$TEST_COMMANDS"\n')
                defaults.chmod(0o755)
            service = work / 'service'
            service.write_text('#!/bin/sh\nprintf "service %s\\n" "$*" >> "$TEST_COMMANDS"\n')
            service.chmod(0o755)
            env = dict(os.environ, TEST_COMMANDS=str(log),
                       IPKG_INSTROOT=str(work) if offline else '')
            script = self.control['postinst'][0].decode()
            script = script.replace('/etc/uci-defaults/30_luci-theme-unifi', str(defaults))
            script = script.replace('/etc/init.d/unifi-activity', str(service))
            script = script.replace('/etc/init.d/unifi-presence', str(service))
            script = script.replace('/etc/init.d/rpcd', str(service))
            script = script.replace('/tmp/luci-indexcache.', str(work / 'luci-indexcache.'))
            script = script.replace('/tmp/luci-modulecache/', str(work / 'luci-modulecache/'))
            result = subprocess.run(['sh', '-c', script, 'postinst', 'configure', '1.2.3-1'],
                                    env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, '')
            return log.read_text()

    def test_postinst_skips_consumed_uci_defaults(self):
        commands = self.run_postinst(defaults_present=False)
        self.assertNotIn('defaults', commands)
        self.assertIn('service enable\n', commands)
        self.assertIn('service start\n', commands)

    def test_postinst_runs_uci_defaults_when_present(self):
        commands = self.run_postinst(defaults_present=True)
        self.assertTrue(commands.startswith('defaults\n'), commands)
        self.assertIn('service enable\n', commands)
        self.assertIn('service start\n', commands)

    def test_offline_postinst_does_not_modify_live_configuration_or_services(self):
        self.assertEqual(self.run_postinst(defaults_present=True, offline=True), '')

    def test_active_theme_upgrade_preserves_selection_and_registration(self):
        theme, registered, commands = self.run_removal('/luci-static/unifi', 'upgrade')
        self.assertEqual(theme, '/luci-static/unifi')
        self.assertTrue(registered)
        self.assertNotIn('uci ', commands)
        self.assertIn('service stop\n', commands)
        self.assertIn('service disable\n', commands)

    def test_active_theme_removal_selects_bootstrap(self):
        theme, registered, commands = self.run_removal('/luci-static/unifi', 'remove')
        self.assertEqual(theme, '/luci-static/bootstrap')
        self.assertFalse(registered)
        self.assertIn('service stop\n', commands)
        self.assertIn('service disable\n', commands)

    def test_other_theme_remains_selected(self):
        for action in ['upgrade', 'remove']:
            with self.subTest(action=action):
                theme, registered, commands = self.run_removal('/luci-static/other', action)
                self.assertEqual(theme, '/luci-static/other')
                self.assertEqual(registered, action == 'upgrade')
                self.assertNotIn('uci -q set ', commands)

    def test_apk_deinstall_version_argument_selects_bootstrap(self):
        theme, registered, commands = self.run_removal('/luci-static/unifi', '9.9.9-r1')
        self.assertEqual(theme, '/luci-static/bootstrap')
        self.assertFalse(registered)
        self.assertIn('service stop\n', commands)
        self.assertIn('service disable\n', commands)

    def test_apk_deinstall_version_argument_keeps_other_theme(self):
        theme, registered, commands = self.run_removal('/luci-static/other', '9.9.9-r1')
        self.assertEqual(theme, '/luci-static/other')
        self.assertFalse(registered)
        self.assertNotIn('uci -q set ', commands)

    def test_offline_hooks_do_not_modify_live_configuration_or_services(self):
        for action in ['upgrade', 'remove']:
            with self.subTest(action=action):
                theme, registered, commands = self.run_removal('/luci-static/unifi', action, offline=True)
                self.assertEqual(theme, '/luci-static/unifi')
                self.assertTrue(registered)
                self.assertEqual(commands, '')


if __name__ == '__main__':
    unittest.main()
