#!/usr/bin/env python3
"""Merge subagent results, download + inline images, emit a self-contained texture edit."""
import base64, glob, hashlib, html, json, os, re, statistics, subprocess, sys
from urllib.parse import urlsplit, urlunsplit

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
IMG_DIR = os.path.join(HERE, "img")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "index.html")
MAX_PRICE = 500
# Same design picked by two agents under different names/colourways; keep the brand's own listing.
CAVEATS = {
    "SSENSE": "SSENSE blocks automated access, so these were read through a proxy: the pages are live and not marked sold out, but sizes couldn't be checked.",
}
# Matched as (store, lowercase substring of item_name).
MANUAL_DUPES = [
    ("END. Clothing", "labura"),          # same jacket on portugueseflannel.com
    ("Blue Owl", "loopwheel crewneck"),   # Real McCoy's 10oz crew, kept at Standard & Strange
    ("Clutch Cafe", "loopwheel sweatshirt"),
]
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126 Safari/537.36")
os.makedirs(IMG_DIR, exist_ok=True)


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"[\d,]+(?:\.\d+)?", str(v))
    return float(m.group(0).replace(",", "")) if m else None


def norm_url(u):
    p = urlsplit(u or "")
    # Keep the query only when it identifies the product (non-Shopify stores like Self Edge).
    q = p.query if "product_id" in p.query or "id=" in p.query else ""
    return urlunsplit((p.scheme, p.netloc.lower().removeprefix("www."), p.path.rstrip("/"), q, "")).lower()


def fetch_image(url, referer):
    """Download, downscale to 520px JPEG, return data URI (or None)."""
    if not url:
        return None
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    raw, jpg = os.path.join(IMG_DIR, key + ".src"), os.path.join(IMG_DIR, key + ".jpg")
    if not os.path.exists(jpg):
        u = "https:" + url if url.startswith("//") else url
        r = subprocess.run(["curl", "-sL", "--max-time", "40", "-A", UA, "-e", referer or "",
                            "-H", "Accept: image/avif,image/webp,image/*,*/*", "-o", raw,
                            "-w", "%{http_code} %{content_type}", u], capture_output=True, text=True)
        code, _, ctype = r.stdout.partition(" ")
        if code != "200" or not os.path.exists(raw) or os.path.getsize(raw) < 1000:
            print(f"  ! image failed ({r.stdout.strip()}): {u}", file=sys.stderr)
            return None
        s = subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "70",
                            "-Z", "520", raw, "--out", jpg], capture_output=True, text=True)
        if s.returncode != 0 or not os.path.exists(jpg):
            print(f"  ! sips failed ({ctype}): {u}\n{s.stderr}", file=sys.stderr)
            return None
    with open(jpg, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


def money(v):
    return f"${v:,.0f}" if v == int(v) else f"${v:,.2f}"


# ---- merge ----------------------------------------------------------------
stores, seen_urls, seen_names, dropped = [], set(), set(), []
for path in sorted(glob.glob(os.path.join(RESULTS, "*.json"))):
    try:
        data = json.load(open(path))
    except Exception as e:
        print(f"! bad JSON {path}: {e}", file=sys.stderr)
        continue
    for s in data.get("stores", []):
        items = []
        for it in s.get("items") or []:
            price, sale = num(it.get("price_usd")), num(it.get("sale_price_usd_or_null"))
            eff = sale if sale else price
            label = f"{s.get('store')}: {it.get('item_name')}"
            if eff is None:
                dropped.append((label, "no price")); continue
            if eff > MAX_PRICE:
                dropped.append((label, f"{money(eff)} > ${MAX_PRICE}")); continue
            u = norm_url(it.get("product_url"))
            n = (str(it.get("brand", "")).lower().strip(), re.sub(r"\W+", " ", str(it.get("item_name", "")).lower()).strip())
            manual = any(s.get('store') == st and sub in str(it.get('item_name', '')).lower() for st, sub in MANUAL_DUPES)
            if u in seen_urls or n in seen_names or manual:
                dropped.append((label, "duplicate")); continue
            seen_urls.add(u); seen_names.add(n)
            it.update(_price=price, _sale=sale if sale and price and sale < price else None, _eff=eff)
            items.append(it)
        s["items"] = items
        s["_median"] = statistics.median(i["_eff"] for i in items) if items else None
        stores.append(s)

live = sorted([s for s in stores if s["items"]], key=lambda s: s["_median"])
missing = [s for s in stores if not s["items"]]

print(f"{len(live)} stores with items, {sum(len(s['items']) for s in live)} items; {len(missing)} without")
for label, why in dropped:
    print(f"  dropped: {label} ({why})")

# ---- images ---------------------------------------------------------------
for s in live:
    for it in s["items"]:
        it["_img"] = fetch_image(it.get("image_url"), it.get("product_url"))

# ---- render ---------------------------------------------------------------
E = lambda x: html.escape(str(x or ""), quote=True)


def slug(x):
    return re.sub(r"[^a-z0-9]+", "-", x.lower()).strip("-")


def item_tile(it):
    img = (f'<img src="{it["_img"]}" alt="{E(it.get("item_name"))}" loading="lazy">' if it["_img"]
           else '<div class="noimg">image unavailable</div>')
    if it["_sale"]:
        price = f'<span class="sale">{money(it["_sale"])}</span> <s>{money(it["_price"])}</s>'
    else:
        price = money(it["_eff"])
    note = it.get("price_note")
    note_html = f'<p class="pnote">{E(note)}</p>' if note and str(note).lower() not in ("null", "none") else ""
    fit = it.get("fit")
    fit_html = f' · {E(fit)}' if fit and not str(fit).lower().startswith("not stated") else ""
    return f"""
      <a class="item" href="{E(it.get('product_url'))}" target="_blank" rel="noopener">
        <div class="ph">{img}</div>
        <div class="meta">
          <p class="brand">{E(it.get('brand'))}</p>
          <h3>{E(it.get('item_name'))}</h3>
          <p class="fabric">{E(it.get('fabric_and_weight'))}{fit_html}</p>
          <p class="price">{price}</p>{note_html}
        </div>
      </a>"""


cards = []
for s in live:
    tiles = "".join(item_tile(i) for i in s["items"])
    cav = CAVEATS.get(s["store"])
    caveat = f'\n        <p class="caveat">{E(cav)}</p>' if cav else ""
    cards.append(f"""
    <article class="store" id="{slug(s['store'])}">
      <header>
        <div class="title">
          <h2><a href="{E(s.get('store_url'))}" target="_blank" rel="noopener">{E(s['store'])}</a></h2>
          <p class="range"><span>median ${s['_median']:,.0f}</span><span>range {E(s.get('price_range'))}</span></p>
        </div>
        <p class="vibe">{E(s.get('vibe'))}</p>{caveat}
      </header>
      <div class="items n{len(s['items'])}">{tiles}</div>
    </article>""")

index = "".join(f'<a href="#{slug(s["store"])}">{E(s["store"])} <span>${s["_median"]:,.0f}</span></a>' for s in live)
miss_html = ""
if missing:
    rows = "".join(f"<li><b>{E(s.get('store'))}</b> — {E(s.get('status'))}: {E(s.get('note') or s.get('vibe') or '')}</li>" for s in missing)
    miss_html = f'<section class="missing"><h2>Not on the board</h2><ul>{rows}</ul></section>'

n_items = sum(len(s["items"]) for s in live)
page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>The Texture Edit</title>
<style>
:root {{
  --bg: #f3efe7; --card: #fbf9f4; --ink: #22201c; --muted: #6c665b; --line: #ddd6c8;
  --accent: #7a4a2a; --sale: #9b2c1f; --ph: #e8e2d6;
  --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  --sans: ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #1b1a17; --card: #242220; --ink: #ece6da; --muted: #a39b8c; --line: #3a3631;
  --accent: #d19a6a; --sale: #e0826f; --ph: #2e2b27; }} }}
:root[data-theme="dark"] {{
  --bg: #1b1a17; --card: #242220; --ink: #ece6da; --muted: #a39b8c; --line: #3a3631;
  --accent: #d19a6a; --sale: #e0826f; --ph: #2e2b27; }}
* {{ box-sizing: border-box; }}
html {{ scroll-behavior: smooth; }}
body {{ margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 var(--sans); }}
a {{ color: inherit; }}
.wrap {{ max-width: 1480px; margin: 0 auto; padding: 40px 16px 64px; }}
.top h1 {{ font: 500 clamp(32px, 5vw, 52px)/1.05 var(--serif); margin: 0 0 10px; letter-spacing: -0.01em; }}
.top p {{ margin: 0; color: var(--muted); max-width: 70ch; }}
.index {{ display: flex; flex-wrap: wrap; gap: 6px; margin: 22px 0 32px; }}
.index a {{ text-decoration: none; font-size: 13px; padding: 5px 10px; border: 1px solid var(--line);
  border-radius: 999px; background: var(--card); white-space: nowrap; }}
.index a span {{ color: var(--muted); font-variant-numeric: tabular-nums; }}
.index a:hover {{ border-color: var(--accent); }}
.grid {{ display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 560px), 1fr)); }}
.store {{ background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 18px;
  scroll-margin-top: 16px; display: flex; flex-direction: column; gap: 14px; }}
.store header {{ display: flex; flex-direction: column; gap: 6px; }}
.title {{ display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }}
.store h2 {{ font: 500 24px/1.1 var(--serif); margin: 0; }}
.store h2 a {{ text-decoration: none; }}
.store h2 a:hover {{ color: var(--accent); }}
.range {{ margin: 0; display: flex; gap: 10px; font-size: 12px; color: var(--muted);
  font-variant-numeric: tabular-nums; text-transform: uppercase; letter-spacing: .04em; }}
.vibe {{ margin: 0; font: italic 15px/1.45 var(--serif); color: var(--muted); }}
.items {{ display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); }}
.items.n3 {{ grid-template-columns: repeat(3, 1fr); }}
.items.n2 {{ grid-template-columns: repeat(2, 1fr); }}
@media (max-width: 640px) {{ .items, .items.n3 {{ grid-template-columns: repeat(2, 1fr); }} }}
.item {{ text-decoration: none; display: flex; flex-direction: column; gap: 8px; min-width: 0; }}
.ph {{ aspect-ratio: 4 / 5; background: var(--ph); border-radius: 6px; overflow: hidden; }}
.ph img {{ width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .4s ease; }}
.item:hover .ph img {{ transform: scale(1.04); }}
.item:hover h3 {{ text-decoration: underline; text-underline-offset: 2px; }}
.noimg {{ height: 100%; display: grid; place-items: center; color: var(--muted); font-size: 12px; }}
.meta p, .meta h3 {{ margin: 0; }}
.brand {{ font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }}
.meta h3 {{ font-size: 14px; font-weight: 600; line-height: 1.3; }}
.fabric {{ font-size: 12.5px; color: var(--muted); margin-top: 3px !important; }}
.price {{ font-size: 14px; margin-top: 5px !important; font-variant-numeric: tabular-nums; }}
.price s {{ color: var(--muted); font-size: 12px; }}
.sale {{ color: var(--sale); font-weight: 600; }}
.pnote {{ font-size: 11px; color: var(--muted); }}
.caveat {{ margin: 0; font-size: 12px; color: var(--sale); }}
.missing {{ margin-top: 40px; color: var(--muted); font-size: 14px; }}
.missing h2 {{ font: 500 20px var(--serif); color: var(--ink); }}
.missing li {{ margin-bottom: 6px; }}
footer {{ margin-top: 40px; font-size: 12px; color: var(--muted); }}
</style>
</head>
<body>
<div class="wrap">
  <section class="top">
    <h1>The Texture Edit</h1>
    <p>{len(live)} stores · {n_items} pieces in slub, bouclé, moleskin, flannel, tweed, cord and heavy cloth. Regular to relaxed-tapered cuts, all new and under ${MAX_PRICE}. Stores are sorted by median price, low to high.</p>
  </section>
  <nav class="index">{index}</nav>
  <main class="grid">{''.join(cards)}</main>
  {miss_html}
  <footer>Prices and stock were checked on each store's site on 2026-09-25. Converted prices are marked on the item. Images are embedded, so this page works offline.</footer>
</div>
</body>
</html>"""

with open(OUT, "w") as f:
    f.write(page)
print(f"wrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
