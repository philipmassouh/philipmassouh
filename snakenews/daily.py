#!/usr/bin/env python3
"""The daily SnakeNews run: find new US snakebite stories, rewrite, narrate.

1. Find: DeepSeek searches the live web with Exa (web_search / get_contents
   tools) and returns new US snakebite incidents we haven't covered.
2. Rewrite: for each one, Exa fetches the article text and DeepSeek writes the
   long SnakeNews version as snakenews/articles/<slug>.json.
3. Narrate each new article (narrate.py) and rebuild the index (build.py).

    .venv/bin/python snakenews/daily.py               # full run
    .venv/bin/python snakenews/daily.py --dry-run     # find only, print candidates
    .venv/bin/python snakenews/daily.py --no-audio    # skip ElevenLabs

Keys come from the environment (locally, .env.local at the repo root):
EXA_API_KEY, DEEPSEEK_API_KEY, ELEVENLABS_API_KEY.
"""
import argparse
import json
import os
import re
import sys
from datetime import date, timedelta
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ARTICLES = HERE / "articles"
SEEN = HERE / "seen.json"  # source URLs already covered or rejected

load_dotenv(HERE.parent / ".env.local")

from exa_py import Exa  # noqa: E402
from openai import OpenAI  # noqa: E402

import build  # noqa: E402

MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-pro")
MAX_STORIES = int(os.environ.get("SNAKENEWS_MAX_STORIES", "3"))
LOOKBACK_DAYS = 3
MAX_TOOL_ROUNDS = 10

FIND_PROMPT = """You are the research desk for SnakeNews, a private joke news site.
Use the web_search tool (and get_contents when a page needs a closer read) to find
news reports of specific snakebite incidents involving people in the United States,
published between {start} and {today}.

Search several ways: general snakebite news, and by species (rattlesnake,
copperhead, cottonmouth / water moccasin, coral snake). When you call web_search,
always write an objective saying which pages should rank first (local news reports
of a specific person bitten in the US) and which to exclude.

Keep a story only if:
- a real person was bitten by a snake, in the United States
- it was published in the window above (re-reports of older bites are fine only if newly published)
- it is a news report, not a 911 dispatch alert, forum post, blog, how-to, or research paper
- its URL is not in the already-covered list, and it is not the same incident as a covered story

Already covered (skip these, and other reports of the same incidents):
{seen}

When you are done searching, reply with only JSON, no prose:
{{"stories": [{{"url": "...", "outlet": "...", "published": "YYYY-MM-DD",
  "location": "City or County, ST", "why": "one line on the incident"}}]}}
Return at most {max} stories, best first. Return {{"stories": []}} if none qualify."""

REWRITE_PROMPT = """You write for SnakeNews, a private joke news site that Philip
made for his dad and uncle, who are convinced snakes are coming for him in Santa Monica.
Philip is the SnakeNews anchor and reads every story aloud in first person
("I'm Philip Massouh, and this is SnakeNews"), so write for the ear, in his voice.

Rewrite the source article below as a SnakeNews story. Voice: breathless local-TV
anchor energy, ominous and melodramatic about snakes, warm toward the people involved.
Length matters: 700 to 1000 words in the body.

Hard rules:
- Every fact (who, where, when, what snake, injuries, outcome) comes from the source.
  Do not invent facts, injuries, deaths, or quotes from anyone in the story.
  You may use up to three short quotes that appear in the source.
- Write it in your own words; do not copy sentences from the source.
- Never give a street address. City, county or region only.
- Do not name children; say "a 7-year-old girl" instead.
- Make it long with SnakeNews material instead of made-up facts: a cold open, a
  "SnakeNews Safety Desk" segment with real, sensible snakebite advice (call 911,
  stay calm, keep the limb still, no tourniquets, no cutting or sucking), what the
  species is and where it lives, a "Santa Monica check-in" tying it back to Philip
  being fine, and a sign-off. Fictional SnakeNews staff may comment; real people may not.
- Plain paragraphs separated by blank lines. No markdown, headings, or lists.

Reply with only JSON:
{{"headline": "...", "summary": "one or two sentences", "body": "...",
  "date": "{published}", "location": "{location}"}}

Source ({outlet}, {url}):
{text}"""


def deepseek():
    return OpenAI(api_key=os.environ["DEEPSEEK_API_KEY"], base_url="https://api.deepseek.com")


def load_seen():
    return json.loads(SEEN.read_text()) if SEEN.exists() else []


def covered_urls():
    urls = set(load_seen())
    for path in ARTICLES.glob("*.json"):
        if path.name != "index.json":
            src = json.loads(path.read_text()).get("source") or {}
            if src.get("url"):
                urls.add(src["url"])
    return sorted(urls)


def parse_json(content):
    content = content.strip()
    if content.startswith("```"):
        content = re.sub(r"^```\w*\n|\n```$", "", content)
    return json.loads(content)


def find_stories(llm, exa, today):
    start = today - timedelta(days=LOOKBACK_DAYS)
    seen = covered_urls()
    prompt = FIND_PROMPT.format(
        start=start.isoformat(), today=today.isoformat(),
        seen="\n".join(f"- {u}" for u in seen[-200:]) or "(none yet)", max=MAX_STORIES,
    )
    tools = [exa.openai.web_search(), exa.openai.get_contents()]
    messages = [{"role": "system", "content": prompt},
                {"role": "user", "content": "Find today's stories."}]
    for _ in range(MAX_TOOL_ROUNDS):
        reply = llm.chat.completions.create(model=MODEL, messages=messages, tools=tools)
        message = reply.choices[0].message
        messages.append(message)
        if not message.tool_calls:
            stories = parse_json(message.content or "{}").get("stories", [])
            return [s for s in stories if s.get("url") and s["url"] not in seen][:MAX_STORIES]
        for call in message.tool_calls:
            print(f"  {call.function.name}: {call.function.arguments[:120]}")
        messages += exa.openai.handle_tool_calls(message)
    raise SystemExit("research desk never finished searching")


def slugify(text, today):
    words = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-").split("-")
    slug = f"{today.isoformat()}-{'-'.join(words[:8])}"
    n, candidate = 2, slug
    while (ARTICLES / f"{candidate}.json").exists():
        candidate, n = f"{slug}-{n}", n + 1
    return candidate


def rewrite(llm, exa, story, today):
    page = exa.get_contents([story["url"]], text=True).results
    text = page[0].text if page and page[0].text else ""
    if len(text) < 400:
        print(f"  skip {story['url']}: couldn't read the article")
        return None
    prompt = REWRITE_PROMPT.format(
        published=story.get("published") or today.isoformat(),
        location=story.get("location", ""), outlet=story.get("outlet", ""),
        url=story["url"], text=text[:20000],
    )
    reply = llm.chat.completions.create(
        model=MODEL, messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
    )
    article = parse_json(reply.choices[0].message.content)
    article["source"] = {"name": story.get("outlet") or story["url"], "url": story["url"]}
    slug = slugify(article["headline"], today)
    (ARTICLES / f"{slug}.json").write_text(json.dumps(article, indent=2) + "\n")
    print(f"  wrote articles/{slug}.json ({len(article['body'].split())} words)")
    return slug


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="find stories, write nothing")
    parser.add_argument("--no-audio", action="store_true", help="skip narration")
    args = parser.parse_args()

    today = date.today()
    llm, exa = deepseek(), Exa()  # Exa reads EXA_API_KEY from the environment

    print("finding stories")
    stories = find_stories(llm, exa, today)
    for s in stories:
        print(f"  found {s.get('location')}: {s.get('why')} ({s['url']})")
    if args.dry_run:
        return
    if not stories:
        print("no new snake news today")

    slugs = []
    seen = load_seen()
    for story in stories:
        print(f"rewriting {story['url']}")
        slug = rewrite(llm, exa, story, today)
        seen.append(story["url"])
        if slug:
            slugs.append(slug)
    SEEN.write_text(json.dumps(sorted(set(seen)), indent=1) + "\n")

    if slugs and not args.no_audio:
        import narrate
        from elevenlabs import ElevenLabs
        voice = ElevenLabs()
        for slug in slugs:
            narrate.narrate(voice, slug)
    build.main()


if __name__ == "__main__":
    sys.exit(main())
