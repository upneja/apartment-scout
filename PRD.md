# PRD: ApartmentScout — AI-Powered Boston Apartment Finder

## Overview

A personal web dashboard that automatically discovers, evaluates, and ranks Boston-area rental listings daily against Akhil & Jayshree's specific requirements. The system fetches new listings, runs AI vision analysis on photos, calculates commute times and walkability scores, and surfaces only the apartments worth looking at — ranked by fit.

**Users:** Akhil, Jayshree, and family helping with the search
**Timeline:** Build in ~1 week, run April–July 2026
**Budget:** <$10/month operational cost

---

## The Problem

Apartment hunting in Boston is brutal. Listings are scattered across 6+ platforms, good units go within hours, and there's no way to systematically evaluate whether a listing meets a specific set of requirements without clicking through dozens of photos and cross-referencing transit maps manually. Akhil and Jayshree are doing this from San Francisco, making it worse.

## The Solution

A daily-updating dashboard at a URL they can check every morning over coffee. Every listing is pre-scored against their exact criteria. No noise — only apartments that could actually work.

---

## Requirements Profile (Hardcoded for v1)

### Hard Requirements (listing fails if any are not met)
| Requirement | Validation Method |
|---|---|
| 2 bedrooms | Listing metadata |
| ≥1.5 bathrooms | Listing metadata |
| ≤$4,500/month | Listing metadata |
| Off-street parking (1 space, independent access) | Listing text + AI analysis |
| In-unit washer & dryer (separate, full-size preferred) | Listing text + AI photo analysis |
| Pet-friendly (cats) | Listing text |
| Not ground floor | Listing text + AI analysis |
| Within target neighborhoods | Geocoding + geofence |
| Jayshree commute ≤40 min, ≤15 min walking, no transfers | Transit API calculation |
| Akhil drive to Longwood ≤30 min | Driving API calculation |
| Drive to 80 Nardell Rd, Newton ≤30 min | Driving API calculation |

### Scored Requirements (contribute to ranking)
| Requirement | Weight | Scoring Method |
|---|---|---|
| Kitchen modernity (no isolated stove, counters, dishwasher) | 15% | AI photo analysis |
| Natural light | 10% | AI photo analysis |
| Bathroom quality + counter space | 10% | AI photo analysis |
| Modern finishes overall | 10% | AI photo analysis |
| AC type (central/mini-split = 10, wall unit = 5, window = 2) | 5% | Listing text + AI |
| In-building gym | 10% | Listing text |
| Price (lower is better within range) | 15% | Normalized score |
| Walkability: coffee shop <5 min | 3% | Places API |
| Walkability: park <10 min | 3% | Places API |
| Walkability: grocery store <10 min | 5% | Places API |
| Walkability: restaurants <10 min | 3% | Places API |
| Walkability: library <10 min | 1% | Places API |
| Walk time to Route 39 / Green Line stop | 5% | MBTA stops + routing |
| Garage parking (vs. surface lot) | 3% | Listing text + AI |
| Guest-hosting suitability (bedroom sizes) | 2% | AI photo analysis |

### Target Neighborhoods (Geofence)
1. **Jamaica Plain** — Centre St corridor, south of Jackson Square, excluding Mission Hill proper
2. **Brookline** — Washington Square, Coolidge Corner, Brookline Village, south Brookline
3. **South Huntington corridor** — JP/Brookline border along S Huntington Ave
4. **Roslindale** — if close to transit (stretch zone)

### Target Commute Destinations
- **Akhil:** Beth Israel Deaconess Medical Center, Shapiro Center, 330 Brookline Ave, Boston MA 02215 (driving, 8am departure)
- **Jayshree:** 216 Massachusetts Ave, Boston MA 02115 (transit — Route 39 or Green Line E/C/D/B, no transfers, ≤15 min walking total)
- **Parents:** 80 Nardell Road, Newton MA 02461 (driving)

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Actions (Daily Cron)          │
│                   Runs at 7:00 AM ET                 │
│                                                       │
│  1. Fetch listings from sources                       │
│  2. Deduplicate against existing DB                   │
│  3. Hard-filter (price, beds, baths, geo)             │
│  4. For passing listings:                             │
│     a. Geocode address                                │
│     b. Calculate commute times (drive + transit)      │
│     c. Calculate walkability (nearby amenities)       │
│     d. Run AI photo analysis (Claude Haiku)           │
│     e. Run AI text analysis (Claude Haiku)            │
│     f. Compute composite score                        │
│  5. Write results to Turso DB                         │
│  6. Send notification if score ≥ 80/100               │
└──────────────────────┬──────────────────────────────┘
                       │ writes to
                       ▼
              ┌─────────────────┐
              │   Turso (SQLite) │
              │                 │
              │  listings       │
              │  scores         │
              │  photos         │
              │  user_actions   │
              └────────┬────────┘
                       │ reads from
                       ▼
┌─────────────────────────────────────────────────────┐
│              Vercel (Next.js App)                     │
│                                                       │
│  Dashboard:                                           │
│  ├── Feed view (new listings, sorted by score)        │
│  ├── Map view (Leaflet + OSM)                         │
│  ├── Listing detail (photos, scores, commute info)    │
│  ├── Compare view (side-by-side 2-3 listings)         │
│  ├── Saved/favorites list                             │
│  └── Filters (neighborhood, price, score threshold)   │
│                                                       │
│  API Routes:                                          │
│  ├── POST /api/favorite                               │
│  ├── POST /api/dismiss                                │
│  ├── POST /api/note                                   │
│  └── POST /api/rescore (manual re-evaluation)         │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Cost |
|---|---|---|
| Frontend + API | Next.js 15 (App Router, Server Components) | $0 |
| Hosting | Vercel (Hobby/Free tier) | $0 |
| Database | Turso (hosted libSQL/SQLite) | $0 |
| Cron / Pipeline | GitHub Actions | $0 |
| AI Analysis | Claude API (Haiku 4.5 for photos + text) | ~$2-5/month |
| Maps | Leaflet + OpenStreetMap tiles | $0 |
| Transit Data | MBTA V3 API (free, public) | $0 |
| Geocoding | Google Geocoding API (free tier: 10k/month) | $0 |
| Driving/Transit Times | Google Routes API (free $200/month credit) | $0 |
| Nearby Places | Overpass API (OSM, free) + Google Places (free tier) | $0 |
| Notifications | Email via Resend (free tier: 100/day) or Telegram Bot API | $0 |
| **Total** | | **~$2-5/month** |

---

## Data Sources (Priority Order)

### Primary
1. **Craigslist RSS** — Free, semi-sanctioned. Append `?format=rss` to Boston housing search URL filtered to target neighborhoods. Returns ~25 most recent results per feed. Run multiple feeds (one per neighborhood).
2. **RentCast API** — $89/month for 1,000 calls. Aggregates from Zillow, Apartments.com, Realtor.com. Best structured data. **Evaluate whether the coverage justifies cost vs. free sources.**
3. **Zumper** — Apply for data partnership (free if approved). Strong Boston coverage.

### Secondary
4. **Direct building websites** — Scrape/check specific target buildings (Bell Olmsted Park, The Brookliner, Marion Square, Serenity) for availability. Simple HTTP checks on their availability pages.
5. **Facebook Marketplace** — Manual only (no feasible API/scraping). Add a "manual entry" feature so someone browsing FB can paste a URL and the system evaluates it.

### Not Worth It
- Zillow/Apartments.com direct scraping — aggressive anti-bot, high legal risk
- MLS/IDX — requires broker license
- BostonPads — proprietary, no API

**v1 recommendation:** Start with Craigslist RSS + direct building website checks + manual entry. Add RentCast if coverage is insufficient.

---

## Database Schema

```sql
CREATE TABLE listings (
  id TEXT PRIMARY KEY,               -- hash of source + source_id
  source TEXT NOT NULL,              -- 'craigslist', 'rentcast', 'zumper', 'manual', 'building_site'
  source_url TEXT NOT NULL,
  source_id TEXT,                     -- ID from the source platform
  title TEXT,
  price INTEGER,                     -- monthly rent in dollars
  bedrooms REAL,
  bathrooms REAL,
  sqft INTEGER,
  address TEXT,
  neighborhood TEXT,
  lat REAL,
  lon REAL,
  description TEXT,
  floor INTEGER,                     -- null if unknown
  available_date TEXT,               -- ISO date
  lease_term_months INTEGER,
  broker_fee_months REAL,            -- 0 = no fee, 1 = one month, etc.
  pet_policy TEXT,                   -- 'cats_ok', 'dogs_ok', 'no_pets', 'unknown'
  parking_type TEXT,                 -- 'garage', 'surface', 'street', 'none', 'unknown'
  laundry_type TEXT,                 -- 'in_unit_separate', 'in_unit_combo', 'in_building', 'none', 'unknown'
  ac_type TEXT,                      -- 'central', 'mini_split', 'wall', 'window', 'none', 'unknown'
  has_gym INTEGER DEFAULT 0,         -- boolean
  has_dishwasher INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',         -- 'new', 'evaluated', 'favorited', 'dismissed', 'expired'
  first_seen_at TEXT NOT NULL,       -- ISO timestamp
  last_seen_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  url TEXT NOT NULL,
  ordinal INTEGER,                   -- display order
  ai_room_type TEXT,                 -- 'kitchen', 'bathroom', 'bedroom', 'living', 'exterior', 'other'
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  listing_id TEXT PRIMARY KEY REFERENCES listings(id),
  composite_score REAL,              -- 0-100 overall fit score

  -- Hard pass/fail checks
  passes_hard_filters INTEGER,       -- 0 or 1
  fail_reasons TEXT,                 -- JSON array of failed hard requirements

  -- Commute scores
  akhil_drive_min REAL,              -- minutes, morning rush
  jayshree_transit_min REAL,         -- total door-to-door
  jayshree_walk_min REAL,            -- total walking portion
  jayshree_transfers INTEGER,        -- number of transfers (must be 0)
  jayshree_transit_route TEXT,       -- e.g. 'Route 39' or 'Green Line E'
  newton_drive_min REAL,

  -- AI photo scores (1-10 scale)
  kitchen_modernity REAL,
  natural_light REAL,
  bathroom_quality REAL,
  overall_condition REAL,
  bedroom_size_score REAL,           -- can bedrooms fit queen + nightstands + desk?

  -- Walkability (minutes to nearest)
  walk_coffee REAL,
  walk_park REAL,
  walk_grocery REAL,
  walk_restaurant REAL,
  walk_library REAL,
  walk_transit_stop REAL,            -- nearest qualifying transit stop
  nearest_transit_stop TEXT,         -- stop name
  nearest_transit_route TEXT,        -- route name

  -- AI text extraction
  ai_summary TEXT,                   -- 1-2 sentence AI summary
  ai_notes TEXT,                     -- any red flags or highlights
  ai_confidence REAL,                -- model's confidence in its assessment

  scored_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE user_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  action TEXT NOT NULL,              -- 'favorite', 'dismiss', 'note', 'rescore'
  note TEXT,                         -- user-added note
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_neighborhood ON listings(neighborhood);
CREATE INDEX idx_scores_composite ON scores(composite_score DESC);
CREATE INDEX idx_listings_price ON listings(price);
```

---

## AI Evaluation Pipeline

### Step 1: Text Analysis (Claude Haiku 4.5)

For each new listing, send the description text and extract structured data:

```
System: You are evaluating a Boston apartment rental listing for a specific couple.
Extract the following fields from the listing text. If a field is not mentioned, return "unknown".

Input: {listing description}

Output (JSON):
- parking_type: garage | surface | street | none | unknown
- laundry_type: in_unit_separate | in_unit_combo | in_building | none | unknown
- ac_type: central | mini_split | wall | window | none | unknown
- pet_policy: cats_ok | dogs_ok | no_pets | unknown
- has_gym: true | false | unknown
- has_dishwasher: true | false | unknown
- floor_number: integer | unknown
- broker_fee: 0 | 0.5 | 1 | unknown (in months)
- lease_term_months: integer | unknown
- red_flags: [list of concerns, e.g. "no photos", "basement unit", "near highway"]
- highlights: [list of positives, e.g. "renovated 2024", "walk to Jamaica Pond"]
- summary: 1-2 sentence plain English summary of the unit
```

Cost: ~$0.001/listing

### Step 2: Photo Analysis (Claude Haiku 4.5)

Send all listing photos in a single API call. Score against Akhil & Jayshree's aesthetic preferences:

```
System: You are evaluating apartment photos for a couple who wants a modern, updated unit.
They specifically care about:
- Modern kitchen (no isolated/freestanding stove, good counter space, dishwasher visible)
- Natural light (large windows, bright rooms)
- Modern bathroom (updated vanity, good counter space, clean tile)
- Bedrooms large enough for queen bed + 2 nightstands; one should also fit a desk
- Overall updated/modern finishes (not dated 1970s/80s)
- NOT window AC units

Score each dimension 1-10 where 5 = average Boston rental, 8+ = genuinely impressive.
Be calibrated and critical. Most Boston rentals should score 4-6.

Also identify:
- What room each photo shows
- Any red flags not visible in the listing text
- Whether the photos look professionally taken vs. phone snapshots (indicator of listing quality)

{photos}
```

Cost: ~$0.01-0.02/listing (8 photos)

### Step 3: Composite Scoring

```python
def compute_composite_score(scores: dict) -> float:
    """Weighted composite score, 0-100."""

    # Hard filter check first — if any fail, score = 0
    if not scores['passes_hard_filters']:
        return 0.0

    weighted = {
        'kitchen_modernity':    (scores['kitchen_modernity'] / 10, 0.15),
        'natural_light':        (scores['natural_light'] / 10, 0.10),
        'bathroom_quality':     (scores['bathroom_quality'] / 10, 0.10),
        'overall_condition':    (scores['overall_condition'] / 10, 0.10),
        'ac_score':             (ac_score(scores['ac_type']), 0.05),
        'has_gym':              (1.0 if scores['has_gym'] else 0.0, 0.10),
        'price_score':          (price_score(scores['price']), 0.15),
        'walk_coffee':          (walk_score(scores['walk_coffee'], 5), 0.03),
        'walk_park':            (walk_score(scores['walk_park'], 10), 0.03),
        'walk_grocery':         (walk_score(scores['walk_grocery'], 10), 0.05),
        'walk_restaurant':      (walk_score(scores['walk_restaurant'], 10), 0.03),
        'walk_library':         (walk_score(scores['walk_library'], 10), 0.01),
        'transit_access':       (walk_score(scores['walk_transit_stop'], 8), 0.05),
        'garage_parking':       (1.0 if scores['parking_type'] == 'garage' else 0.5, 0.03),
        'bedroom_size':         (scores['bedroom_size_score'] / 10, 0.02),
    }

    return sum(score * weight for score, weight in weighted.values()) * 100
```

---

## Dashboard Pages

### 1. Feed View (Home — `/`)
The main page. Shows listings as cards, sorted by composite score descending.

Each card shows:
- Hero photo (first listing photo)
- Price / beds / baths / sqft
- Composite score badge (color-coded: green ≥80, yellow 60-79, gray <60)
- Neighborhood tag
- Key scores as small icons (kitchen, transit, gym checkmark)
- "New" badge if first seen today
- Quick actions: favorite (heart), dismiss (X), open detail

Filters sidebar:
- Neighborhood checkboxes
- Price range slider ($3,000–$4,500)
- Minimum score slider
- Toggle: show dismissed
- Sort: score, price, newest

### 2. Map View (`/map`)
Full-screen Leaflet map showing:
- All active listings as colored pins (green/yellow/gray by score)
- Click pin → popup with card summary
- Overlay layers (toggleable):
  - Route 39 bus route line + stops
  - Green Line E/C/D stops
  - Akhil's work (Longwood)
  - Jayshree's work (216 Mass Ave)
  - Parents' house (Newton)
  - Target neighborhood boundaries
- Filter controls same as feed view

### 3. Listing Detail (`/listing/[id]`)
Full evaluation page for one listing:

**Top section:**
- Photo gallery (swipeable carousel)
- Price, address, beds/baths/sqft
- Composite score (large) + breakdown radar chart
- Favorite / dismiss / add note buttons
- Link to original listing

**Commute section:**
- Akhil drive time (with mini embedded map showing route)
- Jayshree transit options (route, total time, walking breakdown)
- Newton drive time

**AI Evaluation section:**
- Kitchen score + AI explanation ("Modern cabinets, quartz counters, stainless appliances. Dishwasher visible. No isolated stove. Good counter space.")
- Bathroom score + AI explanation
- Natural light score + AI explanation
- Overall condition + AI explanation
- Red flags / highlights from AI
- AI confidence indicator

**Walkability section:**
- Mini map with nearby amenities pinned
- Coffee: [name] — X min walk
- Grocery: [name] — X min walk
- Park: [name] — X min walk
- Library: [name] — X min walk
- Nearest transit: [stop name, route] — X min walk

**Listing details section:**
- Full listing description text
- Parking type, laundry type, AC type, pet policy, floor
- Lease term, broker fee, available date
- Source + link to original

### 4. Compare View (`/compare`)
Side-by-side comparison of 2-3 favorited listings.
- Synced photo galleries
- Score comparison table (each dimension as a row)
- Map with all compared listings + commute routes
- Price comparison (including broker fee → net effective monthly)

### 5. Saved / Favorites (`/saved`)
List of favorited listings with user notes. Sorted by date favorited. Shows if listing is still active or expired (detected when it disappears from source).

---

## Notifications

When a new listing scores ≥80/100:
- Send email via Resend (free tier) with:
  - Hero photo
  - Price, address, score
  - Top 3 highlights
  - Link to detail page on dashboard
- Optional: Telegram bot message (free, instant push notification on phone)

When a favorited listing disappears from source feeds:
- Mark as "possibly expired" in dashboard
- Send alert: "Heads up — [listing] may have been taken down"

---

## Pipeline Execution (GitHub Actions)

```yaml
name: Daily Apartment Scan
on:
  schedule:
    - cron: '0 12 * * *'  # 7 AM ET (UTC-5) / 8 AM ET (UTC-4 DST)
  workflow_dispatch: {}     # manual trigger

jobs:
  scan:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: node scripts/pipeline.mjs
        env:
          TURSO_URL: ${{ secrets.TURSO_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GOOGLE_MAPS_API_KEY: ${{ secrets.GOOGLE_MAPS_API_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
```

Pipeline steps in `scripts/pipeline.mjs`:
1. Fetch Craigslist RSS feeds (one per neighborhood)
2. Fetch direct building site availability pages
3. Deduplicate against existing listings in Turso
4. For each new listing:
   - Geocode address → lat/lon
   - Check if within target neighborhood geofences
   - If in-bounds: run hard filter checks
   - If passes hard filters: run full evaluation (AI + commute + walkability)
   - Compute composite score
   - Insert into Turso
5. Check if any previously-seen listings have disappeared → mark expired
6. Send notifications for high-scoring new listings

---

## Manual Entry Flow

For listings found on platforms we can't scrape (Facebook Marketplace, broker emails, word of mouth):

1. User pastes a URL or enters details manually on `/add`
2. If URL provided: attempt to fetch and parse (best effort)
3. User can upload photos directly
4. System runs the same AI + geo evaluation pipeline
5. Listing appears in the feed alongside automated finds

---

## v1 Scope (Ship in ~1 week)

### In scope
- [ ] Craigslist RSS ingestion for JP, Brookline, Roslindale
- [ ] Direct checks on 4 target buildings (Bell Olmsted Park, The Brookliner, Marion Square, Serenity)
- [ ] AI photo + text analysis via Claude Haiku
- [ ] Commute time calculations (drive + transit)
- [ ] Walkability scoring (coffee, grocery, park, transit stop)
- [ ] Composite scoring with weighted formula
- [ ] Feed view with filtering and sorting
- [ ] Map view with listing pins + transit overlay
- [ ] Listing detail page with full evaluation
- [ ] Favorite / dismiss / note actions
- [ ] Email notifications for score ≥80
- [ ] Daily GitHub Actions pipeline
- [ ] Manual listing entry
- [ ] Mobile-responsive (they'll check this on their phones)

### Out of scope for v1
- Compare view (v2)
- RentCast API integration (evaluate after v1 coverage)
- Zumper partnership (apply in parallel, integrate if approved)
- Tour scheduling integration
- Lease document analysis
- Rental application tracking

---

## Success Criteria

1. Every morning, Akhil and Jayshree see 0-5 new listings that actually match their requirements — not 50 irrelevant ones
2. When they open a listing, they can tell within 10 seconds whether it's worth touring — no need to cross-reference transit maps or Google "is this neighborhood safe"
3. When they fly out for a tour weekend, they have a shortlist of 6-10 favorites with all the info they need to schedule tours efficiently
4. They find and sign a lease for an apartment they love before August 1, 2026
