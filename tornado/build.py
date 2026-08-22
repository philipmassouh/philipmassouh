#!/usr/bin/env python3
"""Assemble tornado/index.html from src/.

The viewer is a single self-contained HTML file: the GRIB2 decoder and the
delta-encoded US state outlines are inlined into the template. Edit files in
src/, run this, and commit both src/ and the rebuilt index.html.
"""
from pathlib import Path

src = Path(__file__).parent / "src"
tpl = (src / "app_template.html").read_text()
out = tpl.replace("/*__GRIB2__*/", (src / "grib2.js").read_text())
out = out.replace("/*__STATES__*/", (src / "states_min.json").read_text())
dest = Path(__file__).parent / "index.html"
dest.write_text(out)
print(f"wrote {dest} ({len(out) // 1024} KB)")
