---
name: add-spot
description: Add one or more restaurants to restaurants.json. Use when the user pastes Google Maps URLs, restaurant names, or website links and asks to add them to their list. Asks the user for ratings and tags, fetches addresses from each site, appends to the JSON, then runs encode_latlng.py.
user-invocable: true
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - WebFetch
  - AskUserQuestion
---

# /add-spot — Append restaurants to restaurants.json

Working file: `restaurants.json` (array of records). Schema, copied from existing entries:

```json
{
  "Name": "string",
  "Tags": ["string", ...],
  "Patio": true,
  "Noise": 0, "Chaos": 0, "Atmosphere": 0,
  "Service": 0, "Food": 0, "Price": 0, "Value": 0,
  "Site": "https://...",
  "Instagram": "https://www.instagram.com/<handle>/",
  "Yelp": "https://www.yelp.com/biz/<slug>",
  "Addresses": "Street, City, ST ZIP",
  "Comments": "string",
  "lat": null, "lng": null
}
```

All numeric fields are 0–5 integers (higher = more). Higher `Price` = more expensive. Higher `Value` = better deal.

## Procedure

For each restaurant the user wants to add:

1. **Identify** the name and Site URL from what the user pasted. Google Maps links are not the Site — find the actual restaurant website (the user usually pastes it on the next line).

2. **Ask the user** for the subjective data in as few `AskUserQuestion` calls as possible. Batch questions; don't ask one field at a time. Suggested shape:
   - Q1 (multiSelect): tags. Reuse existing tags from the JSON when sensible (Tacos, Mexican, Chinese, Seafood, Steak, Brunch, Cocktails, Date Night, Fast Casual, etc.).
   - Q2: Patio yes/no.
   - Q3: Food / Price / Value as a combined preset list ("F4 P3 V3", "F3 P2 V3", …) plus an "Other — I'll type" option for custom values.
   - Q4: Service / Atmosphere / Noise / Chaos + comment as combined presets + "Other — I'll type".

   When the user picks "Other", call `AskUserQuestion` again with 2 options ("Skip" + "I'll type via Other") so they can type their values via the Other field. Parse loose formats: "F4 P3 V3", "food:3,price:3,value:3", "service 2, atmosphere 4, ...". Be liberal in what you accept.

3. **Fetch the address** with `WebFetch` against the Site, prompting for "the full street address. Just the street address." Strip suite/unit numbers from the address before saving — Nominatim chokes on them ("Suite 140" causes geocoding failures).

4. **Derive social URLs** from the website's domain or restaurant name:
   - Instagram: `https://www.instagram.com/<plausible-handle>/`
   - Yelp: `https://www.yelp.com/biz/<name-city-slug>` (kebab-case, e.g. `dan-modern-chinese-manhattan-beach`)

   Don't WebFetch to verify; the user can fix these later if they're wrong.

5. **Append** the new record(s) to `restaurants.json`. The existing convention is to append to the end (entries are not strictly alphabetical). Use `Edit` to replace the final `}\n]` with `},\n  { …new record… }\n]`. Set `"lat": null, "lng": null`.

6. **Geocode** by running `python encode_latlng.py restaurants.json`. This skips records that already have lat/lng and only geocodes the new ones. If any record fails (warning line "Failed to geocode address"), simplify that address (drop suite/unit) and re-run.

7. **Report** a short summary per spot: name, address, FPV / SANC, patio. Don't dump the full JSON.

## Comment style

Preserve the user's voice when they give you a comment — typos, slang, opinions, profanity all stay. Lightly clean grammar/spelling only (e.g. "atmo" → "atmosphere" is fine; rewriting the sentence is not). When the user writes "comment: …", everything after "comment:" is the comment verbatim modulo light cleanup.

## Notes

- `encode_latlng.py` uses Nominatim with a 1-second rate limit; running it on the whole file is fine — it skips records that already have coordinates.
- If the user gives only a name (no Site), ask for the website before WebFetching.
- Don't invent ratings the user didn't give. If they skip a field, default it to 0 (matches existing conventions for fields the user hasn't filled in — see Adam Perry Lang's Noise/Chaos/Atmosphere).
