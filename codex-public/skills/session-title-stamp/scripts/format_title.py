#!/usr/bin/env python3
"""Offline title formatter; no network, state, hooks, or chat storage access."""
import argparse
import json
import os
import re
import math
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

CATEGORIES = {
    'zh': ['功能', '设计', '整改', '优化', '发布', '分析', '文档'],
    'en': ['Build', 'Design', 'Fix', 'Improve', 'Release', 'Analysis', 'Docs'],
}


def format_title(data):
    created = data.get('created_at')
    if type(created) not in (int, float) or not math.isfinite(created):
        raise ValueError('created_at must be verified Unix seconds, not milliseconds or a guessed date')
    dt = datetime.fromtimestamp(created, timezone.utc)
    if not 2000 <= dt.year <= 9999:
        raise ValueError('creation timestamp out of range')
    zone = data.get('time_zone', 'local')
    dt = dt.astimezone() if zone == 'local' else dt.astimezone(ZoneInfo(zone))
    language = data.get('language', 'zh')
    if language not in CATEGORIES or data.get('category') not in CATEGORIES[language]:
        raise ValueError('unsupported language or category')
    date_format = data.get('date_format', 'MMDD')
    if date_format not in ('MMDD', 'YYYYMMDD'):
        raise ValueError('unsupported date format')
    topic = data.get('topic')
    if not isinstance(topic, str):
        raise ValueError('topic must be text')
    topic = ' '.join(''.join(c if c.isprintable() else ' ' for c in topic).replace('|', ' ').split())
    if not topic:
        raise ValueError('topic is empty')
    prefix = dt.strftime('%m%d' if date_format == 'MMDD' else '%Y%m%d') + ' | ' + data['category'] + ' | '
    return prefix + topic[:36 - len(prefix)]


def doctor(zone):
    """Probe only local prerequisites, never claim availability of host tools."""
    sid = os.environ.get('CODEX_THREAD_ID', '')
    identity = bool(re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', sid))
    try:
        if zone != 'local':
            ZoneInfo(zone)
        zone_ok = True
    except (ValueError, KeyError):
        zone_ok = False
    return {'python': '.'.join(map(str, sys.version_info[:3])),
            'time_zone': zone, 'time_zone_available': zone_ok,
            'current_thread_identity_available': identity,
            'official_chat_tools': 'not_checked',
            'note': 'Check official read_thread/set_thread_title in the active chat separately.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--doctor', action='store_true', help='check local prerequisites without reading stdin or changing a title')
    parser.add_argument('--time-zone', default='local', help='timezone to check with --doctor')
    args = parser.parse_args()
    if args.doctor:
        result = doctor(args.time_zone)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0 if result['time_zone_available'] else 1)
    try:
        raw = sys.stdin.read(16385)
        if len(raw) > 16384:
            raise ValueError('input too large')
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError('expected an object')
        print(json.dumps({'title': format_title(data)}, ensure_ascii=False))
    except (ValueError, TypeError, OSError, OverflowError, KeyError) as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
