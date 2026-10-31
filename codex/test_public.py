import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'codex-public'
SCRIPT = PUBLIC / 'skills/session-title-stamp/scripts/format_title.py'
spec = importlib.util.spec_from_file_location('public_format', SCRIPT)
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


class PublicTests(unittest.TestCase):
    def test_format_options_and_boundaries(self):
        base = dict(created_at=1793428679, category='功能', topic='标题预览', time_zone='Asia/Shanghai')
        self.assertEqual(f.format_title(base), '1031 | 功能 | 标题预览')
        self.assertEqual(f.format_title(base | dict(language='en', category='Build', topic='Title preview',
                         time_zone='America/Los_Angeles', date_format='YYYYMMDD')),
                         '20261030 | Build | Title preview')
        self.assertEqual(len(f.format_title(base | dict(topic='😀' * 100))), 36)
        self.assertEqual(f.format_title(base | dict(topic='one\n two | three')), '1031 | 功能 | one two three')
        for bad in (dict(created_at=None), dict(created_at=True), dict(created_at=1793428679000),
                    dict(created_at=float('nan')), dict(category='oops'), dict(topic=' | '),
                    dict(date_format='bad'), dict(time_zone='Not/AZone')):
            with self.assertRaises((ValueError, OverflowError, KeyError)):
                f.format_title(base | bad)

    def test_doctor_no_stdin_or_side_effects(self):
        import os
        with tempfile.TemporaryDirectory() as temp:
            env = os.environ.copy()
            env.pop('CODEX_THREAD_ID', None)
            run = subprocess.run(['python3', str(SCRIPT), '--doctor', '--time-zone', 'Asia/Shanghai'],
                                 cwd=temp, env=env, capture_output=True, text=True, check=True, timeout=5)
            result = json.loads(run.stdout)
            self.assertTrue(result['time_zone_available'])
            self.assertFalse(result['current_thread_identity_available'])
            self.assertEqual(result['official_chat_tools'], 'not_checked')
            self.assertEqual(list(Path(temp).iterdir()), [])
            run = subprocess.run(['python3', str(SCRIPT), '--doctor', '--time-zone', 'Invalid/Zone'],
                                 cwd=temp, env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(run.returncode, 1)
            self.assertFalse(json.loads(run.stdout)['time_zone_available'])

    def test_public_archive(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'submission.zip'
            subprocess.run(['python3', str(ROOT / 'scripts/package-codex.py'), str(target), '--public'],
                           check=True, capture_output=True)
            with ZipFile(target) as archive:
                names = archive.namelist()
                self.assertIn('plugin.json', names)
                self.assertFalse(any('hooks' in n or '.agents/' in n or '__pycache__' in n for n in names))
                manifest = json.loads(archive.read('plugin.json'))
                ext = manifest['extensions']['com.openai']
                self.assertNotIn('hooks', ext)
                self.assertNotIn('apps', ext)
                self.assertTrue(ext['requires_local_executor'])
                meta = ext['interface']
                for key in ('displayName', 'shortDescription'):
                    self.assertTrue(0 < len(meta[key]) <= 30)
                for key in ('longDescription', 'developerName', 'category'):
                    self.assertTrue(meta[key])
                for key in ('logo', 'composerIcon'):
                    self.assertIn(meta[key][2:], names)
                self.assertIn(ext['onboardingSkill'][2:], names)
                archive.extractall(Path(temp) / 'with spaces')
            formatter = Path(temp) / 'with spaces/skills/session-title-stamp/scripts/format_title.py'
            before = sorted(p.relative_to(Path(temp)).as_posix() for p in Path(temp).rglob('*'))
            run = subprocess.run(['python3', str(formatter)], input=json.dumps({
                'created_at':1793428679, 'category':'分析','topic':'Test','time_zone':'Asia/Shanghai'}),
                text=True, capture_output=True, check=True)
            self.assertEqual(json.loads(run.stdout)['title'], '1031 | 分析 | Test')
            self.assertEqual(before, sorted(p.relative_to(Path(temp)).as_posix() for p in Path(temp).rglob('*')))
            for invalid in ('[]', 'broken', 'x' * 17000):
                run = subprocess.run(['python3', str(formatter)], input=invalid, text=True, capture_output=True)
                self.assertEqual(run.returncode, 1)
                self.assertIn('error', json.loads(run.stdout))


if __name__ == '__main__':
    unittest.main()
