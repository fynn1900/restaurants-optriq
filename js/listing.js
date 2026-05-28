import { supabaseFetch, supabaseRpc } from './supabase.js';

let allRestaurants = [];
let activePrice = '';
let activeDistanceKm = null;
let userCoords = null;
let reservationCounts = {};

// ─── GEOLOCATION ──────────────────────────────────────────────────
function requestLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      document.getElementById('location-btn').innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        Standort aktiv`;
      document.getElementById('location-btn').classList.add('active');
      document.getElementById('distance-chips').style.display = 'flex';
      applyFilters();
    },
    () => {
      document.getElementById('location-btn').textContent = 'Standort nicht verfügbar';
    }
  );
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceLabel(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

// ─── DATA LOADING ─────────────────────────────────────────────────
async function loadRestaurants() {
  try {
    const data = await supabaseFetch('restaurants?is_active=eq.true&order=google_rating.desc.nullslast');
    allRestaurants = data;
    populateFilters(data);
    await loadReservationCounts(data);
    renderCards(filterRestaurants());
  } catch (e) {
    document.getElementById('restaurant-grid').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto;color:#333">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p>Restaurants konnten nicht geladen werden.</p>
      </div>`;
  }
}

async function loadReservationCounts(restaurants) {
  await Promise.all(restaurants.map(async r => {
    const slug = r.reservation_slug || r.slug;
    try {
      const result = await supabaseRpc('get_today_reservation_count', { form_slug: slug });
      reservationCounts[r.id] = result ?? 0;
    } catch {
      reservationCounts[r.id] = null;
    }
  }));
}

// ─── FILTERS ──────────────────────────────────────────────────────
function populateFilters(restaurants) {
  const cities = [...new Set(restaurants.map(r => r.city).filter(Boolean))].sort();
  const cuisines = [...new Set(restaurants.map(r => r.cuisine_type).filter(Boolean))].sort();

  const cityFilter = document.getElementById('city-filter');
  cities.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    cityFilter.appendChild(opt);
  });

  const cuisineFilter = document.getElementById('cuisine-filter');
  cuisines.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    cuisineFilter.appendChild(opt);
  });
}

function filterRestaurants() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const city = document.getElementById('city-filter').value;
  const cuisine = document.getElementById('cuisine-filter').value;
  const minRating = parseFloat(document.getElementById('rating-filter').value) || 0;

  let results = allRestaurants.filter(r => {
    const matchQuery = !query || r.name.toLowerCase().includes(query) || (r.description || '').toLowerCase().includes(query);
    const matchCity = !city || r.city === city;
    const matchCuisine = !cuisine || r.cuisine_type === cuisine;
    const matchRating = !minRating || (r.google_rating && r.google_rating >= minRating);
    const matchPrice = !activePrice || r.price_range === activePrice;
    return matchQuery && matchCity && matchCuisine && matchRating && matchPrice;
  });

  if (userCoords && activeDistanceKm) {
    results = results.filter(r => {
      if (!r.lat || !r.lng) return true;
      return haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng) <= activeDistanceKm;
    });
  }

  if (userCoords) {
    results.sort((a, b) => {
      const dA = (a.lat && a.lng) ? haversineKm(userCoords.lat, userCoords.lng, a.lat, a.lng) : 9999;
      const dB = (b.lat && b.lng) ? haversineKm(userCoords.lat, userCoords.lng, b.lat, b.lng) : 9999;
      return dA - dB;
    });
  }

  return results;
}

// ─── RENDER ───────────────────────────────────────────────────────
function renderCards(restaurants) {
  const grid = document.getElementById('restaurant-grid');
  const count = document.getElementById('result-count');

  count.textContent = `${restaurants.length} Restaurant${restaurants.length !== 1 ? 's' : ''}`;

  if (restaurants.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin:0 auto;color:#333">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <p>Keine Restaurants gefunden. Passe die Filter an.</p>
      </div>`;
    return;
  }

  grid.innerHTML = restaurants.map(r => {
    const distKm = (userCoords && r.lat && r.lng)
      ? haversineKm(userCoords.lat, userCoords.lng, r.lat, r.lng)
      : null;

    const todayCount = reservationCounts[r.id];

    return `
    <div class="restaurant-card" onclick="window.location.href='restaurant.html?slug=${r.slug}'">
      <div class="card-image">
        ${r.cover_image_url
          ? `<img src="${r.cover_image_url}" alt="${r.name}" loading="lazy">`
          : `<div class="card-image-placeholder">🍽</div>`
        }
        ${r.cuisine_type ? `<span class="card-cuisine-tag">${r.cuisine_type}</span>` : ''}
        ${r.price_range ? `<span class="card-price-tag">${r.price_range}</span>` : ''}
        ${distKm !== null ? `<span class="card-distance-tag">${distanceLabel(distKm)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${r.name}</div>
          ${r.google_rating ? `
            <div class="card-rating">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              ${r.google_rating.toFixed(1)}
            </div>` : ''}
        </div>
        <div class="card-location">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          ${[r.city, r.address].filter(Boolean).join(' · ')}
        </div>
        ${r.description ? `<p class="card-description">${r.description}</p>` : ''}
        <div class="card-footer">
          <div class="card-footer-left">
            ${r.google_review_count ? `<span class="card-review-count">${r.google_review_count} Bewertungen</span>` : ''}
            ${todayCount !== null && todayCount !== undefined
              ? `<span class="card-reservations-badge">${todayCount} Reservierung${todayCount !== 1 ? 'en' : ''} heute</span>`
              : ''}
          </div>
          <span class="card-btn">Reservieren</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function applyFilters() {
  renderCards(filterRestaurants());
}

// ─── EVENT LISTENERS ──────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('city-filter').addEventListener('change', applyFilters);
document.getElementById('cuisine-filter').addEventListener('change', applyFilters);
document.getElementById('rating-filter').addEventListener('change', applyFilters);
document.getElementById('location-btn').addEventListener('click', requestLocation);

document.getElementById('price-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-price]');
  if (!chip) return;
  document.querySelectorAll('[data-price]').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activePrice = chip.dataset.price;
  applyFilters();
});

document.getElementById('distance-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-km]');
  if (!chip) return;
  document.querySelectorAll('[data-km]').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeDistanceKm = chip.dataset.km ? parseFloat(chip.dataset.km) : null;
  applyFilters();
});

loadRestaurants();
