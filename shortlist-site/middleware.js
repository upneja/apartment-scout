// Google OAuth gate. Runs on Vercel's Edge Runtime before any static asset
// is served. Only Gmail accounts in AUTHORIZED_EMAILS env var get through.
// No shared URL keys. No client-side secrets.
//
// Flow:
//   1. User hits any URL → middleware checks session cookie
//   2. Valid + email on allowlist → pass through to static asset
//   3. Otherwise → redirect to Google OAuth consent screen
//   4. Google redirects back to /auth/callback?code=...
//   5. Middleware exchanges code for ID token, verifies email, sets session cookie
//   6. Allowlist hit → redirect to original destination
//   7. Allowlist miss → 403 page ("signed in as X — not on the list")
//
// Required env vars:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET, AUTHORIZED_EMAILS

export const config = {
  matcher: '/((?!robots\\.txt$).*)',
};

const COOKIE_NAME = 'aj_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const CANONICAL_AUTH_ORIGIN = 'https://shortlist.upneja.ai';
const HANDOFF_PARAM = '__aj_auth';
const HANDOFF_MAX_AGE = 60; // seconds
const HOST_ALLOWLISTS = [
  {
    host: 'reels.upneja.ai',
    emails: ['ayushupneja@gmail.com'],
    label: 'Creator Video OS',
    rootRedirect: '/creator-video-os/',
  },
  {
    host: 'studio.upneja.ai',
    emails: ['ayushupneja@gmail.com'],
    label: 'Private Creator Studio',
    rootRedirect: '/creator-studio/',
  },
];
const ROUTE_ALLOWLISTS = [
  {
    prefix: "/creator-studio",
    emails: ["ayushupneja@gmail.com"],
    label: "Private Creator Studio",
  },
  {
    prefix: "/creator-video-os",
    emails: ["ayushupneja@gmail.com"],
    label: "Creator Video OS",
  },
  {
    prefix: "/rounika-internship",
    emails: ["rounikasaxena5@gmail.com", "ayushupneja@gmail.com"],
    label: "Rounika internship plan",
  },
  {
    prefix: '/cartagena',
    emails: ['ayushupneja@gmail.com', 'sl071999@gmail.com', 'rounikasaxena5@gmail.com'],
    label: 'Cartagena trip plan',
  },
];

// ----- Env helpers -----

function getEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function envMissing() {
  return !process.env.GOOGLE_CLIENT_ID
    || !process.env.GOOGLE_CLIENT_SECRET
    || !process.env.SESSION_SECRET
    || !process.env.AUTHORIZED_EMAILS;
}

function getAllowedEmails() {
  return getEnv('AUTHORIZED_EMAILS')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}

function getAccessRule(urlOrPathname) {
  const url = typeof urlOrPathname === 'string' ? null : urlOrPathname;
  const pathname = url ? url.pathname : urlOrPathname;
  const host = url ? url.hostname.toLowerCase() : '';
  const hostRule = HOST_ALLOWLISTS.find(rule => rule.host === host);
  if (hostRule) {
    return {
      emails: hostRule.emails.map(e => e.toLowerCase()),
      label: hostRule.label,
      rootRedirect: hostRule.rootRedirect,
    };
  }

  const routeRule = ROUTE_ALLOWLISTS.find(rule =>
    pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`)
  );
  if (routeRule) {
    return {
      emails: routeRule.emails.map(e => e.toLowerCase()),
      label: routeRule.label,
      rootRedirect: null,
    };
  }
  return {
    emails: getAllowedEmails(),
    label: 'this private site',
    rootRedirect: null,
  };
}

// ----- HMAC session signing (Web Crypto, edge-compatible) -----

async function hmacSign(data, secretStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(email) {
  const expires = Date.now() + COOKIE_MAX_AGE * 1000;
  const payload = `${email}|${expires}`;
  const sig = await hmacSign(payload, getEnv('SESSION_SECRET'));
  return `${b64url(payload)}.${sig}`;
}

async function createAuthHandoff(email, origin) {
  const expires = Date.now() + HANDOFF_MAX_AGE * 1000;
  const payload = `${email}|${origin}|${expires}`;
  const sig = await hmacSign(payload, getEnv('SESSION_SECRET'));
  return `${b64url(payload)}.${sig}`;
}

async function verifySession(cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;
  let payload;
  try {
    payload = b64urlDecode(cookieValue.slice(0, dot));
  } catch {
    return null;
  }
  const sig = cookieValue.slice(dot + 1);
  const expected = await hmacSign(payload, getEnv('SESSION_SECRET'));
  if (sig !== expected) return null;
  const [email, expiresStr] = payload.split('|');
  if (!email || !expiresStr) return null;
  if (Number(expiresStr) < Date.now()) return null;
  return email;
}

async function verifyAuthHandoff(token, expectedOrigin) {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  let payload;
  try {
    payload = b64urlDecode(token.slice(0, dot));
  } catch {
    return null;
  }
  const sig = token.slice(dot + 1);
  const expected = await hmacSign(payload, getEnv('SESSION_SECRET'));
  if (sig !== expected) return null;
  const [email, origin, expiresStr] = payload.split('|');
  if (!email || !origin || !expiresStr) return null;
  if (origin !== expectedOrigin) return null;
  if (Number(expiresStr) < Date.now()) return null;
  return email;
}

function b64url(s) {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return atob(padded);
}

// ----- Cookie parsing -----

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// ----- HTML escape -----

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ----- Main handler -----

export default async function middleware(request) {
  const url = new URL(request.url);

  // Setup-required page if env vars not set (deploy hasn't been finished yet)
  if (envMissing()) {
    return new Response(getSetupHtml(), {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  const accessRule = getAccessRule(url);

  // Logout
  if (url.pathname === '/auth/logout' || url.searchParams.get('logout') === '1') {
    return new Response(getLogoutHtml(), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  // OAuth callback
  if (url.pathname === '/auth/callback') {
    return await handleCallback(url);
  }

  const handoff = url.searchParams.get(HANDOFF_PARAM);
  if (handoff) {
    return await handleAuthHandoff(url, handoff, accessRule);
  }

  // Session check
  const cookies = parseCookies(request.headers.get('cookie'));
  let email = null;
  try {
    email = await verifySession(cookies[COOKIE_NAME]);
  } catch {
    email = null;
  }

  if (email && accessRule.emails.includes(email.toLowerCase())) {
    if (accessRule.rootRedirect && url.pathname === '/') {
      return new Response(null, {
        status: 302,
        headers: {
          location: accessRule.rootRedirect,
          'cache-control': 'no-store',
        },
      });
    }

    return; // pass through to static asset
  }

  // Not authed → redirect to Google
  return redirectToGoogle(url);
}

function redirectToGoogle(currentUrl) {
  const callbackOrigin = getOAuthCallbackOrigin(currentUrl);
  const sameOriginCallback = currentUrl.origin === callbackOrigin;
  const state = sameOriginCallback
    ? currentUrl.pathname + (currentUrl.search || '') + (currentUrl.hash || '')
    : currentUrl.toString();
  const params = new URLSearchParams({
    client_id: getEnv('GOOGLE_CLIENT_ID'),
    redirect_uri: `${callbackOrigin}/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state: b64url(state || '/'),
    access_type: 'online',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'cache-control': 'no-store',
    },
  });
}

function getOAuthCallbackOrigin(currentUrl) {
  if (currentUrl.origin === CANONICAL_AUTH_ORIGIN) return currentUrl.origin;
  if (isAllowedDestinationHost(currentUrl.hostname)) return CANONICAL_AUTH_ORIGIN;
  return currentUrl.origin;
}

function isAllowedDestinationHost(hostname) {
  const host = hostname.toLowerCase();
  const canonicalHost = new URL(CANONICAL_AUTH_ORIGIN).hostname;
  return host === canonicalHost || HOST_ALLOWLISTS.some(rule => rule.host === host);
}

function getCleanRedirectPath(url) {
  const clean = new URL(url);
  clean.searchParams.delete(HANDOFF_PARAM);
  return clean.pathname + (clean.search || '') + (clean.hash || '');
}

function getStateDestination(stateRaw, fallbackOrigin) {
  let decoded = '/';
  try {
    decoded = b64urlDecode(stateRaw);
  } catch {
    return new URL('/', fallbackOrigin);
  }

  if (decoded.startsWith('/')) {
    return new URL(decoded, fallbackOrigin);
  }

  try {
    const destination = new URL(decoded);
    if (isAllowedDestinationHost(destination.hostname)) return destination;
  } catch {
    // Fall through to root on malformed state.
  }

  return new URL('/', fallbackOrigin);
}

async function handleAuthHandoff(url, token, accessRule) {
  let email = null;
  try {
    email = await verifyAuthHandoff(token, url.origin);
  } catch {
    email = null;
  }

  let location = getCleanRedirectPath(url);
  if (accessRule.rootRedirect && url.pathname === '/') {
    location = accessRule.rootRedirect;
  }

  if (!email) {
    return new Response(null, {
      status: 302,
      headers: {
        location,
        'cache-control': 'no-store',
      },
    });
  }

  if (!accessRule.emails.includes(email.toLowerCase())) {
    return new Response(getNotAuthorizedHtml(email, accessRule.label), {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  const session = await createSession(email);
  return new Response(null, {
    status: 302,
    headers: {
      location,
      'set-cookie': `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
      'cache-control': 'no-store',
    },
  });
}

async function handleCallback(url) {
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state') || '';
  if (!code) {
    return new Response('Missing authorization code', { status: 400 });
  }

  const destinationUrl = getStateDestination(stateRaw, url.origin);

  // Exchange code for tokens
  let tokens;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: getEnv('GOOGLE_CLIENT_ID'),
        client_secret: getEnv('GOOGLE_CLIENT_SECRET'),
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(`Token exchange failed: ${escapeHtml(errText.slice(0, 200))}`, { status: 500 });
    }
    tokens = await tokenRes.json();
  } catch (e) {
    return new Response('Token exchange error', { status: 500 });
  }

  if (!tokens.id_token) {
    return new Response('No id_token in response', { status: 500 });
  }

  // Parse ID token (signature verification skipped — token came directly from
  // Google's token endpoint over HTTPS in this same request, so trust is
  // established. For higher-stakes apps, verify against Google's JWKS.)
  let payload;
  try {
    const parts = tokens.id_token.split('.');
    payload = JSON.parse(b64urlDecode(parts[1]));
  } catch {
    return new Response('Invalid id_token', { status: 500 });
  }

  const email = payload.email?.toLowerCase();
  const emailVerified = payload.email_verified;

  if (!email || !emailVerified) {
    return new Response('Email not verified by Google', { status: 403 });
  }

  const destinationRule = getAccessRule(destinationUrl);
  const allowed = destinationRule.emails;
  if (!allowed.includes(email)) {
    return new Response(getNotAuthorizedHtml(email, destinationRule.label), {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  }

  if (destinationUrl.origin !== url.origin) {
    const handoff = await createAuthHandoff(email, destinationUrl.origin);
    destinationUrl.searchParams.set(HANDOFF_PARAM, handoff);
    return new Response(null, {
      status: 302,
      headers: {
        location: destinationUrl.toString(),
        'cache-control': 'no-store',
      },
    });
  }

  const dest = destinationUrl.pathname + (destinationUrl.search || '') + (destinationUrl.hash || '');

  // Allowed — create session, redirect
  const session = await createSession(email);
  return new Response(null, {
    status: 302,
    headers: {
      location: dest,
      'set-cookie': `${COOKIE_NAME}=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
      'cache-control': 'no-store',
    },
  });
}

// ----- HTML responses -----

function pageShell(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="#0e0d0c">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,500;1,9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root{--paper:#f7f4ef;--ink:#1b1b1b;--ink-soft:#4f4a42;--ink-faint:#8c867a;--rule:#cfc6b4;--surface:#ffffff;--go:#b8553f;}
    @media (prefers-color-scheme:dark){:root{--paper:#0e0d0c;--ink:#eae5dc;--ink-soft:#b8b3a9;--ink-faint:#6f6a60;--rule:#3f3a32;--surface:#1a1815;--go:#d26e55;}}
    *{box-sizing:border-box;}
    html{-webkit-text-size-adjust:100%;}
    body{font-family:"IBM Plex Sans",-apple-system,system-ui,sans-serif;background:var(--paper);color:var(--ink);margin:0;padding:32px;display:flex;align-items:center;justify-content:center;min-height:100vh;-webkit-font-smoothing:antialiased;line-height:1.5;}
    .wrap{max-width:420px;width:100%;text-align:center;}
    .mark{display:inline-block;width:72px;height:72px;border-radius:18px;background:var(--ink);color:var(--paper);font-family:"Fraunces",serif;font-style:italic;font-weight:500;font-size:36px;line-height:72px;margin-bottom:28px;}
    h1{font-family:"Fraunces",serif;font-weight:600;font-size:32px;line-height:1.15;letter-spacing:-0.02em;margin:0 0 12px;}
    h1 em{font-style:italic;color:var(--go);font-weight:500;}
    p{color:var(--ink-soft);margin:0 0 24px;}
    .btn{display:inline-flex;align-items:center;gap:10px;background:var(--ink);color:var(--paper);padding:14px 22px;border-radius:10px;font-size:16px;font-weight:600;text-decoration:none;font-family:inherit;border:none;cursor:pointer;min-height:48px;}
    .btn svg{width:18px;height:18px;}
    .btn:active{transform:scale(0.98);}
    .foot{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--ink-faint);margin:28px 0 0;letter-spacing:0.04em;line-height:1.55;}
    .err-email{font-family:"IBM Plex Mono",monospace;color:var(--go);font-weight:500;}
  </style>
</head>
<body>
  <div class="wrap">${bodyHtml}</div>
</body>
</html>`;
}

function getNotAuthorizedHtml(email, label = 'this private site') {
  return pageShell('Not authorized', `
    <div class="mark">aj</div>
    <h1>Almost — <em>but not quite</em></h1>
    <p>You signed in as <span class="err-email">${escapeHtml(email)}</span>, but ${escapeHtml(label)} is private to a specific Google account allowlist. If you should have access, ask Ayush to add you.</p>
    <a class="btn" href="/auth/logout">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      Try a different account
    </a>
    <p class="foot">Authentication via Google. No content is served until your email is verified against the allowlist.</p>
  `);
}

function getLogoutHtml() {
  return pageShell('Signed out', `
    <div class="mark">aj</div>
    <h1>Signed <em>out</em></h1>
    <p>Your access on this device has been cleared. The next time you visit, you'll go through Google sign-in again.</p>
    <a class="btn" href="/">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
      Sign back in
    </a>
    <p class="foot">Boston shortlist — for Akhil &amp; Jayshree.</p>
  `);
}

function getSetupHtml() {
  return pageShell('Setup required', `
    <div class="mark">aj</div>
    <h1>Setup <em>incomplete</em></h1>
    <p>This site is being switched to Google OAuth. The required environment variables aren't all set yet. Ayush — finish the Google Cloud Console steps and set <code style="font-family:'IBM Plex Mono',monospace;font-size:13px;background:var(--surface);padding:2px 6px;border-radius:4px;">GOOGLE_CLIENT_ID</code>, <code style="font-family:'IBM Plex Mono',monospace;font-size:13px;background:var(--surface);padding:2px 6px;border-radius:4px;">GOOGLE_CLIENT_SECRET</code>, <code style="font-family:'IBM Plex Mono',monospace;font-size:13px;background:var(--surface);padding:2px 6px;border-radius:4px;">SESSION_SECRET</code>, and <code style="font-family:'IBM Plex Mono',monospace;font-size:13px;background:var(--surface);padding:2px 6px;border-radius:4px;">AUTHORIZED_EMAILS</code> on Vercel, then redeploy.</p>
    <p class="foot">If you're not Ayush, please come back in a few minutes.</p>
  `);
}
