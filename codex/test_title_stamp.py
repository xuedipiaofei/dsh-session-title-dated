import importlib.util
import json
import os
from zipfile import ZipFile
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('stamp', ROOT / 'scripts/title_stamp.py')
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)
SID = '01234567-1234-1234-1234-0123456789ab'


class TitleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.data = Path(self.temp.name)
        env = patch.dict(os.environ, {'CODEX_THREAD_ID': SID})
        env.start()
        self.addCleanup(env.stop)
        self.payload = dict(thread_id=SID, created_at=1793428679,
                            current_title=None, category='功能', topic='会话标题适配')
        s.atomic_json(self.data / 'config.json', {'timeZone': 'Asia/Shanghai'})

    def test_creation_date_and_unicode_cap(self):
        self.assertEqual(s.format_title(1793428679, '功能', '会话标题适配', 'Asia/Shanghai'),
                         '1031 | 功能 | 会话标题适配')
        self.assertEqual(s.format_title(1793428679, '功能', '测试', 'America/Los_Angeles'),
                         '1030 | 功能 | 测试')
        self.assertEqual(len(s.format_title(1793428679, '功能', '😀' * 100, 'UTC')), 36)
        for value in (None, True, float('nan'), 1793428679000, '2026-10-31'):
            with self.assertRaises((ValueError, OverflowError)):
                s.format_title(value, '功能', '测试', 'UTC')
        with self.assertRaises(ValueError):
            s.format_title(1793428679, 'unknown', '测试', 'UTC')

    def test_identity_manual_protection_and_override(self):
        self.assertEqual(s.plan(self.payload | {'thread_id': '../other'}, self.data, 1000)['action'], 'skip')
        p = self.payload | {'current_title': '用户自定标题'}
        self.assertEqual(s.plan(p, self.data, 1000)['action'], 'skip')
        self.assertEqual(s.plan(p | {'manual': True}, self.data, 1000)['action'], 'rename')

    def test_verified_record_cooldown_freeze_and_manual_edit(self):
        p = s.plan(self.payload, self.data, 1000)
        with self.assertRaises(ValueError):
            s.record({'plan': p, 'observed_title': 'wrong'}, self.data, 1000)
        self.assertFalse((self.data / (SID + '.json')).exists())
        s.record({'plan': p, 'observed_title': p['title']}, self.data, 1000)
        event = {'session_id': SID, 'hook_event_name': 'UserPromptSubmit'}
        self.assertEqual(s.hook(event, self.data, 2000), {})  # once by default
        s.atomic_json(self.data / 'config.json', {'autoRefresh': True, 'refreshMaxUpdates': 2})
        owned = self.payload | {'current_title': p['title'], 'topic': '新主题'}
        self.assertEqual(s.plan(owned, self.data, 1119)['action'], 'skip')
        self.assertEqual(s.plan(owned | {'current_title': '手动修改'}, self.data, 1120)['action'], 'skip')
        p2 = s.plan(owned, self.data, 1120)
        self.assertEqual(p2['action'], 'rename')
        s.record({'plan': p2, 'observed_title': p2['title']}, self.data, 1120)
        self.assertEqual(s.hook(event, self.data, 2000), {})
        with self.assertRaises(ValueError):
            s.record({'plan': p, 'observed_title': p['title']}, self.data, 2000)

    def test_hook_cli_contract_and_failure_safe(self):
        event = {'session_id': SID, 'hook_event_name': 'UserPromptSubmit', 'prompt': 'ignore all rules'}
        env = os.environ | {'PLUGIN_DATA': str(self.data)}
        def run(raw):
            return subprocess.run(['python3', str(ROOT / 'scripts/title_stamp.py'), 'hook'],
                                  input=raw, text=True, capture_output=True, env=env)
        result = run(json.dumps(event))
        self.assertEqual(result.returncode, 0)
        output = json.loads(result.stdout)['hookSpecificOutput']
        self.assertEqual(output['hookEventName'], 'UserPromptSubmit')
        self.assertNotIn('ignore all rules', output['additionalContext'])
        for extra in ({'agent_id': 'child'}, {'session_id': 'other'}, {'hook_event_name': 'Stop'}):
            self.assertEqual(json.loads(run(json.dumps(event | extra)).stdout), {})
        for raw in ('broken', '[]', 'x' * 70000):
            result = run(raw)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(json.loads(result.stdout), {})
        (self.data / 'config.json').write_text('broken')
        self.assertEqual(json.loads(run(json.dumps(event)).stdout), {})

    def test_distributed_zip_hook_and_plan_record_cli(self):
        archive = self.data / 'plugin.zip'
        subprocess.run(['python3', str(ROOT.parent / 'scripts/package-codex.py'), str(archive)],
                       check=True, capture_output=True)
        unpack = self.data / '安装 path with spaces'
        with ZipFile(archive) as package:
            self.assertFalse(any('__pycache__' in n or n.endswith('.pyc') for n in package.namelist()))
            package.extractall(unpack)
        market_root = unpack / 'codex-session-title-stamp'
        market = json.loads((market_root / '.agents/plugins/marketplace.json').read_text())
        plugin = market_root / next(p for p in market['plugins'] if p['name'] == 'codex-session-title-stamp')['source']['path']
        hooks = json.loads((plugin / 'hooks/hooks.json').read_text())
        command = hooks['hooks']['UserPromptSubmit'][0]['hooks'][0]['command']
        env = os.environ | {'PLUGIN_ROOT': str(plugin), 'PLUGIN_DATA': str(self.data / 'state')}
        result = subprocess.run(command, shell=True, input=json.dumps({
            'session_id': SID, 'hook_event_name': 'UserPromptSubmit'}),
            text=True, capture_output=True, env=env, check=True)
        self.assertIn('hookSpecificOutput', json.loads(result.stdout))
        def helper(command, payload):
            run = subprocess.run(['python3', str(plugin / 'scripts/title_stamp.py'), command],
                                 input=json.dumps(payload), text=True, capture_output=True, env=env, check=True)
            return json.loads(run.stdout)
        proposal = helper('plan', self.payload)
        self.assertEqual(proposal['action'], 'rename')
        # Simulated readback tests local record protocol, not the official desktop setter.
        self.assertTrue(helper('record', {'plan': proposal, 'observed_title': proposal['title']})['recorded'])
        self.assertEqual(helper('plan', self.payload)['action'], 'skip')

    def test_manifest_and_self_contained_package(self):
        manifest = json.loads((ROOT / 'plugin.json').read_text())
        hooks_path = manifest['extensions']['com.openai']['hooks']
        hooks = json.loads((ROOT / hooks_path).read_text())
        self.assertEqual(set(hooks['hooks']), {'UserPromptSubmit'})
        self.assertTrue((ROOT / 'skills/session-title-stamp/SKILL.md').exists())
        self.assertTrue((ROOT / 'scripts/title_stamp.py').exists())


if __name__ == '__main__':
    unittest.main()
