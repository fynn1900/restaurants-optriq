import { supabaseFetch } from './supabase.js';

const slug = new URLSearchParams(location.search).get('slug');
if (!slug) location.href = 'index.html';

async function loadRestaurant() {
  try {
    const [restaurant] = await supabaseFetch(`restaurants?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&limit=1&select=*,booking_embed_url`);
    if (!restaurant) { location.href = 'index.html'; return; }
    render(restaurant);
    document.title = `${restaurant.name} – Optriq`;
  } catch {
    location.href = 'index.html';
  }
}

function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return `<div class="stars">
    ${'<span class="star filled">★</span>'.repeat(full)}
    ${half ? '<span class="star half">★</span>' : ''}
    ${'<span class="star">★</span>'.repeat(empty)}
  </div>`;
}

function render(r) {
  // Hero
  const hero = document.getElementById('detail-hero');
  if (r.cover_image_url) {
    hero.insertAdjacentHTML('afterbegin', `<img src="${r.cover_image_url}" alt="${r.name}">`);
  }

  document.getElementById('detail-cuisine').textContent = [r.cuisine_type, r.price_range].filter(Boolean).join(' · ');
  document.getElementById('detail-name').textContent = r.name;

  const meta = document.getElementById('detail-meta');
  if (r.google_rating) {
    meta.innerHTML += `
      <div class="detail-meta-item rating">
        ${renderStars(r.google_rating)}
        <span>${r.google_rating.toFixed(1)}</span>
        ${r.google_review_count ? `<span style="font-weight:400;color:var(--text-secondary)">(${r.google_review_count})</span>` : ''}
      </div>`;
  }
  if (r.city) {
    meta.innerHTML += `
      <div class="detail-meta-item">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        ${r.city}
      </div>`;
  }

  // Description
  document.getElementById('detail-description').textContent = r.description || '';

  // Info grid
  const infoItems = [
    { label: 'Adresse', value: r.address || '–' },
    { label: 'Stadt', value: r.city || '–' },
    { label: 'Telefon', value: r.phone ? `<a href="tel:${r.phone}">${r.phone}</a>` : '–' },
    { label: 'Website', value: r.website_url ? `<a href="${r.website_url}" target="_blank" rel="noopener">${new URL(r.website_url).hostname}</a>` : '–' },
    { label: 'Küche', value: r.cuisine_type || '–' },
    { label: 'Preisklasse', value: r.price_range || '–' },
  ];

  document.getElementById('info-grid').innerHTML = infoItems.map(i => `
    <div class="info-item">
      <div class="info-item-label">${i.label}</div>
      <div class="info-item-value">${i.value}</div>
    </div>
  `).join('');

  // Booking
  const bookingContainer = document.getElementById('booking-container');
  const sidebarActions = document.getElementById('sidebar-actions');
  const embedUrl = r.booking_embed_url;
  const iframeId = `optriq-${r.slug}`;

  if (embedUrl) {
    bookingContainer.innerHTML = `
      <iframe
        id="${iframeId}"
        src="${embedUrl}"
        width="100%"
        frameborder="0"
        scrolling="no"
        allowtransparency="true"
        style="border:none;width:100%;display:block;overflow:hidden;min-height:400px;"
        loading="lazy"
      ></iframe>`;

    window.addEventListener('message', e => {
      if (e.data?.type === 'optriq-resize') {
        const f = document.getElementById(iframeId);
        if (f) f.style.height = (e.data.height + 20) + 'px';
      }
    });

    const directUrl = embedUrl.replace('&embed=1', '').replace('?embed=1', '');
    sidebarActions.innerHTML = `
      <a href="${directUrl}" target="_blank" rel="noopener" class="btn-secondary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        In neuem Tab öffnen
      </a>`;
  } else {
    bookingContainer.innerHTML = `
      <div style="padding:32px 24px;text-align:center;color:var(--text-muted)">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto 12px">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <p style="font-size:14px">Online-Reservierung<br>noch nicht eingerichtet.</p>
      </div>`;
    if (r.phone) {
      sidebarActions.innerHTML = `
        <a href="tel:${r.phone}" class="btn-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.38 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.81a16 16 0 0 0 6.29 6.29l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
          </svg>
          Anrufen: ${r.phone}
        </a>`;
    }
  }

  if (r.website_url) {
    sidebarActions.insertAdjacentHTML('beforeend', `
      <a href="${r.website_url}" target="_blank" rel="noopener" class="btn-secondary">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        Website besuchen
      </a>`);
  }

  // Menu tab
  const menuContainer = document.getElementById('menu-container');
  if (r.menu_pdf_url) {
    document.getElementById('tab-menu-btn').style.display = 'block';
    menuContainer.innerHTML = `
      <a href="${r.menu_pdf_url}" target="_blank" rel="noopener" class="menu-download">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Speisekarte herunterladen
      </a>
      <iframe class="menu-embed" src="${r.menu_pdf_url}" title="Speisekarte"></iframe>`;
  } else {
    document.getElementById('tab-menu-btn').style.display = 'none';
  }

  // Gallery tab
  const galleryGrid = document.getElementById('gallery-grid');
  const images = r.gallery_urls?.filter(Boolean) || [];
  if (images.length > 0) {
    document.getElementById('tab-gallery-btn').style.display = 'block';
    galleryGrid.innerHTML = images.map(url => `
      <div class="gallery-img">
        <img src="${url}" alt="${r.name}" loading="lazy">
      </div>
    `).join('');
  } else {
    document.getElementById('tab-gallery-btn').style.display = 'none';
  }
}

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

loadRestaurant();
