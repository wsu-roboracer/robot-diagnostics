"""Every relative link and image in every Markdown file must point at a real
file. Run from the repo root:  python3 .github/scripts/check_links.py"""
import re, os, sys, urllib.parse
bad = []
for root, dirs, files in os.walk('.'):
    if '.git' in root or 'node_modules' in root: continue
    for f in files:
        if not f.endswith('.md'): continue
        p = os.path.join(root, f)
        for m in re.finditer(r'\]\(([^)\s]+)\)', open(p, encoding='utf-8').read()):
            t = m.group(1).split('#')[0]
            if not t or re.match(r'^[a-z]+:', t): continue
            if not os.path.exists(os.path.normpath(os.path.join(root, urllib.parse.unquote(t)))):
                bad.append(f'{p}: {m.group(1)}')
print('\n'.join(bad) if bad else 'all Markdown links resolve')
sys.exit(1 if bad else 0)
