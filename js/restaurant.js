import { supabaseFetch } from './supabase.js';

const slug = new URLSearchParams(location.search).get('slug');
if (!slug) location.href = 'index.html';

// day_of_week: 0=Sun, 1=Mon … 6=Sat
const DAY_LABELS = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
const TODAY_DOW = new Date().getDay();

async function loadRestaurant() {
  try {
    const [r] = await supabaseFetch(`restaurants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1`);
    if (!r) { location.href = 'index.html'; return; }
    document.title = `${r.name} – Optriq`;

    const resSlug = r.reservation_slug || r.slug;
    const today = new Date().toISOString().slice(0, 10);

    const [hours, exceptions] = await Promise.all([
      supabaseFetch(`opening_hours_weekly?restaurant_id=eq.${resSlug}&order=day_of_week`),
      supabaseFetch(`opening_hours_exceptions?restaurant_id=eq.${resSlug}&date=gte.${today}&order=date`),
    ]);
    r._hours = hours;
    r._exceptions = exceptions;

    render(r);
  } catch { location.href = 'index.html'; }
}

function stars(rating, size = 16) {
  const full = Math.floor(rating), half = rating % 1 >= 0.4;
  const empty = 5 - full - (half ? 1 : 0);
  const s = `font-size:${size}px;color:var(--accent)`;
  return `<span style="${s}">${'★'.repeat(full)}${half ? '½' : ''}${'<span style="color:var(--border)">★</span>'.repeat(empty)}</span>`;
}

function render(r) {
  // ── HERO ──────────────────────────────────────────────────────
  const hero = document.getElementById('detail-hero');
  if (r.cover_image_url) {
    const img = document.createElement('img');
    img.src = r.cover_image_url;
    img.alt = r.name;
    hero.insertBefore(img, hero.firstChild);
  }

  document.getElementById('detail-cuisine').textContent = [r.cuisine_type, r.price_range].filter(Boolean).join(' · ');
  document.getElementById('detail-name').textContent = r.name;

  const meta = document.getElementById('detail-meta');
  const rating = r.tripadvisor_rating || r.google_rating;
  if (rating) {
    meta.innerHTML += `<div class="detail-meta-item rating">${stars(rating, 15)} <span>${rating.toFixed(1)}</span><span style="opacity:.7;font-weight:400">(${r.tripadvisor_review_count || r.google_review_count || ''})</span></div>`;
  }
  if (r.city) {
    meta.innerHTML += `<div class="detail-meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>${r.city}</div>`;
  }
  if (r.tripadvisor_ranking) {
    meta.innerHTML += `<div class="detail-meta-item"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>${r.tripadvisor_ranking}</div>`;
  }

  // ── TABS ──────────────────────────────────────────────────────
  renderOverview(r);
  renderReviews(r);
  renderMap(r);
  renderMenu(r);
  renderGallery(r);
  renderBooking(r);

  // Hide unused tabs
  if (!r.menu_pdf_url) document.getElementById('tab-btn-menu').style.display = 'none';
  if (!(r.gallery_urls?.length > 0)) document.getElementById('tab-btn-gallery').style.display = 'none';
}

function renderOverview(r) {
  let html = '';

  if (r.description) {
    html += `<p class="detail-description">${r.description}</p>`;
  }

  // Ambiance tags
  if (r.ambiance_tags?.length) {
    html += `<div class="tag-group"><span class="tag-group-label">Ambiente</span><div class="tag-list">
      ${r.ambiance_tags.map(t => `<span class="detail-tag">${t}</span>`).join('')}
    </div></div>`;
  }

  // Features
  if (r.features?.length) {
    html += `<div class="tag-group"><span class="tag-group-label">Ausstattung</span><div class="tag-list">
      ${r.features.map(t => `<span class="detail-tag feature">${featureIcon(t)} ${t}</span>`).join('')}
    </div></div>`;
  }

  // Opening hours: weekly + exceptions
  if (r._hours?.length) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayException = r._exceptions?.find(e => e.date === todayStr);
    const todayWeekly = r._hours.find(h => h.day_of_week === TODAY_DOW);

    // Exception overrides weekly for today
    const effectiveToday = todayException ?? todayWeekly;
    const todayOpen = effectiveToday && !effectiveToday.is_closed;
    let todayLabel = todayOpen
      ? `Heute geöffnet · ${effectiveToday.open_time.slice(0,5)}–${effectiveToday.close_time.slice(0,5)}`
      : 'Heute geschlossen';
    if (todayException?.label) todayLabel += ` · ${todayException.label}`;

    // Upcoming exceptions (next 14 days, excluding today)
    const upcoming = (r._exceptions || []).filter(e => e.date !== todayStr);

    html += `<div class="hours-block">
      <div class="hours-header">
        <span class="tag-group-label">Öffnungszeiten</span>
        <span class="hours-today ${todayOpen ? 'open' : 'closed'}">${todayLabel}</span>
      </div>
      <div class="hours-grid">
        ${DAY_LABELS.map((label, dow) => {
          const row = r._hours.find(h => h.day_of_week === dow);
          const isToday = dow === TODAY_DOW;
          const timeStr = (row && !row.is_closed)
            ? `${row.open_time.slice(0,5)}–${row.close_time.slice(0,5)}`
            : null;
          return `<div class="hours-row ${isToday ? 'today' : ''} ${!timeStr ? 'closed' : ''}">
            <span>${label}</span><span>${timeStr || 'Geschlossen'}</span>
          </div>`;
        }).join('')}
      </div>
      ${upcoming.length ? `
        <div class="exceptions-list">
          <span class="tag-group-label" style="margin-top:16px;display:block">Besondere Öffnungszeiten</span>
          ${upcoming.map(e => {
            const d = new Date(e.date + 'T00:00:00');
            const dateStr = d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
            const timeStr = !e.is_closed ? `${e.open_time.slice(0,5)}–${e.close_time.slice(0,5)}` : 'Geschlossen';
            return `<div class="hours-row ${e.is_closed ? 'closed' : ''}">
              <span>${dateStr}${e.label ? ` <em style="color:var(--text-muted);font-style:normal">(${e.label})</em>` : ''}</span>
              <span>${timeStr}</span>
            </div>`;
          }).join('')}
        </div>` : ''}
    </div>`;
  }

  // Info grid
  const infoItems = [
    r.address && { icon: 'map-pin', label: 'Adresse', value: r.address },
    r.phone && { icon: 'phone', label: 'Telefon', value: `<a href="tel:${r.phone}">${r.phone}</a>` },
    r.email && { icon: 'mail', label: 'E-Mail', value: `<a href="mailto:${r.email}">${r.email}</a>` },
    r.website_url && { icon: 'globe', label: 'Website', value: `<a href="${r.website_url}" target="_blank" rel="noopener">${new URL(r.website_url).hostname}</a>` },
    r.instagram_url && { icon: 'instagram', label: 'Instagram', value: `<a href="${r.instagram_url}" target="_blank" rel="noopener">@${r.instagram_url.split('/').filter(Boolean).pop()}</a>` },
  ].filter(Boolean);

  if (infoItems.length) {
    html += `<div class="info-list">${infoItems.map(i => `
      <div class="info-row">
        <span class="info-row-icon">${iconSvg(i.icon)}</span>
        <div><div class="info-row-label">${i.label}</div><div class="info-row-value">${i.value}</div></div>
      </div>`).join('')}</div>`;
  }

  document.getElementById('tab-overview').innerHTML = html;
}

function renderReviews(r) {
  const reviews = r.reviews;
  const rating = r.tripadvisor_rating || r.google_rating;
  if (!reviews?.length) {
    document.getElementById('tab-reviews').innerHTML = `<div class="empty-tab">Noch keine Bewertungen gespeichert.</div>`;
    return;
  }

  let html = `<div class="reviews-header">`;
  if (rating) {
    html += `<div class="review-score">
      <div class="review-score-number">${rating.toFixed(1)}</div>
      <div>${stars(rating, 20)}</div>
      <div class="review-score-count">${r.tripadvisor_review_count || r.google_review_count || reviews.length} Bewertungen</div>
      ${r.tripadvisor_ranking ? `<div class="review-ranking">${r.tripadvisor_ranking}</div>` : ''}
    </div>`;
  }
  if (r.tripadvisor_url) {
    html += `<a href="${r.tripadvisor_url}" target="_blank" rel="noopener" class="tripadvisor-link">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="#00aa6c"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5c2.072 0 4.01.588 5.647 1.61L19.5 6H4.5l1.853-.89A9.464 9.464 0 0 1 12 4.5zM6 9.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5zm12 0a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5zm-6 .75a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/></svg>
      Alle Bewertungen auf TripAdvisor
    </a>`;
  }
  html += `</div>`;

  html += `<div class="reviews-list">` + reviews.map(rv => `
    <div class="review-card">
      <div class="review-card-top">
        <div class="review-avatar">${rv.author[0]}</div>
        <div>
          <div class="review-author">${rv.author}</div>
          <div class="review-meta">${stars(rv.rating, 13)} <span>${rv.date}</span></div>
        </div>
      </div>
      <p class="review-text">"${rv.text}"</p>
    </div>`).join('') + `</div>`;

  document.getElementById('tab-reviews').innerHTML = html;
}

function renderMap(r) {
  if (!r.lat || !r.lng) {
    document.getElementById('tab-map').innerHTML = `<div class="empty-tab">Koordinaten nicht verfügbar.</div>`;
    return;
  }
  const zoom = 16;
  const bbox = `${r.lng - 0.008},${r.lat - 0.005},${r.lng + 0.008},${r.lat + 0.005}`;
  document.getElementById('tab-map').innerHTML = `
    <div class="map-wrapper">
      <iframe
        src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${r.lat},${r.lng}"
        style="width:100%;height:460px;border:none;border-radius:var(--radius);"
        loading="lazy"
        title="Karte: ${r.name}"
      ></iframe>
      <a class="map-open-btn" href="https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=${zoom}/${r.lat}/${r.lng}" target="_blank" rel="noopener">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        In Karten-App öffnen
      </a>
    </div>`;
}

function renderMenu(r) {
  if (!r.menu_pdf_url) return;
  document.getElementById('tab-menu').innerHTML = `
    <a href="${r.menu_pdf_url}" target="_blank" rel="noopener" class="menu-download">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Speisekarte herunterladen
    </a>
    <iframe class="menu-embed" src="${r.menu_pdf_url}" title="Speisekarte"></iframe>`;
}

function renderGallery(r) {
  const images = r.gallery_urls?.filter(Boolean) || [];
  if (!images.length) return;
  document.getElementById('tab-gallery').innerHTML = `<div class="gallery-grid">
    ${images.map(url => `<div class="gallery-img"><img src="${url}" loading="lazy" alt="${r.name}"></div>`).join('')}
  </div>`;
}

function renderBooking(r) {
  const bookingContainer = document.getElementById('booking-container');
  const sidebarActions = document.getElementById('sidebar-actions');
  const iframeId = `optriq-${r.slug}`;

  if (r.booking_embed_url) {
    bookingContainer.innerHTML = `
      <iframe id="${iframeId}" src="${r.booking_embed_url}" width="100%" frameborder="0"
        scrolling="no" allowtransparency="true" loading="lazy"
        style="border:none;width:100%;display:block;overflow:hidden;min-height:400px;"></iframe>`;
    window.addEventListener('message', e => {
      if (e.data?.type === 'optriq-resize') {
        const f = document.getElementById(iframeId);
        if (f) f.style.height = (e.data.height + 20) + 'px';
      }
    });
    const directUrl = r.booking_embed_url.replace('&embed=1', '').replace('?embed=1', '');
    sidebarActions.innerHTML = `<a href="${directUrl}" target="_blank" rel="noopener" class="btn-secondary">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      In neuem Tab öffnen
    </a>`;
  } else {
    bookingContainer.innerHTML = `<div style="padding:32px 24px;text-align:center;color:var(--text-muted)">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <p style="font-size:14px">Online-Reservierung noch nicht eingerichtet.</p>
    </div>`;
    if (r.phone) {
      sidebarActions.innerHTML = `<a href="tel:${r.phone}" class="btn-primary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        Anrufen: ${r.phone}
      </a>`;
    }
  }

  if (r.website_url) {
    sidebarActions.insertAdjacentHTML('beforeend', `<a href="${r.website_url}" target="_blank" rel="noopener" class="btn-secondary">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
      Website besuchen
    </a>`);
  }
}

// ── HELPERS ───────────────────────────────────────────────────────
function featureIcon(t) {
  const map = { 'Terrasse': '☀️', 'Außenterrasse': '☀️', 'Außenbestuhlung': '🪑', 'Kanal': '🛶', 'WLAN': '📶', 'Kartenzahlung': '💳', 'Vegetarisch': '🌿', 'Vegan': '🌱', 'Cocktailbar': '🍹', 'Veranstaltungen': '🎉', 'Reservierungen': '📅' };
  for (const k of Object.keys(map)) if (t.includes(k)) return map[k];
  return '✓';
}

function iconSvg(name) {
  const icons = {
    'map-pin': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    'phone': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    'mail': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    'globe': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    'instagram': '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
  };
  return icons[name] || '';
}

// ── TABS ──────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

loadRestaurant();
