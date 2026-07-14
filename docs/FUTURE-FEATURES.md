# Future features

Ideas scoped but not yet built. Newest first.

## Candidate online-profile check (web search) for Resume Parsing

**Goal:** when assessing a resume against a JD, also surface the candidate's other
online profiles (LinkedIn, GitHub, portfolio) and flag discrepancies — e.g. a
resume claiming "Data Engineer" while their LinkedIn title says "Data Analyst".

**Approach**
- Build targeted search queries from the parsed resume fields (name + top skills +
  location), e.g. `site:linkedin.com/in "Full Name" <skill>`, `site:github.com "Full Name"`,
  `"Full Name" data engineer <city>`.
- Call a search API server-side (Cloud Function), collect the top organic links.
- Show the results in the Resume Parsing result + Resume Report as clickable
  **"Possible online profiles"** links.
- Optional: feed the result **snippets** (titles + descriptions) to the existing
  LLM (Ollama/OpenAI, no browsing needed) to produce a short **consistency note**
  ("resume says Data Engineer; LinkedIn says Data Analyst — verify").

**Identifiers**
- **Name + skills + location** → best for *finding* profiles (common names = false matches).
- **Email** → best for *confirming* identity (via enrichment APIs like Clearbit / People
  Data Labs, if we later want higher precision).
- **Phone** → weak, expensive, legally fraught — skip.

**What's needed to build**
- **Google Programmable Search (Custom Search JSON API)** — free tier:
  - a **Google API key** (Cloud console → enable "Custom Search API")
  - a **Search Engine ID (cx)** from programmablesearchengine.google.com, "search the entire web"
  - store both as Firebase secrets (`GOOGLE_SEARCH_API_KEY`, `GOOGLE_SEARCH_CX`), like the others.
- Reuse the existing LLM for the consistency note (no new provider/cost).

**Pricing:** free up to **100 queries/day**; then **$5 / 1,000 queries** (cap 10k/day).
At ~1–3 queries per resume, ~30–100 candidates/day stays free.

**No-key alternative (not recommended):** scraping Google (blocked/CAPTCHA from server IPs,
ToS violation) or DuckDuckGo's unofficial HTML endpoint (rate-limited, thin, can break) —
flaky, ship only as a throwaway proof-of-concept.

**Guardrails (important — this screens people)**
- Show as **"possible matches, verify manually"** — never auto-reject.
- Wrong-person risk is real; treat as an assist, not a gate.
- Compliance: **FCRA** (US, if used as a hiring "consumer report" → disclosure + consent +
  adverse-action), **EEOC/bias** exposure from social-media checks, **GDPR/CCPA** for storing
  enriched PII, and **platform ToS** (use official/enrichment APIs, never scrape LinkedIn).
- Add a candidate-consent note at intake; don't persist third-party PII beyond the session.
