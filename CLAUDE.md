# Outreach Finder

- **Type:** Node.js CLI tool
- **Requires:** Node 18+
- **Dependencies:** None (uses built-in fetch)

## What This Is

Guest post opportunity finder. Searches Google for "write for us", "guest post", "contribute", "submit article" queries per niche. Fetches pages, extracts contact emails, detects submission links, deduplicates.

## Usage

```bash
node outreach-finder.js
```

Reads niches from `niches.txt`, outputs structured data + CSV + pitch templates.

## Structure

- `outreach-finder.js` — main script
- `filter.js` — result filtering
- `niches.txt` — input niches (one per line)
- `.env` — Google API key and Search Engine ID
- `outreach-targets.csv` — import-ready output
- `outreach-targets.json` — full structured data
- `pitches-ready.md/.html` — email templates

## API Limits

Rate-limited: configurable via `API_REQUEST_DELAY` env var (default: 2000ms). Daily quota tracked and enforced via `API_DAILY_QUOTA` env var (default: 100). Warns at 80% usage, stops gracefully at limit. 8 niches ≈ 10 minutes runtime.
