# outreach-finder

A Node.js CLI tool that finds and organises guest post opportunities in any niche using Google Custom Search. Zero npm dependencies — pure Node 18+ built-ins.

## What it does

For each keyword in `niches.txt`, it runs four Google searches:
- `{niche} write for us`
- `{niche} guest post`
- `{niche} contribute`
- `{niche} submit article`

For each result it:
1. Fetches the page and scans for contact emails (regex)
2. Detects contact/submission page links
3. Deduplicates across all niches

Then outputs:
- `outreach-targets.json` — full structured data
- `outreach-targets.csv` — import into Google Sheets / Airtable / Notion
- `pitch-templates.md` — three ready-to-personalise outreach email templates

## Requirements

- Node.js 18 or later (`node --version`)
- Google Custom Search JSON API credentials (free tier: 100 queries/day)

## Setup

### 1. Get a Google API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Go to **APIs & Services → Library**
4. Search for **"Custom Search JSON API"** and click **Enable**
5. Go to **APIs & Services → Credentials → Create Credentials → API Key**
6. Copy the key

### 2. Create a Custom Search Engine

1. Go to [programmablesearch.google.com/create](https://programmablesearch.google.com/create)
2. Under "Sites to search", put `*` (or any placeholder — you'll change it)
3. Click **Create**, then **Customise**
4. In the control panel, go to **Basics** → turn on **"Search the entire web"**
5. Copy the **Search engine ID** (the `cx` value)

### 3. Configure credentials

```bash
cp .env.example .env
```

Edit `.env`:
```
GOOGLE_API_KEY=AIzaSy...
GOOGLE_CSE_ID=a1b2c3d4e5f...
```

### 4. Edit your niches

Edit `niches.txt` — one keyword per line, `#` for comments:
```
nootropics
biohacking
cognitive enhancement
brain health
```

### 5. Run

```bash
node outreach-finder.js
```

Or make it executable:
```bash
chmod +x outreach-finder.js
./outreach-finder.js
```

## Output files

### outreach-targets.csv

| Column | Description |
|---|---|
| `site_name` | Blog or site name parsed from page title |
| `url` | URL where the result was found |
| `contact_page` | Detected write-for-us / contact page URL |
| `email` | Email(s) found on the page (semicolon-separated) |
| `niche` | Which niche keyword triggered this result |
| `status` | **Fill in yourself** — e.g. Sent, Replied, Accepted |
| `notes` | Snippet from the search result |

### pitch-templates.md

Three templates:
- **Template A** — Value-first (specific article idea + outline)
- **Template B** — Data/research pitch (original findings)
- **Template C** — Expert roundup contribution (low-friction entry)

## Rate limits & quotas

- **Google Custom Search free tier:** 100 queries/day
- **Tool rate limit:** 1 request per 2 seconds (hardcoded)
- Default config: 8 niches × 4 queries = **32 searches** (well within free tier)
- Page fetching adds ~1 request per result (no API cost, just time)

**If you hit 429 errors:** wait until quota resets at midnight Pacific, or upgrade to paid ($5 per 1,000 queries).

## Estimated runtime

| Niches | Total searches | Phase 1 | Phase 2 (est.) | Total |
|---|---|---|---|---|
| 8 | 32 | ~65 s | ~8 min | ~10 min |
| 4 | 16 | ~33 s | ~4 min | ~5 min |

Phase 2 (page fetching) varies based on how many unique results are found.

## Tips

- Run with a narrow niche list first (2–3 keywords) to sanity-check your API credentials before burning quota
- Import `outreach-targets.csv` into Google Sheets and use the `status` column to track your pipeline
- The `contact_page` column is the most valuable — it's the exact URL to send your pitch to
- Sites without a detected email or contact page may still accept pitches via a contact form

## Troubleshooting

**`GOOGLE_API_KEY and GOOGLE_CSE_ID must be set`**
→ Make sure `.env` exists in the same directory you run the script from.

**HTTP 403 from Google API**
→ The Custom Search JSON API is not enabled on your project. Go to APIs & Services → Library, find it, and click Enable. Wait 1–2 minutes after enabling.

**HTTP 400 from Google API**
→ Your CSE ID is wrong. Double-check the `cx` value in the Programmable Search Engine control panel.

**`0 raw results`**
→ Your CSE may be restricted to specific sites. Make sure "Search the entire web" is ON in the CSE settings.

**Empty `email` and `contact_page` columns**
→ Many sites use contact forms rather than exposed email addresses. Use the `url` column as a starting point and manually check for a "Write for Us" page.
