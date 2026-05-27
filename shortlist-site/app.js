/* =========================================================================
   Akhil & Jayshree — Boston Shortlist
   Authentication is server-side (Vercel Edge Middleware). This file just
   handles section routing, copy-to-clipboard, .ics download, and countdown.
   ========================================================================= */

(function () {
  'use strict';

  const TOUR_DATE = new Date('2026-05-30T10:00:00-04:00');

  // ----- Element refs -----
  const headerSub = document.getElementById('header-sub');
  const countdownEl = document.getElementById('countdown');
  const daysUntilEl = document.getElementById('days-until');
  const toast = document.getElementById('toast');

  // ----- Hash routing -----
  // Routes: #/verdict, #/tour, #/buildings, #/buildings/<id>, #/emails,
  // #/emails/<id>, #/decide, #/about. Default: #/verdict.

  const VALID_SECTIONS = new Set([
    'verdict', 'tour', 'buildings', 'emails', 'decide', 'about',
    'buildings/bell-olmsted', 'buildings/the-brynx', 'buildings/95-saint',
    'buildings/atrio', 'buildings/longwood-apts',
    'buildings/serenity', 'buildings/the-brookliner', 'buildings/225-centre',
    'buildings/beacon-park', 'buildings/3200-washington', 'buildings/metromark',
    'buildings/the-calvin', 'buildings/455-harvard', 'buildings/babcock-place',
    'buildings/mosaic', 'buildings/valor', 'buildings/the-tremont', 'buildings/alder',
    'emails/bell-olmsted', 'emails/the-brynx', 'emails/95-saint',
    'emails/atrio', 'emails/longwood-apts', 'emails/market-central',
  ]);

  function parseRoute() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    if (!raw || !VALID_SECTIONS.has(raw)) return 'verdict';
    return raw;
  }

  function setActiveSection(route) {
    document.querySelectorAll('.section').forEach(el => {
      el.classList.remove('is-active');
    });

    const sectionId = 'section-' + route.replace(/\//g, '-');
    const target = document.getElementById(sectionId);
    if (target) {
      target.classList.add('is-active');
    } else {
      document.getElementById('section-verdict')?.classList.add('is-active');
    }

    const topLevel = route.split('/')[0];
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.nav === topLevel);
    });

    if (headerSub) {
      const labels = {
        verdict: 'The verdict',
        tour: 'Round 2 · May 30 / 31 / Jun 3',
        buildings: 'The six buildings',
        emails: 'Inquiry emails',
        decide: 'Decisions for you',
        about: 'How this site works',
      };
      headerSub.textContent = labels[topLevel] || 'For Akhil & Jayshree';
    }

    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  }

  function handleRouteChange() {
    setActiveSection(parseRoute());
  }

  window.addEventListener('hashchange', handleRouteChange);

  // Intercept data-nav clicks for instant tab switching
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-nav]');
    if (link) {
      e.preventDefault();
      const target = link.dataset.nav;
      window.location.hash = '#/' + target;
    }
  });

  // ----- Countdown -----

  function updateCountdown() {
    const now = new Date();
    const diffMs = TOUR_DATE - now;
    const days = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    if (daysUntilEl) daysUntilEl.textContent = days;
    if (countdownEl) {
      if (days <= 0) {
        countdownEl.innerHTML = '<strong>Today</strong>tour day';
      } else if (days === 1) {
        countdownEl.innerHTML = '<strong>1</strong>day to tour';
      } else {
        countdownEl.innerHTML = '<strong>' + days + '</strong>days to tour';
      }
    }
  }

  // ----- Toast -----

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  // ----- Copy to clipboard -----

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy-target]');
    if (!btn) return;
    const targetId = btn.dataset.copyTarget;
    const node = document.getElementById(targetId);
    if (!node) return;

    const text = node.innerText;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Email body copied');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast('Email body copied');
      } catch {
        showToast('Copy failed — long-press to copy manually');
      }
      document.body.removeChild(ta);
    }
  });

  // ----- Calendar download (.ics) -----

  function escapeIcs(s) {
    return String(s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  function makeIcsEvent({ uid, title, location, description, start, end }) {
    const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return [
      'BEGIN:VEVENT',
      'UID:' + uid + '@aj-shortlist',
      'DTSTAMP:' + fmt(new Date()),
      'DTSTART:' + fmt(start),
      'DTEND:' + fmt(end),
      'SUMMARY:' + escapeIcs(title),
      'LOCATION:' + escapeIcs(location),
      'DESCRIPTION:' + escapeIcs(description),
      'END:VEVENT',
    ].join('\r\n');
  }

  function downloadTourIcs() {
    const mkSat = (h, m) =>
      new Date(`2026-05-30T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`);
    const mkWed = (h, m) =>
      new Date(`2026-06-03T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00-04:00`);

    // Round 2 default itinerary — exact slots will shift based on leasing replies.
    // Sat May 30: stack the JP corridor + Fenway. Wed Jun 3: Longwood Apts (office closed weekends).
    const events = [
      {
        uid: 'r2-bell-olmsted',
        title: 'Tour: Bell Olmsted Park (round 2)',
        location: '161 S Huntington Ave, Boston, MA 02130',
        description: 'Priority 1. (833) 882-2279. Confirm fit in person; LMA discount + HVAC responsiveness.',
        start: mkSat(10, 0),
        end: mkSat(11, 15),
      },
      {
        uid: 'r2-the-brynx',
        title: 'Tour: The Brynx (round 2)',
        location: '201 S Huntington Ave, Boston, MA 02130',
        description: 'Priority 2. (833) 608-1358. Lead with 2BR-for-Aug question.',
        start: mkSat(11, 30),
        end: mkSat(12, 45),
      },
      {
        uid: 'r2-95-saint',
        title: 'Tour: 95 Saint (round 2)',
        location: '95 St Alphonsus St, Boston, MA 02120',
        description: 'Stretch — budget candor up front. (781) 349-5070. Match Day special + LMA discount.',
        start: mkSat(13, 30),
        end: mkSat(14, 45),
      },
      {
        uid: 'r2-atrio',
        title: 'Tour: Atrio Boston (round 2)',
        location: '18 Haviland St, Boston, MA 02115',
        description: 'Wildcard. (617) 266-1805. Renovations, parking workarounds, in-unit W/D options.',
        start: mkSat(15, 0),
        end: mkSat(16, 0),
      },
      {
        uid: 'r2-market-central',
        title: 'Tour: Market Central (round 2)',
        location: 'marketcentral.com — address TBD',
        description: 'Round 2 add from Akhil + Jayshree note. Ask address up front; standard question set.',
        start: mkSat(16, 30),
        end: mkSat(17, 15),
      },
      {
        uid: 'r2-longwood-apts',
        title: 'Tour: Longwood Apartments (round 2)',
        location: '1575 Tremont St, Boston, MA 02120',
        description: 'Wednesday only — office closed weekends. (617) 663-0530. Push on Partners / BIDMC discount.',
        start: mkWed(11, 0),
        end: mkWed(12, 15),
      },
    ];

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Akhil Jayshree Shortlist//Round 2//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events.map(makeIcsEvent),
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tour-round2-may30-jun3.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Round 2 itinerary downloaded');
  }

  document.getElementById('cal-download')?.addEventListener('click', downloadTourIcs);

  // ----- Forget me (server-side logout) -----

  document.getElementById('forget-me-btn')?.addEventListener('click', () => {
    if (confirm('Forget your access on this device? You\'ll need the key from Ayush to get back in.')) {
      window.location.href = '/?logout=1';
    }
  });

  // ----- Init -----

  updateCountdown();
  handleRouteChange();
  setInterval(updateCountdown, 60 * 60 * 1000);
})();
