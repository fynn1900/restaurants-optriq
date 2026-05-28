import { supabaseFetch, supabaseRpc } from './supabase.js';

let allRestaurants = [];
let allHours = [];
let activePrice = '';
let activeSort = 'rating';
let activeDistanceKm = null;
let userCoords = null;
let reservationCounts = {};

const TODAY_DOW = new Date().getDay();
const NOW_MINS = new Date().getHours() * 60 + new Date().getMinutes();

// ─── HELPERS ──────────────────────────────────────────────────────
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function distanceLabel(km) {
  return km < 1 ? `${Math.round(km*1000)} m` : `${km.toFixed(1).replace('.',',')} km`;
}

function isOpenNow(resSlug) {
  const row = allHours.find(h => h.restaurant_id === resSlug && h.day_of_week === TODAY_DOW);
  if (!row || row.is_closed) return false;
  const open = parseInt(row.open_time.slice(0,2))*60 + parseInt(row.open_time.slice(3,5));
  const close = parseInt(row.close_time.slice(0,2))*60 + parseInt(row.close_time.slice(3,5));
  return NOW_MINS >= open && NOW_MINS < close;
}

function ratingLabel(r) {
  const val = r.tripadvisor_rating || r.google_rating;
  const count = r.tripadvisor_review_count || r.google_review_count;
  return val ? { val, count } : null;
}

// ─── GEOLOCATION ──────────────────────────────────────────────────
function requestLocation() {
  if (!navigator.geolocation) return;
  const btn = document.getElementById('location-btn');
  btn.textContent = 'Wird ermittelt…';
  navigator.geolocation.getCurrentPosition(
    pos => {
      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> Standort aktiv`;
      btn.classList.add('active');
      document.getElementById('distance-chips').style.display = 'flex';
      applyFilters();
    },
    () => { btn.textContent = 'Standort nicht verfügbar'; }
  );
}

// ─── DATA ─────────────────────────────────────────────────────────
async function loadRestaurants() {
  try {
    const [data, hours] = await Promise.all([
      supabaseFetch('restaurants?is_active=eq.true&order=tripadvisor_rating.desc.nullslast'),
      supabaseFetch('opening_hours_weekly?select=restaurant_id,day_of_week,is_closed,open_time,close_time'),
    ]);
    allRestaurants = data;
    allHours = hours;
    populateFilters(data);
    await loadReservationCounts(data);
    renderStats(data);
    renderCards(filterRestaurants());
  } catch {
    document.getElementById('restaurant-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><p>Restaurants konnten nicht geladen werden.</p></div>`;
  }
}

async function loadReservationCounts(restaurants) {
  await Promise.all(restaurants.map(async r => {
    const slug = r.reservation_slug || r.slug;
    try { reservationCounts[r.id] = await supabaseRpc('get_today_reservation_count', { form_slug: slug }) ?? 0; }
    catch { reservationCounts[r.id] = null; }
  }));
}

// ─── STATS STRIP ──────────────────────────────────────────────────
function renderStats(restaurants) {
  const total = restaurants.length;
  const cities = new Set(restaurants.map(r => r.city).filter(Boolean)).size;
  const el = document.getElementById('stats-strip');
  if (el) el.innerHTML = `
    <span><strong>${total}</strong> Restaurants</span>
    <span class="stats-divider">·</span>
    <span><strong>${cities}</strong> ${cities === 1 ? 'Stadt' : 'Städte'}</span>
    <span class="stats-divider">·</span>
    <span>Kostenlos reservieren</span>
    <span class="stats-divider">·</span>
    <span>Sofort bestätigt</span>`;
}

// ─── FILTERS ──────────────────────────────────────────────────────
function populateFilters(restaurants) {
  const cities = [...new Set(restaurants.map(r => r.city).filter(Boolean))].sort();
  const cuisines = [...new Set(restaurants.map(r => r.cuisine_type).filter(Boolean))].sort();
  cities.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    document.getElementById('city-filter').appendChild(o);
  });
  cuisines.forEach(c => {
    const o = document.createElement('option'); o.value = c; o.textContent = c;
    document.getElementById('cuisine-filter').appendChild(o);
  });
}

function filterRestaurants() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const city = document.getElementById('city-filter').value;
  const cuisine = document.getElementById('cuisine-filter').value;
  const minRating = parseFloat(document.getElementById('rating-filter').value) || 0;

  let results = allRestaurants.filter(r => {
    const rating = r.tripadvisor_rating || r.google_rating || 0;
    return (!query || r.name.toLowerCase().includes(query) || (r.description||'').toLowerCase().includes(query))
      && (!city || r.city === city)
      && (!cuisine || r.cuisine_type === cuisine)
      && (!minRating || rating >= minRating)
      && (!activePrice || r.price_range === activePrice);
  });

  if (userCoords && activeDistanceKm) {
    results = results.filter(r => !r.lat || !r.lng || haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng) <= activeDistanceKm);
  }

  // Sort
  results.sort((a, b) => {
    if (activeSort === 'rating') {
      return ((b.tripadvisor_rating||b.google_rating||0) - (a.tripadvisor_rating||a.google_rating||0));
    }
    if (activeSort === 'price') {
      const p = {'€':1,'€€':2,'€€€':3};
      return (p[a.price_range]||9) - (p[b.price_range]||9);
    }
    if (activeSort === 'name') return a.name.localeCompare(b.name, 'de');
    if (activeSort === 'distance' && userCoords) {
      const dA = (a.lat&&a.lng) ? haversineKm(userCoords.lat,userCoords.lng,a.lat,a.lng) : 9999;
      const dB = (b.lat&&b.lng) ? haversineKm(userCoords.lat,userCoords.lng,b.lat,b.lng) : 9999;
      return dA - dB;
    }
    return 0;
  });

  return results;
}

// ─── RENDER CARDS ─────────────────────────────────────────────────
function renderCards(restaurants) {
  const grid = document.getElementById('restaurant-grid');
  document.getElementById('result-count').textContent = `${restaurants.length} Restaurant${restaurants.length!==1?'s':''}`;

  if (!restaurants.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto;color:var(--text-muted)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <p>Keine Restaurants gefunden.</p></div>`;
    return;
  }

  grid.innerHTML = restaurants.map((r, i) => {
    const distKm = (userCoords && r.lat && r.lng) ? haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng) : null;
    const todayCount = reservationCounts[r.id];
    const rt = ratingLabel(r);
    const resSlug = r.reservation_slug || r.slug;
    const open = isOpenNow(resSlug);
    const stars = rt ? '★'.repeat(Math.round(rt.val)) : '';

    return `<div class="restaurant-card" style="animation-delay:${i*60}ms" onclick="location.href='restaurant.html?slug=${r.slug}'">
      <div class="card-image">
        ${r.cover_image_url ? `<img src="${r.cover_image_url}" alt="${r.name}" loading="lazy">` : `<div class="card-image-placeholder">🍽</div>`}
        <div class="card-image-badges">
          ${r.cuisine_type ? `<span class="card-cuisine-tag">${r.cuisine_type}</span>` : ''}
          <span class="card-open-badge ${open ? 'open' : 'closed'}">${open ? 'Geöffnet' : 'Geschlossen'}</span>
        </div>
        ${r.price_range ? `<span class="card-price-tag">${r.price_range}</span>` : ''}
        ${distKm !== null ? `<span class="card-distance-tag">${distanceLabel(distKm)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${r.name}</div>
          ${rt ? `<div class="card-rating">
            <span class="card-stars">${stars}</span>
            <span>${rt.val.toFixed(1)}</span>
          </div>` : ''}
        </div>
        <div class="card-location">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${[r.city, r.address].filter(Boolean).join(' · ')}
        </div>
        ${r.description ? `<p class="card-description">${r.description}</p>` : ''}
        <div class="card-footer">
          <div class="card-footer-left">
            ${rt?.count ? `<span class="card-review-count">${rt.count} Bewertungen</span>` : ''}
            ${todayCount ? `<span class="card-reservations-badge">${todayCount} heute</span>` : ''}
          </div>
          <span class="card-btn">Reservieren →</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function applyFilters() { renderCards(filterRestaurants()); }

// ─── EVENTS ───────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('city-filter').addEventListener('change', applyFilters);
document.getElementById('cuisine-filter').addEventListener('change', applyFilters);
document.getElementById('rating-filter').addEventListener('change', applyFilters);
document.getElementById('location-btn').addEventListener('click', requestLocation);

document.getElementById('price-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-price]'); if (!chip) return;
  document.querySelectorAll('[data-price]').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); activePrice = chip.dataset.price; applyFilters();
});

document.getElementById('distance-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-km]'); if (!chip) return;
  document.querySelectorAll('[data-km]').forEach(c => c.classList.remove('active'));
  chip.classList.add('active'); activeDistanceKm = chip.dataset.km ? parseFloat(chip.dataset.km) : null; applyFilters();
});

document.getElementById('sort-select')?.addEventListener('change', e => {
  activeSort = e.target.value; applyFilters();
});

loadRestaurants();
