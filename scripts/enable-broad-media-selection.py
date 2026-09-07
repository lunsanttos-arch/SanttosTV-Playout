from pathlib import Path

p = Path('src/main/main.js')
t = p.read_text(encoding='utf-8')
old = '''                            extensions: [\n                                "mp4",\n                                "mov"\n                            ]'''
new = '''                            extensions: [\n                                "mp4",\n                                "mov",\n                                "mkv",\n                                "avi",\n                                "mxf",\n                                "ts",\n                                "mts",\n                                "m2ts",\n                                "webm",\n                                "mpg",\n                                "mpeg",\n                                "m4v",\n                                "wmv"\n                            ]'''
if old not in t:
    raise SystemExit('media selection extension block not found')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')
print('broad media selection enabled')
