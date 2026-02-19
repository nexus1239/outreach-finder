#!/usr/bin/env node
'use strict';

// ── REQUIRES ─────────────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

// ── ENV ───────────────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── TIMING ────────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── PROGRESS BAR ─────────────────────────────────────────────────────────────
const COLS = () => process.stdout.columns || 100;

function drawProgress(done, total, label) {
  const barWidth = 28;
  const pct = total > 0 ? done / total : 0;
  const filled = Math.round(pct * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const pctStr = (Math.round(pct * 100) + '%').padStart(4);
  const prefix = `[${bar}] ${pctStr}  `;
  const maxLabel = COLS() - prefix.length - 2;
  const truncated = label.length > maxLabel ? label.slice(0, maxLabel - 1) + '…' : label;
  process.stdout.write('\r' + prefix + truncated + ' '.repeat(Math.max(0, COLS() - prefix.length - truncated.length - 1)));
}

function clearLine() {
  process.stdout.write('\r' + ' '.repeat(COLS()) + '\r');
}

function log(msg) {
  clearLine();
  console.log(msg);
}

// ── GOOGLE CUSTOM SEARCH ──────────────────────────────────────────────────────
async function searchGoogle(query, apiKey, cseId) {
  const url = 'https://www.googleapis.com/customsearch/v1?' + new URLSearchParams({
    key: apiKey,
    cx:  cseId,
    q:   query,
    num: 10,
  });

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let hint = '';
    if (res.status === 403) hint = ' (API key invalid, quota exceeded, or Custom Search JSON API not enabled in Google Cloud)';
    if (res.status === 400) hint = ' (bad request — check CSE ID)';
    throw new Error(`HTTP ${res.status}${hint}: ${body.slice(0, 240)}`);
  }

  const data = await res.json();
  return (data.items || []).map(item => ({
    title:   item.title   || '',
    url:     item.link    || '',
    snippet: item.snippet || '',
  }));
}

// ── PAGE FETCH ────────────────────────────────────────────────────────────────
async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(9000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
        'Accept':     'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;
    // Cap at 500 KB to keep things fast
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 512_000) {
      return Buffer.from(buf).slice(0, 512_000).toString('utf8', 0, 512_000);
    }
    return Buffer.from(buf).toString('utf8');
  } catch {
    return null;
  }
}

// ── EXTRACT EMAILS ────────────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,7}/g;

// Common false-positive patterns to filter out
const EMAIL_BLOCKLIST = [
  /^noreply@/i, /^no-reply@/i, /^donotreply@/i,
  /^example\./i, /^test@/i, /^user@/i, /^email@/i,
  /\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf)$/i,
  /@2x\./i, /@3x\./i, /@x2\./i,
  /sentry\.io$/i, /example\.com$/i, /example\.org$/i,
  /schema\.org$/i, /w3\.org$/i, /yoursite\.com$/i,
  /domain\.com$/i, /website\.com$/i,
];

function extractEmails(html) {
  if (!html) return [];
  const raw = [...new Set(html.match(EMAIL_RE) || [])];
  return raw.filter(e => !EMAIL_BLOCKLIST.some(p => p.test(e)));
}

// ── EXTRACT CONTACT/SUBMISSION PAGE LINK ──────────────────────────────────────
const CONTACT_HREF_RE = /write.?for.?us|guest.?post|contribut|submit.?article|submission|contact|pitch/i;

function extractContactPage(html, pageUrl) {
  if (!html) return null;
  let base;
  try { base = new URL(pageUrl); } catch { return null; }

  // Pull all href values with a single pass
  const hrefRe = /href=["']([^"'#\s]{1,300})["']/gi;
  let m;
  const candidates = [];

  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (CONTACT_HREF_RE.test(href)) {
      try {
        candidates.push(new URL(href, base.origin + base.pathname).toString());
      } catch { /* skip malformed */ }
    }
  }

  if (candidates.length === 0) return null;

  // Prefer write-for-us / guest-post links over generic contact
  const priority = candidates.find(u =>
    /write.?for.?us|guest.?post|contribut|submit.?article|submission/i.test(u)
  );
  return priority || candidates[0];
}

// ── EXTRACT SITE NAME FROM HTML TITLE ────────────────────────────────────────
function parseSiteName(html, fallbackTitle, url) {
  // Try <title> tag first
  const titleMatch = html && html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const raw = titleMatch ? titleMatch[1].trim() : (fallbackTitle || '');

  if (raw) {
    // "Article Title | Site Name" or "Site Name — Article Title"
    const parts = raw.split(/\s*[\|–—]\s*/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1].trim();
      const first = parts[0].trim();
      // Site name is usually shorter
      const candidate = (last.length < first.length && last.length > 2) ? last : first;
      if (candidate.length <= 60) return candidate;
    }
    if (raw.length <= 60) return raw;
  }

  // Fallback to hostname
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// ── DEDUPLICATE ────────────────────────────────────────────────────────────────
function deduplicateByHost(results) {
  const seen = new Map(); // hostname+pathname → index
  return results.filter(r => {
    let key;
    try {
      const u = new URL(r.url);
      key = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
    } catch {
      key = r.url;
    }
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

// ── WRITE CSV ─────────────────────────────────────────────────────────────────
const CSV_COLS = ['site_name', 'url', 'contact_page', 'email', 'niche', 'status', 'notes'];

function toCsv(targets) {
  const escape = v => '"' + String(v || '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
  const rows = targets.map(t => CSV_COLS.map(c => escape(t[c])).join(','));
  return [CSV_COLS.join(','), ...rows].join('\n');
}

// ── WRITE PITCH TEMPLATES ─────────────────────────────────────────────────────
function writePitchTemplates(outDir) {
  const md = `\
# Outreach Email Templates

Three ready-to-send templates for guest post pitches.
**Replace every \`[BRACKETED]\` field before sending.**

---

## Template A — Value-First Pitch
*Offer a specific article idea with a full outline.*
**Best for:** Blogs with clear editorial guidelines and an obvious content gap you can fill.

**Subject:** Guest post idea for [SITE_NAME]: "[ARTICLE_TITLE]"

---

Hi [EDITOR_NAME],

I'm a [BRIEF_CREDENTIAL] who covers [YOUR_NICHE] at [MY_SITE]. I've been following [SITE_NAME] for a while — your piece on [REFERENCE_SPECIFIC_ARTICLE] was especially good.

I'd love to contribute a guest post titled:

**"[ARTICLE_TITLE]"**

Quick outline:

1. **Introduction** — [1-2 sentence hook: the specific problem/question the article addresses]
2. **[SECTION_1_TITLE]** — [what this covers and why it matters to their audience]
3. **[SECTION_2_TITLE]** — [what this covers and why it matters to their audience]
4. **[SECTION_3_TITLE]** — [what this covers and why it matters to their audience]
5. **Key takeaways** — [what the reader walks away knowing or able to do]

The article would be ~[WORD_COUNT] words, backed by [peer-reviewed research / primary sources / original data]. I can deliver a polished draft within [TIMEFRAME, e.g. 5 business days].

Does this fit your editorial calendar? Happy to adjust the angle or swap sections if you have a better fit in mind.

Best,
[MY_NAME]
[MY_SITE]
[MY_EMAIL]

---

## Template B — Data / Research Pitch
*Offer exclusive original data or a new analysis.*
**Best for:** Blogs that publish data-driven features, case studies, or industry reports.

**Subject:** Exclusive data piece for [SITE_NAME] — [RESEARCH_TOPIC]

---

Hi [EDITOR_NAME],

My name is [MY_NAME] — I run [MY_SITE] and have been writing about [YOUR_NICHE] for [TIME_PERIOD].

I'm reaching out because I've just finished an analysis I think would land well with [SITE_NAME]'s audience:

**"[ARTICLE_TITLE]: What [DATA_SOURCE] Reveals About [TOPIC]"**

Three headline findings:

- **[FINDING_1]** — [why this is surprising or important]
- **[FINDING_2]** — [why this is relevant to your specific reader]
- **[FINDING_3]** — [the actionable implication]

This data hasn't been published anywhere. I'd like to offer [SITE_NAME] first publication, with full methodology included, in exchange for a byline and one contextual link back to [MY_SITE].

I can share a draft or the raw dataset for review first — whichever you prefer.

Best,
[MY_NAME]
[MY_SITE]
[MY_EMAIL]

---

## Template C — Expert Quote / Roundup Contribution
*Offer a short, citable expert perspective.*
**Best for:** Blogs that publish expert roundups, or as a low-friction first touchpoint before pitching a full article.

**Subject:** Expert quote for [SITE_NAME] — [TOPIC]

---

Hi [EDITOR_NAME],

I came across [SITE_NAME] while researching [TOPIC] and noticed you publish expert roundup posts — the one on [REFERENCE_SPECIFIC_ROUNDUP] was a great read.

I'd love to contribute an expert perspective to any upcoming piece you're working on. Topics where I can add genuine depth:

- [TOPIC_1]
- [TOPIC_2]
- [TOPIC_3]

About me: [1-2 sentence bio — credential, what you're known for, your site]. I can provide a [100–200 word] comment with a study citation or data point if that helps.

No payment needed — just a byline and site link if published.

If you don't have a roundup in the works, I'm also happy to pitch a standalone article. Let me know what fits.

Best,
[MY_NAME]
[MY_SITE]
[MY_EMAIL]

---

## Personalisation Checklist

Before hitting send on any template, confirm:

- [ ] \`[SITE_NAME]\` — the blog's name (not the domain)
- [ ] \`[EDITOR_NAME]\` — check the About page, Contact page, or LinkedIn. Use "Hi there" if genuinely unknown
- [ ] \`[ARTICLE_TITLE]\` — a specific headline, not a topic area
- [ ] \`[REFERENCE_SPECIFIC_ARTICLE]\` — shows you actually read their site (Template A / C)
- [ ] \`[FINDING_1/2/3]\` — real numbers, not placeholders (Template B)
- [ ] \`[TOPIC_1/2/3]\` — relevant to *that blog's* specific audience (Template C)
- [ ] \`[MY_NAME]\`, \`[MY_SITE]\`, \`[MY_EMAIL]\` — your actual details

## Sending Tips

- **Domain email only** — send from yourname@yoursite.com, not Gmail
- **Warm before cold** — follow the blog on social and engage with one post before emailing
- **One follow-up** — if no reply after 5–7 business days, one short nudge is fine. Then move on
- **Track everything** — use the \`status\` column in \`outreach-targets.csv\`:
  - \`Sent\` → \`Replied\` → \`Accepted\` / \`Rejected\` / \`Ghosted\`
- **Avoid Mondays and Fridays** — Tuesday–Thursday morning (recipient's timezone) gets the best open rates
`;

  fs.writeFileSync(path.join(outDir, 'pitch-templates.md'), md, 'utf8');
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  loadEnv();

  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId  = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId) {
    console.error('\n❌  Error: GOOGLE_API_KEY and GOOGLE_CSE_ID must be set in .env or environment.');
    console.error('   Copy .env.example to .env and fill in your credentials.\n');
    process.exit(1);
  }

  const nichesPath = path.join(process.cwd(), 'niches.txt');
  if (!fs.existsSync(nichesPath)) {
    console.error('\n❌  Error: niches.txt not found in', process.cwd());
    process.exit(1);
  }

  const niches = fs.readFileSync(nichesPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (niches.length === 0) {
    console.error('\n❌  Error: niches.txt is empty or contains only comments.');
    process.exit(1);
  }

  const suffixes = [
    'write for us',
    'guest post',
    'contribute',
    'submit article',
  ];

  const totalSearches = niches.length * suffixes.length;

  console.log('\n🔍  Outreach Finder — Guest Post Opportunity Scanner');
  console.log('─'.repeat(54));
  console.log(`   Niches: ${niches.length}   Queries per niche: ${suffixes.length}   Total API calls: ${totalSearches}`);
  console.log(`   Rate limit: 1 request / 2 s\n`);

  // ── PHASE 1: SEARCH ────────────────────────────────────────────────────────
  const rawResults = []; // {title, url, snippet, niche, query}
  let searchErrors = 0;
  let done = 0;

  for (const niche of niches) {
    for (const suffix of suffixes) {
      const query = `${niche} ${suffix}`;
      drawProgress(done, totalSearches, `Searching: ${query}`);

      try {
        const results = await searchGoogle(query, apiKey, cseId);
        for (const r of results) rawResults.push({ ...r, niche, query });
      } catch (err) {
        searchErrors++;
        log(`  ⚠  Search failed — "${query}": ${err.message}`);
      }

      done++;
      if (done < totalSearches) await sleep(2000);
    }
  }

  clearLine();
  log(`✓  Phase 1 complete — ${rawResults.length} raw results, ${searchErrors} search error(s)`);

  // ── DEDUPLICATE ────────────────────────────────────────────────────────────
  const unique = deduplicateByHost(rawResults);
  log(`   Deduplication: ${rawResults.length} → ${unique.length} unique sites\n`);

  if (unique.length === 0) {
    log('⚠  No results to process. Check your API key / CSE ID and try again.');
    process.exit(0);
  }

  // ── PHASE 2: FETCH PAGES ──────────────────────────────────────────────────
  log(`📄  Phase 2 — Fetching pages to extract emails & contact links…`);
  log(`   Estimated time: ~${Math.ceil((unique.length * 2) / 60)} min at 1 req/2 s\n`);

  const targets = [];
  let fetchErrors = 0;
  done = 0;

  for (const r of unique) {
    drawProgress(done, unique.length, `Fetching: ${r.url}`);

    let html = null;
    try {
      html = await fetchPage(r.url);
    } catch {
      fetchErrors++;
    }

    const emails      = extractEmails(html);
    const contactPage = extractContactPage(html, r.url);
    const siteName    = parseSiteName(html, r.title, r.url);

    // Truncate snippet for notes field
    const notes = r.snippet ? r.snippet.replace(/\s+/g, ' ').slice(0, 120) : '';

    targets.push({
      site_name:    siteName,
      url:          r.url,
      contact_page: contactPage || '',
      email:        emails.join('; '),
      niche:        r.niche,
      status:       '',
      notes,
    });

    done++;
    if (done < unique.length) await sleep(2000);
  }

  clearLine();
  log(`✓  Phase 2 complete — ${targets.length} targets processed, ${fetchErrors} fetch error(s)\n`);

  // ── PHASE 3: WRITE OUTPUT ──────────────────────────────────────────────────
  const outDir = process.cwd();

  // JSON
  const jsonPath = path.join(outDir, 'outreach-targets.json');
  fs.writeFileSync(jsonPath, JSON.stringify(targets, null, 2), 'utf8');

  // CSV
  const csvPath = path.join(outDir, 'outreach-targets.csv');
  fs.writeFileSync(csvPath, toCsv(targets), 'utf8');

  // Pitch templates
  writePitchTemplates(outDir);

  // Stats
  const withEmail   = targets.filter(t => t.email).length;
  const withContact = targets.filter(t => t.contact_page).length;

  log(`📊  Results summary`);
  log(`   Total targets:       ${targets.length}`);
  log(`   With email found:    ${withEmail}`);
  log(`   With contact page:   ${withContact}`);
  log(`   Search errors:       ${searchErrors}`);
  log(`   Fetch errors:        ${fetchErrors}`);
  log('');
  log(`📁  Output files written:`);
  log(`   outreach-targets.json`);
  log(`   outreach-targets.csv`);
  log(`   pitch-templates.md`);
  log('\n✅  Done!\n');
}

main().catch(err => {
  clearLine();
  console.error('\n❌  Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
