#!/usr/bin/env python3
"""Build a submission ZIP (--public) or a local marketplace ZIP."""
import argparse
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('output', type=Path)
parser.add_argument('--public', action='store_true')
args = parser.parse_args()
output = args.output.resolve()
if args.public:
    base = root / 'codex-public'
    files = list(base.rglob('*'))
else:
    base = root
    files = [root / '.agents/plugins/marketplace.json', root / 'LICENSE', root / 'docs/codex-marketplace.md']
    for folder in ('codex', 'codex-public'):
        files += list((root / folder).rglob('*'))
files = [p for p in files if p.is_file() and '__pycache__' not in p.parts
         and p.suffix != '.pyc' and not p.name.startswith('test_')]
if output in files:
    raise SystemExit('Output must not overwrite a package source file')
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        relative = path.relative_to(base).as_posix()
        archive.write(path, relative if args.public else 'codex-session-title-stamp/' + relative)
print(output)
