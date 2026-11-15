#!/usr/bin/env python3
"""Write snakenews/articles/index.json, the list the page loads.

Run after adding or narrating articles:

    python3 snakenews/build.py

Each article is snakenews/articles/<slug>.json:
    headline, summary, body   the SnakeNews rewrite (body: paragraphs split by blank lines)
    date                      YYYY-MM-DD the incident was reported
    location                  e.g. "Maricopa County, AZ"
    source                    {"name": ..., "url": ...} of the original story (optional)
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARTICLES = HERE / "articles"
AUDIO = HERE / "audio"
FIELDS = ("headline", "summary", "date", "location")


def main():
    items = []
    for path in sorted(ARTICLES.glob("*.json")):
        if path.name == "index.json":
            continue
        article = json.loads(path.read_text())
        missing = [f for f in FIELDS if not article.get(f)]
        if missing:
            raise SystemExit(f"{path.name}: missing {', '.join(missing)}")
        item = {"slug": path.stem, **{f: article[f] for f in FIELDS}}
        item["audio"] = (AUDIO / f"{path.stem}.mp3").exists()
        item["words"] = len(article.get("body", "").split())
        items.append(item)
    items.sort(key=lambda a: (a["date"], a["slug"]), reverse=True)
    (ARTICLES / "index.json").write_text(json.dumps(items, indent=1) + "\n")
    print(f"indexed {len(items)} article(s)")


if __name__ == "__main__":
    main()
