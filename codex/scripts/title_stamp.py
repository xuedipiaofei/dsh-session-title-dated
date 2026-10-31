#!/usr/bin/env python3
"""Offline policy/formatting helper. Never reads or writes Codex's own storage."""
import argparse
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

CATEGORIES = ('功能', '设计', '整改', '优化', '发布', '分析', '文档')
ID = re.compile(r'^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$')
DEFAULTS = {'autoRefresh': False, 'refreshMinIntervalSeconds': 120,
            'refreshMaxUpdates': 100, 'timeZone': 'local', 'enabled': True}


def identity(value):
    return (isinstance(value, str) and ID.fullmatch(value)
            and value == os.environ.get('CODEX_THREAD_ID'))


def read_json(path, default):
    if not path.exists():
        return default
    value = json.loads(path.read_text(encoding='utf-8'))
    if not isinstance(value, dict):
        raise ValueError('expected a JSON object')
    return value


def settings(data):
    cfg = DEFAULTS | read_json(data / 'config.json', {})
    for key in ('autoRefresh', 'enabled'):
        if not isinstance(cfg[key], bool):
            raise ValueError('invalid boolean setting')
    for key in ('refreshMinIntervalSeconds', 'refreshMaxUpdates'):
        if type(cfg[key]) is not int or cfg[key] < 0:
            raise ValueError('invalid refresh setting')
    if cfg['timeZone'] != 'local':
        ZoneInfo(cfg['timeZone'])
    return cfg


def state(data, sid):
    value = read_json(data / (sid + '.json'), {})
    if value and (not isinstance(value.get('title'), str)
                  or type(value.get('updates')) is not int
                  or value['updates'] < 1
                  or type(value.get('updatedAt')) not in (int, float)
                  or not math.isfinite(value['updatedAt'])):
        raise ValueError('invalid state; preserve current title')
    return value


def ready(cfg, previous, now):
    if not cfg['enabled']:
        return False
    if not previous:
        return True
    return (cfg['autoRefresh']
            and (cfg['refreshMaxUpdates'] == 0 or previous['updates'] < cfg['refreshMaxUpdates'])
            and now - previous['updatedAt'] >= cfg['refreshMinIntervalSeconds'])


def format_title(created, category, topic, zone):
    # Desktop read_thread reports Unix seconds. Never guess milliseconds or use now.
    if type(created) not in (float, int) or not math.isfinite(created):
        raise ValueError('created_at must be Unix seconds')
    date = datetime.fromtimestamp(created, timezone.utc)
    if not 2000 <= date.year <= 9999:
        raise ValueError('unsupported creation timestamp')
    date = date.astimezone() if zone == 'local' else date.astimezone(ZoneInfo(zone))
    if category not in CATEGORIES or not isinstance(topic, str):
        raise ValueError('invalid category/topic')
    topic = ' '.join(''.join(c for c in topic if c.isprintable()).replace('|', ' ').split())
    if not topic:
        raise ValueError('empty topic')
    prefix = date.strftime('%m%d') + ' | ' + category + ' | '
    return prefix + topic[:36 - len(prefix)]


def plan(payload, data, now):
    sid = payload.get('thread_id')
    if not identity(sid):
        return {'action': 'skip', 'reason': 'thread identity unavailable or mismatched'}
    cfg, previous = settings(data), state(data, sid)
    manual = payload.get('manual', False)
    if type(manual) is not bool:
        raise ValueError('manual must be boolean')
    current = payload.get('current_title')
    if current is not None and not isinstance(current, str):
        raise ValueError('invalid current title')
    if not manual:
        if not ready(cfg, previous, now):
            return {'action': 'skip', 'reason': 'disabled, cooldown or frozen'}
        if (previous and current != previous['title']) or (not previous and current):
            return {'action': 'skip', 'reason': 'title is not plugin-owned'}
    title = format_title(payload.get('created_at'), payload.get('category'),
                         payload.get('topic'), cfg['timeZone'])
    if current == title:
        return {'action': 'skip', 'reason': 'unchanged'}
    return {'action': 'rename', 'thread_id': sid, 'title': title,
            'previous_title': current, 'updates': previous.get('updates', 0) + 1}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.title-stamp-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False)
            stream.write('\n')
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def record(payload, data, now):
    p = payload.get('plan', {})
    if not isinstance(p, dict) or not identity(p.get('thread_id')):
        raise ValueError('thread identity mismatch')
    if (p.get('action') != 'rename' or not isinstance(p.get('title'), str)
            or not re.fullmatch(r'\d{4} \| (' + '|'.join(CATEGORIES) + r') \| .+', p['title'])
            or len(p['title']) > 36 or p['title'] != payload.get('observed_title')):
        raise ValueError('verified title required')
    old = state(data, p['thread_id'])
    if p.get('updates') != old.get('updates', 0) + 1:
        raise ValueError('stale plan')
    atomic_json(data / (p['thread_id'] + '.json'), {
        'title': p['title'], 'updates': p['updates'], 'updatedAt': now})
    return {'recorded': True}


def hook(event, data, now):
    sid = event.get('session_id')
    if (event.get('hook_event_name') != 'UserPromptSubmit' or not identity(sid)
            or event.get('agent_id') or event.get('agent_type')):
        return {}
    if not ready(settings(data), state(data, sid), now):
        return {}
    skill = Path(__file__).resolve().parents[1] / 'skills/session-title-stamp/SKILL.md'
    context = ('[session-title-stamp-v1] Auto-title request for the current visible chat only. '
               'If another date/title hook is active, defer to it and skip this request. '
               'Near the end of this turn follow the packaged skill at ' + json.dumps(str(skill)) +
               '. Use official read_thread/set_thread_title and verified readback; '
               'skip if tools unavailable, topic unclear, user title specified, or internal agent. '
               'Do not enumerate chats or edit Codex storage. '
               'The helper protects non-owned titles. Plugin data directory: ' + json.dumps(str(data)) +
               '. Expected thread id: ' + sid + '.')
    return {'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit',
                                   'additionalContext': context}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('hook', 'plan', 'record'))
    parser.add_argument('--data', default=os.environ.get('PLUGIN_DATA'))
    args = parser.parse_args()
    try:
        if not args.data:
            raise ValueError('PLUGIN_DATA or --data required')
        data = Path(args.data).resolve()
        raw = sys.stdin.read(65537)
        if len(raw) > 65536:
            raise ValueError('input too large')
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            raise ValueError('expected object')
        result = {'hook': hook, 'plan': plan, 'record': record}[args.command](payload, data, time.time())
    except (ValueError, TypeError, OSError, OverflowError, KeyError) as exc:
        # Never block the user's prompt, even on broken configuration or corrupt state.
        if args.command == 'hook':
            print('{}')
            print('session-title-stamp: skipped (' + type(exc).__name__ + ')', file=sys.stderr)
            return
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        raise SystemExit(1)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
