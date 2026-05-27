# Share Package — Akhil & Jayshree Apartment Shortlist Site

Site is live at:
**https://shortlist-site-two.vercel.app**

Now gated by **Google OAuth**. Only these 7 Gmail accounts can sign in:
- `akhil.upneja@gmail.com` — Akhil
- `jksarathy@gmail.com` — Jayshree
- `ayushupneja@gmail.com` — Ayush
- `sl071999@gmail.com` — Sofia
- `anupneja@gmail.com` — Anu (mom)
- `aupneja@gmail.com` — Arun (dad)
- `rounikasaxena5@gmail.com` — Rounika

## The URL

```
https://shortlist-site-two.vercel.app
```

That's it. No key in the URL anymore. Tapping the link redirects to Google sign-in. Whichever Gmail they pick → if it's on the allowlist, they're in.

## Suggested iMessage to Akhil

> finished the apartment dashboard — built mobile-first
>
> https://shortlist-site-two.vercel.app
>
> tap, sign in with your gmail (akhil.upneja@gmail.com), done. forward to jayshree, same link works for her gmail. site stays signed in for 30 days per device.
>
> since you guys can't fly out, i'm doing the tours sat may 23 (longwood apts on friday since they're closed sat). 5 things to align on in the "decide" tab when you get a chance.

## How the auth works (for your knowledge)

- Hits the bare URL → server (Vercel Edge Middleware) checks for a session cookie
- No cookie → 302 redirect to Google OAuth (Google account chooser)
- User picks an allowed Gmail → Google sends an auth code back to `/auth/callback`
- Server exchanges code for ID token, verifies the email is on the allowlist (env var `AUTHORIZED_EMAILS`)
- Match → server sets an HMAC-signed HttpOnly session cookie containing the email + expiry, redirects to the site
- Mismatch → 403 page ("signed in as X — not on the list") with a "Try a different account" button

Cookie lasts 30 days. JavaScript can't read it. No client-side secrets anywhere in the served HTML/CSS/JS — verified via `curl /` and `curl /app.js`. Forward the link to anyone — they still need to be signed in as one of the 3 allowed Gmails.

## To rotate the allowlist (add/remove someone)

```bash
cd ~/Projects/jp/shortlist-site
vercel env rm AUTHORIZED_EMAILS production -y
printf "email1@gmail.com,email2@gmail.com,..." | vercel env add AUTHORIZED_EMAILS production
vercel deploy --prod --yes
```

Effect is immediate after redeploy. Existing valid sessions stay valid until cookie expiry (so a removed account keeps access for up to 30 days unless they hit `/auth/logout`).

## To rotate the session secret (force everyone to re-auth)

```bash
vercel env rm SESSION_SECRET production -y
printf "$(openssl rand -hex 32)" | vercel env add SESSION_SECRET production
vercel deploy --prod --yes
```

Existing cookies become invalid immediately on redeploy. Everyone signs in again.

## To "sign out" from a device

Tap "Forget me on this device" on the `/#/about` tab → calls `/auth/logout` → server clears the cookie. Next visit forces a fresh Google sign-in.

## What I still need from Akhil/Jayshree (Decide tab pre-fills these)

1. **Budget cap for 95 Saint if it's amazing** — actual ceiling for 2BR (currently ~$1,000/mo over starting range)
2. **In-unit W/D — truly required or flexible?** — affects Atrio + Longwood framing
3. **Anything specific to test or photograph** — beyond default (sound, kitchen, bedrooms, common spaces, transit)
4. **FaceTime during tours** — yes/no, and confirm Sat May 23 10am–4pm ET availability
5. **Anything else** — neighborhoods to scout, Newton parents drop-in, anything specific to look for

"Text Ayush your answers" button on the Decide tab pre-fills this as an SMS to (814) 574-5900.

## What's on each tab

- **Verdict** (home) — 5 buildings ranked, color-coded. Top 2 are "Strong match," 95 Saint is "Stretch," Atrio + Longwood are "Wildcard."
- **Tour** — Sat May 23 itinerary (Bell Olmsted 10am, Brynx 11:30am, 95 Saint 1:30pm, Atrio 3pm). Longwood Apts is on Friday May 22 (their office is closed Saturdays). "Add to calendar" downloads an `.ics`.
- **Buildings** — Per-building details: pricing, amenities, reviews, what I'll watch for on each tour. Plus side-by-side decision matrix.
- **Emails** — 5 ready-to-send tour requests. All framed "I'm touring on behalf of my brother and sister-in-law." Copy-to-clipboard buttons.
- **Decide** — 5 things Ayush needs from Akhil/Jayshree.
- **About** (footer link) — Security/privacy notes.

## Technical state

```
~/Projects/jp/shortlist-site/
├── index.html
├── styles.css
├── app.js                    (client-side: routing, copy, .ics, countdown — no auth)
├── middleware.js             (Vercel Edge: Google OAuth flow)
├── vercel.json
├── robots.txt
└── SHARE.md                  (this doc)
```

Vercel env vars set (Production):
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SESSION_SECRET`
- `AUTHORIZED_EMAILS`

Google Cloud project: `aj-apartment-shortlist` under `ayushupneja@gmail.com`. OAuth consent screen in **Testing** mode (no need to publish — only test users can sign in, which is exactly what we want).
