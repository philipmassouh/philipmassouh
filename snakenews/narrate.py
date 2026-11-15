#!/usr/bin/env python3
"""Narrate SnakeNews articles in Philip's cloned ElevenLabs voice.

Each article is snakenews/articles/<slug>.json with "headline", "summary" and
"body" (paragraphs split by blank lines). Its narration goes to
snakenews/audio/<slug>.mp3. Articles that already have audio are skipped
unless --force is given.

    .venv/bin/pip install -r snakenews/requirements.txt
    .venv/bin/python snakenews/narrate.py            # every article missing audio
    .venv/bin/python snakenews/narrate.py welcome    # just one slug

The SDK reads ELEVENLABS_API_KEY from the environment; locally it's loaded
from .env.local at the repo root.
"""
import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ARTICLES = HERE / "articles"
AUDIO = HERE / "audio"

# Must run before importing elevenlabs: the client reads ELEVENLABS_API_KEY
# from the environment at import time.
load_dotenv(HERE.parent / ".env.local")

from elevenlabs import ElevenLabs, VoiceSettings  # noqa: E402

VOICE_ID = os.environ.get("SNAKENEWS_VOICE_ID", "fV7pNBVqy6h7C4RgTFUL")  # "Philip" clone
MODEL_ID = "eleven_v4"
# A little less stable than a straight newsreader, for the drama.
VOICE_SETTINGS = VoiceSettings(stability=0.6, similarity_boost=0.8)
# Long articles are narrated a few paragraphs at a time; request stitching
# (previous_text / next_text) keeps the joins from popping or changing tone.
CHUNK_CHARS = 2500


def script_for(article):
    parts = [article["headline"] + ".", article["summary"]]
    parts += [p.strip() for p in article["body"].split("\n\n") if p.strip()]
    return parts


def chunk(paragraphs):
    chunks, current = [], ""
    for p in paragraphs:
        if current and len(current) + len(p) + 2 > CHUNK_CHARS:
            chunks.append(current)
            current = p
        else:
            current = f"{current}\n\n{p}" if current else p
    if current:
        chunks.append(current)
    return chunks


def narrate(client, slug, force=False):
    out = AUDIO / f"{slug}.mp3"
    if out.exists() and not force:
        print(f"skip {slug} (audio exists)")
        return
    article = json.loads((ARTICLES / f"{slug}.json").read_text())
    chunks = chunk(script_for(article))
    tmp = out.with_suffix(".mp3.part")
    with open(tmp, "wb") as f:
        for i, text in enumerate(chunks):
            audio = client.text_to_speech.convert(
                text=text,
                voice_id=VOICE_ID,
                model_id=MODEL_ID,
                voice_settings=VOICE_SETTINGS,
                output_format="mp3_44100_128",
                apply_text_normalization="on",
                previous_text=chunks[i - 1] if i > 0 else None,
                next_text=chunks[i + 1] if i + 1 < len(chunks) else None,
            )
            for piece in audio:
                f.write(piece)
    tmp.replace(out)
    print(f"wrote {out.relative_to(HERE.parent)} ({len(chunks)} part(s))")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("slugs", nargs="*", help="articles to narrate (default: all)")
    parser.add_argument("--force", action="store_true", help="re-narrate existing audio")
    args = parser.parse_args()

    AUDIO.mkdir(exist_ok=True)
    slugs = args.slugs or sorted(p.stem for p in ARTICLES.glob("*.json"))
    if not slugs:
        sys.exit("no articles in snakenews/articles")
    client = ElevenLabs()
    for slug in slugs:
        narrate(client, slug, force=args.force)


if __name__ == "__main__":
    main()
