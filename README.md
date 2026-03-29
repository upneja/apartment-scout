# ApartmentScout

An AI-powered Boston apartment finder that auto-scores rental listings daily against a specific set of hard requirements and quality preferences. Built for a real apartment search — no noise, only apartments worth looking at.

## What It Does

Boston apartment hunting is brutal. Listings scatter across six platforms, good units vanish in hours, and doing a real evaluation means manually cross-referencing transit maps, Google Maps commute times, and photo-by-photo walkthroughs. ApartmentScout automates the whole pipeline.

Every morning, a GitHub Actions job fetches new listings from Craigslist RSS and target building websites, runs each one through a multi-stage AI evaluation, computes a composite score, and writes results to a database. A Next.js dashboard surfaces only the listings that pass hard filters — ranked by fit, ready to review over coffee.

**Status:** System design complete (PRD), frontend scaffolded with mock data. Pipeline and live data ingestion in progress.

---

## Scoring Algorithm

Each listing that clears the hard filters gets a 0–100 composite score from a weighted formula:

| Dimension | Weight | Method |
|---|---|---|
| Kitchen modernity | 15% | Claude Haiku vision analysis |
| Price (normalized, lower = better) | 15% | Metadata |
| Natural light | 10% | Claude Haiku vision analysis |
| Bathroom quality | 10% | Claude Haiku vision analysis |
| Modern finishes overall | 10% | Claude Haiku vision analysis |
| In-building gym | 10% | Listing text extraction |
| Walkability: grocery store | 5% | Google Places / Overpass API |
| Transit stop proximity | 5% | MBTA API + routing |
| AC type | 5% | Listing text + AI |
| Walkability: coffee shop | 3% | Places API |
| Walkability: park | 3% | Places API |
| Walkability: restaurants | 3% | Places API |
| Parking type (garage > surface) | 3% | Text + AI |
| Walkability: library | 1% | Places API |
| Bedroom sizing (guest-hosting) | 2% | Claude Haiku vision analysis |

### Hard Filters (automatic disqualification)

A listing fails immediately if any of these are not met:

- 2 bedrooms, ≥1.5 bathrooms
- ≤$4,500/month
- Off-street parking with independent access
- In-unit washer/dryer (separate, full-size preferred)
- Pet-friendly (cats)
- Not ground floor
- Within target neighborhoods (Jamaica Plain, Brookline, South Huntington corridor, Roslindale near transit)
- Jayshree commute: ≤40 min total, ≤15 min walking, zero transfers (Route 39 or Green Line E/C/D/B)
- Akhil drive to Longwood Medical Area: ≤30 min (8am departure)
- Drive to Newton: ≤30 min

Listings that pass get full AI + geo evaluation. Those that don't get logged with fail reasons for transparency.

### AI Evaluation (Claude Haiku 4.5)

**Text pass** extracts structured fields from the listing description — parking type, laundry, AC, pet policy, floor number, broker fee, lease term — and produces a plain-English summary with highlights and red flags.

**Photo pass** scores all listing photos in a single API call. The model is calibrated against Boston rental baselines (5 = typical Boston rental, 8+ = genuinely impressive) and classifies each photo by room type, flagging anything not visible in the text.

Cost: ~$0.01–0.02 per listing evaluated.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Actions (Daily Cron)          │
│                   Runs at 7:00 AM ET                 │
│                                                       │
│  1. Fetch listings from Craigslist RSS + buildings    │
│  2. Deduplicate against existing DB                   │
│  3. Hard-filter (price, beds, baths, geo)             │
│  4. For passing listings:                             │
│     a. Geocode address                                │
│     b. Calculate commute times (drive + transit)      │
│     c. Calculate walkability (nearby amenities)       │
│     d. Run AI photo analysis (Claude Haiku)           │
│     e. Run AI text analysis (Claude Haiku)            │
│     f. Compute composite score                        │
│  5. Write results to Turso (libSQL)                   │
│  6. Send email notification if score ≥ 80/100         │
└──────────────────────┬──────────────────────────────┘
                       │ writes to
                       ▼
              ┌─────────────────┐
              │   Turso (SQLite) │
              │  listings        │
              │  scores          │
              │  photos          │
              │  user_actions    │
              └────────┬────────┘
                       │ reads from
                       ▼
┌─────────────────────────────────────────────────────┐
│              Vercel (Next.js 15 App)                  │
│                                                       │
│  Feed view — new listings sorted by score             │
│  Map view  — Leaflet pins + transit overlays          │
│  Detail    — photos, scores, commute breakdown        │
│  Compare   — side-by-side with score table            │
│  Saved     — favorited listings with notes            │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend + API routes | Next.js 15 (App Router, Server Components) |
| Hosting | Vercel |
| Database | Turso (hosted libSQL / SQLite) |
| Cron pipeline | GitHub Actions |
| AI analysis | Claude API — Haiku 4.5 (vision + text) |
| Maps | Leaflet + OpenStreetMap |
| Transit data | MBTA V3 API |
| Geocoding | Google Geocoding API |
| Routing times | Google Routes API |
| Nearby places | Overpass API (OSM) + Google Places |
| Notifications | Resend (email) |
| Typography | Instrument Serif · DM Sans · JetBrains Mono |

Operational cost: ~$2–5/month (almost entirely AI API calls).

---

## Data Sources

**Automated:**
- Craigslist RSS — one feed per target neighborhood, runs daily
- Direct building sites — Bell Olmsted Park, The Brookliner, Marion Square, Serenity

**Manual entry:**
- `/add` route for listings found on Facebook Marketplace or through brokers
- Upload photos, paste URL, or enter details manually — runs the same full evaluation pipeline

---

## Dashboard

**Feed (`/`)** — Listing cards sorted by composite score. Color-coded score badge (green ≥80, yellow 60–79, gray <60). Filters for neighborhood, price range, score threshold. Quick favorite/dismiss actions.

**Map (`/map`)** — Full-screen Leaflet map with colored pins. Toggleable overlays for Route 39, Green Line stops, commute destinations, and neighborhood boundaries.

**Detail (`/listing/[id]`)** — Full evaluation breakdown: photo carousel, score radar chart, per-dimension AI explanations, commute section with route details, walkability section with nearest amenities, raw listing text.

**Compare (`/compare`)** — Side-by-side comparison for 2–3 favorited listings with synced galleries and score table.

**Saved (`/saved`)** — Favorited listings with user notes; marks listings as "possibly expired" when they disappear from source feeds.

---

## Notifications

High-scoring listings (≥80/100) trigger an email via Resend with the hero photo, address, score, top 3 highlights, and a direct link to the detail page. Favorited listings that go offline trigger an expiry alert.

---

## Database Schema

Four tables: `listings`, `photos`, `scores`, `user_actions`. Full schema in [`PRD.md`](PRD.md).

Key design decisions:
- `listings.id` is a hash of source + source_id — stable, deduplication-safe
- `scores` is a separate table (1:1 with listings) so re-scoring doesn't touch the source record
- `status` enum (`new` → `evaluated` → `favorited`/`dismissed`/`expired`) drives dashboard state
- Indexes on `composite_score DESC`, `price`, `neighborhood`, `status` — the four most common query axes

---

## Project Status

| Component | Status |
|---|---|
| PRD + system design | Complete |
| Database schema | Complete |
| Next.js app scaffold | Complete |
| Feed, map, detail, saved pages | Frontend complete (mock data) |
| Scoring formula | Complete |
| AI evaluation pipeline | In progress |
| Craigslist RSS ingestion | In progress |
| Commute / walkability APIs | In progress |
| Live Turso integration | Pending |
| GitHub Actions cron | Designed, pending pipeline completion |
| Notifications | Pending |
