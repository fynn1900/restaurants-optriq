import { supabaseFetch } from './supabase.js';
import { t, getLang, setLang, LANGUAGES, T } from './i18n.js';
import { loadAvailabilityData, computeSlots, fetchReservations, _util } from './availability.js';

const slug = new URLSearchParams(location.search).get('slug');
if (!slug) location.href = 'index.html';

const DAY_ORDER = [1,2,3,4,5,6,0];
const TODAY_DOW = new Date().getDay();

// ─── UTILS ────────────────────────────────────────────────────────
function stars(rating, size=16) {
  const f=Math.floor(rating), h=rating%1>=0.4, e=5-f-(h?1:0);
  const s=`font-size:${size}px;color:var(--accent)`;
  return `<span style="${s}">${'★'.repeat(f)}${h?'½':''}${'<span style="color:var(--border)">★</span>'.repeat(e)}</span>`;
}
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id='toast'; el.className='toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ─── SEEN TRACKING ────────────────────────────────────────────────
function markSeen(sl) {
  try {
    const seen = JSON.parse(localStorage.getItem('optriq_seen')||'[]');
    if (!seen.includes(sl)) seen.unshift(sl);
    localStorage.setItem('optriq_seen', JSON.stringify(seen.slice(0,10)));
  } catch {}
}

// ─── THEME / LANG ─────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('optriq_theme');
  const pref  = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', saved || pref);
}
function toggleTheme() {
  const cur  = document.documentElement.getAttribute('data-theme');
  const next = cur==='dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('optriq_theme', next);
}
function renderLangDropdown() {
  const btn  = document.getElementById('lang-btn');
  const drop = document.getElementById('lang-dropdown');
  if (!btn||!drop) return;
  const cur = getLang();
  btn.innerHTML = `<span class="lang-flag">${LANGUAGES[cur].flag}</span><span>${LANGUAGES[cur].label}</span>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  drop.innerHTML = Object.values(LANGUAGES).map(l =>
    `<button class="lang-option ${l.code===cur?'active':''}" data-code="${l.code}">
       <span class="lang-flag">${l.flag}</span><span>${l.label}</span>
     </button>`
  ).join('');
}
function applyI18n(r) {
  const tx = T[getLang()]||T.de;
  document.querySelectorAll('[data-i18n="nav_about"]').forEach(el=>el.textContent=tx.nav_about);
  document.querySelectorAll('[data-i18n="nav_contact"]').forEach(el=>el.textContent=tx.nav_contact);
  document.querySelectorAll('[data-i18n="nav_all"]').forEach(el=>el.textContent=tx.nav_all);
  document.querySelectorAll('[data-i18n="topbar_text"]').forEach(el=>el.textContent=tx.topbar);
  document.querySelectorAll('[data-i18n="topbar_cta"]').forEach(el=>el.textContent=tx.topbar_cta);
  document.querySelectorAll('.tab-btn[data-tab="overview"]').forEach(el=>el.textContent=tx.tab_overview);
  document.querySelectorAll('.tab-btn[data-tab="reviews"]').forEach(el=>el.textContent=tx.tab_reviews);
  document.querySelectorAll('.tab-btn[data-tab="menu"]').forEach(el=>el.textContent=tx.tab_menu);
  document.querySelectorAll('.tab-btn[data-tab="gallery"]').forEach(el=>el.textContent=tx.tab_gallery);
  document.querySelectorAll('.tab-btn[data-tab="map"]').forEach(el=>el.textContent=tx.tab_map);
  const bkH = document.querySelector('.sidebar-card-header h3');
  if (bkH) bkH.textContent = tx.booking_title;
  const bkP = document.querySelector('.sidebar-card-header p');
  if (bkP) bkP.textContent = tx.booking_sub;
  if (r) render(r);
}

// ─── LOAD ─────────────────────────────────────────────────────────
async function loadRestaurant() {
  try {
    const [r] = await supabaseFetch(`restaurants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1`);
    if (!r) { location.href='index.html'; return; }
    document.title = `${r.name} – Optriq`;
    markSeen(r.slug);

    const resSlug = r.reservation_slug||r.slug;
    const today   = new Date().toISOString().slice(0,10);
    const [hours, exceptions] = await Promise.all([
      supabaseFetch(`opening_hours_weekly?restaurant_id=eq.${resSlug}&order=day_of_week`),
      supabaseFetch(`opening_hours_exceptions?restaurant_id=eq.${resSlug}&date=gte.${today}&order=date`),
    ]);
    r._hours = hours; r._exceptions = exceptions;

    initStickyBar(r.name);
    applyI18n(r);

    // Load similar in background
    loadSimilar(r);
  } catch { location.href='index.html'; }
}

// ─── RENDER ───────────────────────────────────────────────────────
function render(r) {
  const tx = T[getLang()]||T.de;

  // Breadcrumb
  const bc = document.getElementById('breadcrumb');
  if (bc) bc.innerHTML = `<a href="index.html">${tx.all_restaurants}</a><span class="breadcrumb-sep">›</span><span>${r.name}</span>`;

  // Hero
  const hero = document.getElementById('detail-hero');
  if (r.cover_image_url && !hero.querySelector('img')) {
    const img = document.createElement('img');
    img.src = r.cover_image_url; img.alt = r.name;
    hero.insertBefore(img, hero.firstChild);
  }
  document.getElementById('detail-cuisine').textContent = [r.cuisine_type, r.price_range].filter(Boolean).join(' · ');
  document.getElementById('detail-name').textContent = r.name;

  const meta = document.getElementById('detail-meta');
  meta.innerHTML = '';
  const rv = r.google_rating||r.tripadvisor_rating;
  const rn = r.google_review_count||r.tripadvisor_review_count;
  if (rv) meta.innerHTML += `<div class="detail-meta-item rating">${stars(rv,15)} <span>${rv.toFixed(1)}</span><span style="opacity:.7;font-weight:400">(${rn||''})</span></div>`;
  if (r.city) meta.innerHTML += `<div class="detail-meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${r.city}</div>`;
  if (r.tripadvisor_ranking) meta.innerHTML += `<div class="detail-meta-item">${r.tripadvisor_ranking}</div>`;

  renderOverview(r, tx);
  renderHours(r, tx);
  renderReviews(r, tx); // async, translates after initial render
  renderMap(r, tx);
  renderMenu(r, tx);
  renderGallery(r, tx);
  renderBooking(r, tx);
  renderSlotPicker(r);

  if (!(r.gallery_urls?.length>0)) document.getElementById('tab-btn-gallery').style.display='none';

  // OG tags
  if (r.cover_image_url) {
    let og = document.querySelector('meta[property="og:image"]');
    if (!og) { og=document.createElement('meta'); og.setAttribute('property','og:image'); document.head.appendChild(og); }
    og.setAttribute('content', r.cover_image_url);
    let ogt = document.querySelector('meta[property="og:title"]');
    if (!ogt) { ogt=document.createElement('meta'); ogt.setAttribute('property','og:title'); document.head.appendChild(ogt); }
    ogt.setAttribute('content', `${r.name} – Optriq`);
  }
}

// ─── OVERVIEW ─────────────────────────────────────────────────────
function renderOverview(r, tx) {
  let html = '';

  // Quick facts
  const facts = [r.cuisine_type, r.price_range && `${r.price_range} ${tx.price_class}`, r.city, (r.google_rating||r.tripadvisor_rating)&&`${(r.google_rating||r.tripadvisor_rating).toFixed(1)} / 5 ${tx.stars}`].filter(Boolean);
  if (facts.length) html += `<div class="quick-facts">${facts.map(f=>`<span class="quick-fact">${f}</span>`).join('')}</div>`;

  if (r.description) html += `<p class="detail-description">${r.description}</p>`;

  // Highlights
  if (r.highlights?.length) {
    html += `<div class="highlights-section"><span class="tag-group-label">${tx.highlights}</span><div class="highlights-grid">
      ${r.highlights.map(h=>`<div class="highlight-card">
        <div class="highlight-icon">${h.icon}</div>
        <div class="highlight-body">
          <div class="highlight-title">${h.title}</div>
          <div class="highlight-subtitle">${h.subtitle}</div>
          <p class="highlight-text">${h.text}</p>
          ${h.url?`<a href="${h.url}" target="_blank" rel="noopener" class="highlight-link">${h.link_label} →</a>`:''}
        </div>
      </div>`).join('')}
    </div></div>`;
  }

  // Ambiance
  if (r.ambiance_tags?.length) html += `<div class="tag-group"><span class="tag-group-label">${tx.ambiance}</span><div class="tag-list">${r.ambiance_tags.map(t=>`<span class="detail-tag">${t}</span>`).join('')}</div></div>`;

  // Features
  if (r.features?.length) html += `<div class="tag-group"><span class="tag-group-label">${tx.features}</span><div class="tag-list">${r.features.map(f=>`<span class="detail-tag">${f}</span>`).join('')}</div></div>`;

  // Hours
  if (r._hours?.length) {
    const todayStr = new Date().toISOString().slice(0,10);
    const todayEx  = r._exceptions?.find(e=>e.date===todayStr);
    const todayWk  = r._hours.find(h=>h.day_of_week===TODAY_DOW);
    const eff      = todayEx ?? todayWk;
    const open     = eff && !eff.is_closed;
    let label = open ? `${tx.today_open} · ${eff.open_time.slice(0,5)}–${eff.close_time.slice(0,5)}` : tx.today_closed;
    if (todayEx?.label) label += ` · ${todayEx.label}`;
    const upcoming = (r._exceptions||[]).filter(e=>e.date!==todayStr);

    html += `<div class="hours-block">
      <div class="hours-header"><span class="tag-group-label">${tx.hours}</span><span class="hours-today ${open?'open':'closed'}">${label}</span></div>
      <div class="hours-grid">
        ${DAY_ORDER.map(dow => {
          const row  = r._hours.find(h=>h.day_of_week===dow);
          const ts   = (row&&!row.is_closed) ? `${row.open_time.slice(0,5)}–${row.close_time.slice(0,5)}` : null;
          return `<div class="hours-row ${dow===TODAY_DOW?'today':''} ${!ts?'closed':''}"><span>${tx.days[dow]}</span><span>${ts||tx.closed_day}</span></div>`;
        }).join('')}
      </div>
      ${upcoming.length?`<div class="exceptions-list"><span class="tag-group-label" style="margin-top:16px;display:block">${tx.special_hours}</span>
        ${upcoming.map(e=>{
          const d=new Date(e.date+'T00:00:00');
          const ds=d.toLocaleDateString(getLang()==='da'?'da-DK':getLang()==='en'?'en-GB':'de-DE',{weekday:'long',day:'numeric',month:'long'});
          const ts=!e.is_closed?`${e.open_time.slice(0,5)}–${e.close_time.slice(0,5)}`:tx.closed_day;
          return `<div class="hours-row ${e.is_closed?'closed':''}"><span>${ds}${e.label?` <em style="color:var(--text-muted);font-style:normal">(${e.label})</em>`:''}</span><span>${ts}</span></div>`;
        }).join('')}</div>`:''}
    </div>`;
  }

  // Map mini
  if (r.lat && r.lng) {
    const bbox=`${r.lng-0.008},${r.lat-0.005},${r.lng+0.008},${r.lat+0.005}`;
    html += `<div class="map-mini"><iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${r.lat},${r.lng}" loading="lazy" title="Karte"></iframe></div>`;
  }

  // Info list
  const items = [
    r.address && {icon:'map-pin', label:tx.lbl_address, value:r.address, extra:`<button class="copy-addr-btn" onclick="copyAddr('${r.address.replace(/'/g,"\\'")}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> ${tx.copy_addr}</button>`},
    r.phone  && {icon:'phone',   label:tx.lbl_phone,   value:`<a href="tel:${r.phone}">${r.phone}</a>`},
    r.email  && {icon:'mail',    label:tx.lbl_email,   value:`<a href="mailto:${r.email}">${r.email}</a>`},
    r.website_url && {icon:'globe', label:tx.lbl_website, value:`<a href="${r.website_url}" target="_blank" rel="noopener">${new URL(r.website_url).hostname}</a>`},
    r.instagram_url && {icon:'instagram', label:tx.lbl_instagram, value:`<a href="${r.instagram_url}" target="_blank" rel="noopener">@${r.instagram_url.split('/').filter(Boolean).pop()}</a>`},
  ].filter(Boolean);

  if (items.length) html += `<div class="info-list">${items.map(i=>`<div class="info-row"><span class="info-row-icon">${iconSvg(i.icon)}</span><div><div class="info-row-label">${i.label}</div><div class="info-row-value">${i.value}</div>${i.extra||''}</div></div>`).join('')}</div>`;

  document.getElementById('tab-overview').innerHTML = html;
}

window.copyAddr = function(addr) {
  navigator.clipboard?.writeText(addr).then(() => toast(t('addr_copied')));
};

// ─── HOURS TAB ────────────────────────────────────────────────────
function renderHours(r, tx) {
  const el = document.getElementById('tab-hours');
  if (!el) return;
  if (!r._hours?.length) { el.innerHTML = `<div class="empty-tab">Keine Öffnungszeiten hinterlegt.</div>`; return; }

  const DAY_ORDER = [1,2,3,4,5,6,0];
  const todayStr  = new Date().toISOString().slice(0,10);
  const todayEx   = r._exceptions?.find(e => e.date === todayStr);
  const todayWk   = r._hours.find(h => h.day_of_week === TODAY_DOW);
  const eff       = todayEx ?? todayWk;
  const open      = eff && !eff.is_closed;
  let statusLabel = open
    ? `Heute geöffnet · ${eff.open_time.slice(0,5)}–${eff.close_time.slice(0,5)} Uhr`
    : 'Heute geschlossen';

  // Closing countdown
  if (open) {
    const closeH = +eff.close_time.slice(0,2), closeM = +eff.close_time.slice(3,5);
    const closeMins = closeH*60+closeM;
    const now = new Date().getHours()*60+new Date().getMinutes();
    const diff = closeMins - now;
    if (diff > 0 && diff <= 90) statusLabel += ` · Schließt in ${diff} Min`;
  }

  // Visual week grid
  const visualGrid = DAY_ORDER.map(dow => {
    const row  = r._hours.find(h => h.day_of_week === dow);
    const ts   = (row && !row.is_closed) ? `${row.open_time.slice(0,5)}–${row.close_time.slice(0,5)}` : null;
    const isToday = dow === TODAY_DOW;
    return `<div class="hours-visual-row ${isToday?'today':''} ${!ts?'closed':''}">
      <span class="hvr-day">${tx.days[dow]}</span>
      <div class="hvr-bar-wrap">
        ${ts ? `<div class="hvr-bar"><span class="hvr-time">${ts}</span></div>` : `<span class="hvr-closed">—</span>`}
      </div>
    </div>`;
  }).join('');

  // Upcoming exceptions
  const upcoming = (r._exceptions||[]).filter(e => e.date !== todayStr).slice(0,5);

  // QR code
  const qrUrl = encodeURIComponent(location.href);
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${qrUrl}&color=1a1612&bgcolor=f7f6f3`;

  el.innerHTML = `
    <div class="hours-status-hero ${open?'open':'closed'}">
      <div class="hs-dot"></div>
      <div>
        <div class="hs-label">${statusLabel}</div>
        ${!open && todayWk && !todayWk.is_closed ? `<div class="hs-sub">Öffnet heute noch um ${todayWk.open_time.slice(0,5)} Uhr</div>` : ''}
      </div>
    </div>

    <div class="hours-visual-grid">${visualGrid}</div>

    ${upcoming.length ? `<div class="hours-exceptions-block">
      <h3 class="hours-exc-title">Besondere Öffnungszeiten</h3>
      ${upcoming.map(e => {
        const d = new Date(e.date+'T00:00:00');
        const ds = d.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'});
        const ts = !e.is_closed ? `${e.open_time.slice(0,5)}–${e.close_time.slice(0,5)} Uhr` : 'Geschlossen';
        return `<div class="hours-exc-row ${e.is_closed?'closed':''}">
          <span>${ds}${e.label?` <em>(${e.label})</em>`:''}</span><strong>${ts}</strong>
        </div>`;
      }).join('')}
    </div>` : ''}

    <div class="hours-qr-block">
      <div>
        <h3 class="hours-qr-title">QR-Code teilen</h3>
        <p class="hours-qr-sub">Direkt zu dieser Seite – für Tischkarte, Flyer oder Weiterleitung</p>
        <button class="menu-download" style="margin-top:10px" onclick="navigator.clipboard?.writeText(location.href).then(()=>alert('Link kopiert!'))">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Link kopieren
        </button>
      </div>
      <img src="${qr}" alt="QR Code" class="qr-img" loading="lazy">
    </div>`;
}

// ─── REVIEWS (Google-style, original language, star filter) ───────
let _reviewFilter = 0; // 0 = all, else star value

function renderReviews(r, tx) {
  const reviews = r.reviews;
  const rv = r.google_rating||r.tripadvisor_rating;
  if (!reviews?.length) { document.getElementById('tab-reviews').innerHTML=`<div class="empty-tab">${tx.reviews} werden bald ergänzt.</div>`; return; }

  const total  = reviews.length;
  const counts = [5,4,3,2,1].map(s=>({s, n:reviews.filter(x=>x.rating===s).length}));

  let html = `<div class="reviews-header">`;
  if (rv) {
    const rn = r.google_review_count||r.tripadvisor_review_count;
    html += `<div class="review-score">
      <div class="review-score-number">${rv.toFixed(1)}</div>
      <div>${stars(rv, 22)}</div>
      <div class="review-score-count">${rn||total} ${tx.on_google_reviews}</div>
      ${r.tripadvisor_ranking?`<div class="review-ranking">${r.tripadvisor_ranking}</div>`:''}
    </div>
    <div class="review-histogram">${counts.map(({s,n})=>`
      <button class="histogram-row hist-filter ${_reviewFilter===s?'active':''}" data-stars="${s}">
        <span class="histogram-label">${s}★</span>
        <div class="histogram-bar-wrap"><div class="histogram-bar" style="width:${total?Math.round(n/total*100):0}%"></div></div>
        <span class="histogram-count">${n}</span>
      </button>`).join('')}
    </div>`;
  }
  if (r.tripadvisor_url) {
    html += `<a href="${r.tripadvisor_url}" target="_blank" rel="noopener" class="google-link">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      ${tx.on_google}
    </a>`;
  }
  html += `</div>`;

  // Filter chips (Google-style)
  html += `<div class="review-filter-chips">
    <button class="rev-chip ${_reviewFilter===0?'active':''}" data-stars="0">Alle (${total})</button>
    ${[5,4,3,2,1].map(s => { const n = counts.find(c=>c.s===s).n; return n ? `<button class="rev-chip ${_reviewFilter===s?'active':''}" data-stars="${s}">${s} ★ (${n})</button>` : ''; }).join('')}
  </div>`;

  const filtered = _reviewFilter ? reviews.filter(x => x.rating === _reviewFilter) : reviews;
  html += `<div class="reviews-list">`;
  html += filtered.map(rv=>`<div class="review-card">
    <div class="review-card-top">
      <div class="review-avatar">${rv.author[0]}</div>
      <div>
        <div class="review-author">${rv.author}</div>
        <div class="review-meta">${stars(rv.rating,13)} <span>${rv.date}</span>${rv.source==='google'?`<span class="review-source">· Google</span>`:''}</div>
      </div>
    </div>
    <p class="review-text">"${rv.text}"</p>
  </div>`).join('');
  html += `</div>`;
  const panel = document.getElementById('tab-reviews');
  panel.innerHTML = html;

  // Wire filters (chips + histogram bars both filter)
  panel.querySelectorAll('[data-stars]').forEach(b => b.addEventListener('click', () => {
    const s = parseInt(b.dataset.stars);
    _reviewFilter = (_reviewFilter === s && s !== 0) ? 0 : s;
    renderReviews(r, tx);
  }));
}

// ─── MAP ──────────────────────────────────────────────────────────
function renderMap(r, tx) {
  if (!r.lat||!r.lng) { document.getElementById('tab-map').innerHTML=`<div class="empty-tab">Koordinaten nicht verfügbar.</div>`; return; }
  const bbox=`${r.lng-0.008},${r.lat-0.005},${r.lng+0.008},${r.lat+0.005}`;
  document.getElementById('tab-map').innerHTML = `<div class="map-wrapper">
    <iframe src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${r.lat},${r.lng}" style="width:100%;height:460px;border:none;border-radius:var(--radius);" loading="lazy" title="Karte: ${r.name}"></iframe>
    <a class="map-open-btn" href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=16/${r.lat}/${r.lng}" target="_blank" rel="noopener">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      ${tx.open_maps}
    </a>
  </div>`;
}

// ─── MENU ─────────────────────────────────────────────────────────
function renderMenu(r, tx) {
  let html = '<div class="menu-actions">';
  if (r.menu_pdf_url) html += `<a href="${r.menu_pdf_url}" target="_blank" rel="noopener" class="menu-download"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${tx.dl_menu}</a>`;
  if (r.menu_pdf_drinks_url) html += `<a href="${r.menu_pdf_drinks_url}" target="_blank" rel="noopener" class="menu-download"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>${tx.dl_drinks}</a>`;
  if (!r.menu_pdf_url&&!r.menu_pdf_drinks_url&&r.website_url) html += `<a href="${r.website_url}" target="_blank" rel="noopener" class="menu-download">${tx.visit_web}</a>`;
  html += `<button class="menu-download" onclick="window.print()" style="cursor:pointer"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>${tx.print}</button>`;
  html += '</div>';

  if (r.menu_items?.length) {
    html += r.menu_items.map(cat=>`<div class="menu-category"><h3 class="menu-category-title">${cat.category}</h3><div class="menu-items-list">
      ${cat.items.map(item=>`<div class="menu-item"><span class="menu-item-name">${item.name}${item.note?`<span class="menu-item-note"> · ${item.note}</span>`:''}</span>${item.price!=null?`<span class="menu-item-price">${item.price.toFixed(2).replace('.',',')} €</span>`:''}</div>`).join('')}
    </div></div>`).join('');
  }
  if (r.menu_pdf_url) html += `<iframe class="menu-embed" src="${r.menu_pdf_url}" title="${tx.tab_menu}" style="margin-top:24px"></iframe>`;
  if (!html.replace(/<[^>]*>/g,'').trim()) html += `<div class="empty-tab">${tx.no_menu}</div>`;
  document.getElementById('tab-menu').innerHTML = html;
}

// ─── GALLERY ──────────────────────────────────────────────────────
function renderGallery(r) {
  const imgs = r.gallery_urls?.filter(Boolean)||[];
  if (!imgs.length) return;
  document.getElementById('tab-gallery').innerHTML = `<div class="gallery-grid">
    ${imgs.map((url,i)=>`<div class="gallery-img" onclick="openLightbox(${i})"><img src="${url}" loading="lazy" alt="${r.name}"></div>`).join('')}
  </div>`;
  initLightbox(imgs);
}

// ─── LIGHTBOX ─────────────────────────────────────────────────────
function initLightbox(imgs) {
  let cur = 0;
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lb-img');
  if (!lb||!img) return;
  window.openLightbox = (i) => { cur=i; img.src=imgs[i]; lb.classList.add('open'); };
  document.getElementById('lb-close').onclick = () => lb.classList.remove('open');
  document.getElementById('lb-prev').onclick  = () => { cur=(cur-1+imgs.length)%imgs.length; img.src=imgs[cur]; };
  document.getElementById('lb-next').onclick  = () => { cur=(cur+1)%imgs.length; img.src=imgs[cur]; };
  lb.addEventListener('click', e => { if(e.target===lb) lb.classList.remove('open'); });
  document.addEventListener('keydown', e => {
    if (!lb.classList.contains('open')) return;
    if (e.key==='Escape') lb.classList.remove('open');
    if (e.key==='ArrowLeft')  { cur=(cur-1+imgs.length)%imgs.length; img.src=imgs[cur]; }
    if (e.key==='ArrowRight') { cur=(cur+1)%imgs.length; img.src=imgs[cur]; }
  });
}

// ─── BOOKING ──────────────────────────────────────────────────────
function renderBooking(r, tx) {
  const bc = document.getElementById('booking-container');
  const sa = document.getElementById('sidebar-actions');
  const ss = document.getElementById('sidebar-share');
  const iframeId = `optriq-${r.slug}`;

  if (r.booking_embed_url) {
    bc.innerHTML = `<iframe id="${iframeId}" src="${r.booking_embed_url}" width="100%" frameborder="0" scrolling="no" allowtransparency="true" loading="lazy" style="border:none;width:100%;display:block;overflow:hidden;min-height:400px;"></iframe>`;
    window.addEventListener('message', e => {
      if (e.data?.type==='optriq-resize') { const f=document.getElementById(iframeId); if(f) f.style.height=(e.data.height+20)+'px'; }
    });
    const du = r.booking_embed_url.replace('&embed=1','').replace('?embed=1','');
    sa.innerHTML = `<a href="${du}" target="_blank" rel="noopener" class="btn-secondary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>${tx.new_tab}</a>`;
  } else {
    bc.innerHTML = `<div style="padding:32px 24px;text-align:center;color:var(--text-muted)"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><p style="font-size:14px">${tx.no_booking}</p></div>`;
    if (r.phone) sa.innerHTML = `<a href="tel:${r.phone}" class="btn-primary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>${tx.call}: ${r.phone}</a>`;
  }
  if (r.website_url) sa.insertAdjacentHTML('beforeend', `<a href="${r.website_url}" target="_blank" rel="noopener" class="btn-secondary"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>${tx.visit_web}</a>`);

  // Share widget
  if (ss) ss.innerHTML = `
    <button class="share-btn" onclick="shareRestaurant()"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>${tx.share}</button>`;

  window.shareRestaurant = () => {
    const url = location.href;
    if (navigator.share) { navigator.share({title: r.name, url}); }
    else { navigator.clipboard?.writeText(url).then(()=>toast(t('link_copied'))); }
  };
}

// ─── SIMILAR ──────────────────────────────────────────────────────
async function loadSimilar(r) {
  try {
    const tx = T[getLang()]||T.de;
    const data = await supabaseFetch(`restaurants?is_active=eq.true&city=eq.${encodeURIComponent(r.city)}&slug=neq.${r.slug}&limit=3&order=google_rating.desc.nullslast`);
    if (!data.length) return;
    const sec = document.getElementById('similar-section');
    if (!sec) return;
    sec.style.display = 'block';
    document.getElementById('similar-title').textContent = tx.similar;
    document.getElementById('similar-grid').innerHTML = data.map(s=>`
      <div class="restaurant-card" onclick="location.href='restaurant.html?slug=${s.slug}'" style="cursor:pointer">
        <div class="card-image" style="aspect-ratio:16/9">
          ${s.cover_image_url?`<img src="${s.cover_image_url}" alt="${s.name}" loading="lazy" onload="this.classList.add('loaded')">`:
            `<div class="card-image-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg></div>`}
        </div>
        <div class="card-body">
          <div class="card-top">
            <div class="card-name" style="font-size:15px">${s.name}</div>
            ${(s.google_rating||s.tripadvisor_rating)?`<div class="card-rating" style="font-size:12px">★ ${(s.google_rating||s.tripadvisor_rating).toFixed(1)}</div>`:''}
          </div>
          <div class="card-location" style="font-size:12px"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${s.city||''}</div>
        </div>
      </div>`).join('');
  } catch {}
}

// ─── LIVE SLOT PICKER (#2) ────────────────────────────────────────
let _availData = null, _slotState = { date: null, guests: 2 };

async function renderSlotPicker(r) {
  const el = document.getElementById('slot-picker');
  if (!el) return;
  const resSlug = r.reservation_slug || r.slug;
  if (!r.booking_embed_url) { el.style.display = 'none'; return; }

  el.innerHTML = `<div class="sp-loading">Verfügbarkeit wird geladen…</div>`;
  try {
    _availData = await loadAvailabilityData(resSlug);
    if (!_availData.cfg) { el.style.display = 'none'; return; }
    _slotState.date = nextOpenDate();
    drawSlotPicker(r, resSlug);
  } catch { el.style.display = 'none'; }
}

function nextOpenDate() {
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0,10);
    if (!_util.getOhForDate(_availData, ds).isClosed) return ds;
  }
  return _util.todayStr();
}

function drawSlotPicker(r, resSlug) {
  const el = document.getElementById('slot-picker');
  const tx = T[getLang()] || T.de;
  const lang = getLang();
  const locale = lang==='da'?'da-DK':lang==='en'?'en-GB':'de-DE';

  // Next 7 open days as pills
  const days = [];
  for (let i = 0; i < 14 && days.length < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0,10);
    if (_util.getOhForDate(_availData, ds).isClosed) continue;
    days.push({ ds, label: i===0 ? 'Heute' : i===1 ? 'Morgen' : d.toLocaleDateString(locale,{weekday:'short',day:'numeric',month:'short'}) });
  }

  el.innerHTML = `
    <div class="sp-wrap">
      <div class="sp-row sp-days" id="sp-days">
        ${days.map(d => `<button class="sp-day ${d.ds===_slotState.date?'active':''}" data-date="${d.ds}">${d.label}</button>`).join('')}
      </div>
      <div class="sp-guests-row">
        <span class="sp-guests-label">Personen</span>
        <div class="sp-stepper">
          <button class="sp-step" data-step="-1">−</button>
          <span id="sp-guests">${_slotState.guests}</span>
          <button class="sp-step" data-step="1">+</button>
        </div>
      </div>
      <div class="sp-slots" id="sp-slots"></div>
    </div>`;

  el.querySelector('#sp-days').addEventListener('click', e => {
    const b = e.target.closest('[data-date]'); if (!b) return;
    _slotState.date = b.dataset.date;
    el.querySelectorAll('.sp-day').forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    loadSlots(r, resSlug);
  });
  el.querySelector('.sp-guests-row').addEventListener('click', e => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    _slotState.guests = Math.max(1, Math.min(20, _slotState.guests + parseInt(b.dataset.step)));
    el.querySelector('#sp-guests').textContent = _slotState.guests;
    loadSlots(r, resSlug);
  });

  loadSlots(r, resSlug);
}

async function loadSlots(r, resSlug) {
  const box = document.getElementById('sp-slots');
  if (!box) return;
  box.innerHTML = `<div class="sp-loading">Prüfe Tische…</div>`;
  const reservations = await fetchReservations(resSlug, _slotState.date);
  const slots = computeSlots(_availData, _slotState.date, _slotState.guests, 'egal', reservations);

  if (!slots.length) { box.innerHTML = `<div class="sp-empty">Keine Zeiten an diesem Tag.</div>`; return; }

  box.innerHTML = slots.map(s => {
    const cls = s.available ? (s.pct >= 0.7 ? 'low' : 'free') : 'full';
    const title = s.available ? `${s.totalFreeSeats} Plätze frei` : 'Ausgebucht';
    return `<button class="sp-slot ${cls}" ${s.available?`data-time="${s.start}"`:'disabled'} title="${title}">${s.start}</button>`;
  }).join('');

  box.querySelectorAll('[data-time]').forEach(btn => {
    btn.addEventListener('click', () => {
      const time = btn.dataset.time;
      const base = r.booking_embed_url.split('?')[0];
      const url = `${base}?r=${resSlug}&embed=1&date=${_slotState.date}&time=${time}&guests=${_slotState.guests}`;
      const iframe = document.getElementById(`optriq-${r.slug}`);
      if (iframe) {
        iframe.src = url;
        document.getElementById('booking-container')?.scrollIntoView({ behavior:'smooth', block:'center' });
      } else {
        window.open(url.replace('&embed=1',''), '_blank');
      }
    });
  });
}

// ─── STICKY BAR ───────────────────────────────────────────────────
function initStickyBar(name) {
  const bar = document.getElementById('sticky-bar');
  const el  = document.getElementById('sticky-bar-name');
  if (!bar||!el) return;
  el.textContent = name;
  const hero = document.getElementById('detail-hero');
  new IntersectionObserver(([e]) => bar.classList.toggle('visible', !e.isIntersecting), {threshold:0}).observe(hero);
}

// ─── ICON SVG ─────────────────────────────────────────────────────
function iconSvg(name) {
  const m = {
    'map-pin':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    'phone':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    'mail':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    'globe':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    'instagram':'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
  };
  return m[name]||'';
}

// ─── TABS + HASH ───────────────────────────────────────────────────
function initTabs() {
  const hash = location.hash.replace('#','');
  if (hash) {
    const btn = document.querySelector(`.tab-btn[data-tab="${hash}"]`);
    if (btn) { document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active')); btn.classList.add('active'); document.getElementById(`tab-${hash}`)?.classList.add('active'); }
  }
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add('active');
      history.replaceState(null,'',`#${btn.dataset.tab}`);
    });
  });
  // Keyboard nav for tabs
  document.querySelector('.tabs')?.addEventListener('keydown', e => {
    const btns = [...document.querySelectorAll('.tab-btn')];
    const idx  = btns.findIndex(b=>b===document.activeElement);
    if (e.key==='ArrowRight' && idx<btns.length-1) btns[idx+1].focus();
    if (e.key==='ArrowLeft'  && idx>0) btns[idx-1].focus();
    if (e.key==='Enter'||e.key===' ') document.activeElement.click();
  });
}

// ─── LANG DROPDOWN ────────────────────────────────────────────────
document.getElementById('lang-btn')?.addEventListener('click', e => {
  e.stopPropagation(); document.getElementById('lang-dropdown')?.classList.toggle('open');
});
document.getElementById('lang-dropdown')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-code]'); if (!btn) return;
  setLang(btn.dataset.code); renderLangDropdown(); applyI18n(window._restaurant);
  document.getElementById('lang-dropdown').classList.remove('open');
});
document.addEventListener('click', () => document.getElementById('lang-dropdown')?.classList.remove('open'));

// Back to top
const btt = document.getElementById('back-to-top');
window.addEventListener('scroll', () => btt?.classList.toggle('visible', window.scrollY>400), {passive:true});
btt?.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));

// Theme toggle
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

// Init
initTheme();
renderLangDropdown();
initTabs();
loadRestaurant().then(() => {
  // Fetch restaurant for re-render on lang change
  supabaseFetch(`restaurants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1`).then(([r]) => { window._restaurant = r; });
});
