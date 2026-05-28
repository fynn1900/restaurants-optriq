import { supabaseFetch, supabaseRpc } from './supabase.js';
import { t, getLang, setLang, LANGUAGES, T } from './i18n.js';

let allRestaurants = [], allHours = [];
let activePrice = '', activeSort = 'rating', activeDistanceKm = null;
let userCoords = null, reservationCounts = {}, favorites = new Set();
let showOnlyOpen = false, showOnlyFav = false, activeMealTime = null;
let mapView = false, leafletMap = null;

const TODAY_DOW = new Date().getDay();
const NOW_H     = new Date().getHours();
const NOW_MINS  = NOW_H * 60 + new Date().getMinutes();
const SEEN_KEY  = 'optriq_seen';

// Meal time windows
const MEAL_TIMES = {
  fruehstueck: { label: 'Frühstück', en: 'Breakfast', da: 'Morgenmad', icon: '☕', from: 7*60,  to: 11*60 },
  mittag:      { label: 'Mittagessen', en: 'Lunch',    da: 'Frokost',  icon: '🥗', from: 11*60, to: 14*60 },
  kaffee:      { label: 'Kaffee & Kuchen', en: 'Coffee', da: 'Kaffe',  icon: '🍰', from: 14*60, to: 17*60 },
  abend:       { label: 'Abendessen', en: 'Dinner',   da: 'Aftensmad',icon: '🍽', from: 17*60, to: 23*60 },
};

// ─── UTILS ────────────────────────────────────────────────────────
function haversineKm(a, b, c, d) {
  const R = 6371, dLat=(c-a)*Math.PI/180, dLng=(d-b)*Math.PI/180;
  const x = Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
function distLabel(km) {
  return km < 1 ? `${Math.round(km*1000)} ${t('m_away')}` : `${km.toFixed(1).replace('.',',')} ${t('km_away')}`;
}
function getHoursRow(resSlug, dow = TODAY_DOW) {
  return allHours.find(h => h.restaurant_id === resSlug && h.day_of_week === dow) || null;
}
function isOpen(resSlug) {
  const row = getHoursRow(resSlug);
  if (!row || row.is_closed) return false;
  const o = +row.open_time.slice(0,2)*60 + +row.open_time.slice(3,5);
  const c = +row.close_time.slice(0,2)*60 + +row.close_time.slice(3,5);
  return NOW_MINS >= o && NOW_MINS < c;
}
function nextOpenInfo(resSlug) {
  // Returns "Öffnet heute um HH:MM" or "Öffnet morgen um HH:MM" or null
  const row = getHoursRow(resSlug);
  if (row && !row.is_closed) {
    const o = +row.open_time.slice(0,2)*60 + +row.open_time.slice(3,5);
    if (NOW_MINS < o) return `Öffnet um ${row.open_time.slice(0,5)} Uhr`;
  }
  // Check next 6 days
  for (let d = 1; d <= 6; d++) {
    const dow = (TODAY_DOW + d) % 7;
    const r = getHoursRow(resSlug, dow);
    if (r && !r.is_closed) {
      return d === 1 ? `Öffnet morgen um ${r.open_time.slice(0,5)}` : `Öffnet ${['So','Mo','Di','Mi','Do','Fr','Sa'][dow]}`;
    }
  }
  return null;
}
function closingSoonInfo(resSlug) {
  const row = getHoursRow(resSlug);
  if (!row || row.is_closed) return null;
  const c = +row.close_time.slice(0,2)*60 + +row.close_time.slice(3,5);
  const diff = c - NOW_MINS;
  if (diff > 0 && diff <= 60) return `Schließt in ${diff} Min`;
  return null;
}
function isOpenDuring(resSlug, fromMins, toMins) {
  const row = getHoursRow(resSlug);
  if (!row || row.is_closed) return false;
  const o = +row.open_time.slice(0,2)*60 + +row.open_time.slice(3,5);
  const c = +row.close_time.slice(0,2)*60 + +row.close_time.slice(3,5);
  return o <= toMins && c >= fromMins;
}
function rating(r) {
  const v = r.google_rating || r.tripadvisor_rating;
  const n = r.google_review_count || r.tripadvisor_review_count;
  return v ? {v, n} : null;
}
function starsHtml(v) {
  const f=Math.floor(v), h=v%1>=0.4, e=5-f-(h?1:0);
  return '★'.repeat(f)+(h?'½':'')+`<span style="color:var(--border)">${'★'.repeat(e)}</span>`;
}
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}
function progress(pct) {
  const b = document.getElementById('progress-bar');
  if (!b) return;
  b.style.transform = `scaleX(${pct})`;
  if (pct >= 1) { b.classList.add('done'); setTimeout(() => { b.classList.remove('done'); b.style.transform='scaleX(0)'; }, 600); }
}

// ─── SEEN ─────────────────────────────────────────────────────────
function getSeenSlugs() { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; } }

// ─── FAV ──────────────────────────────────────────────────────────
function loadFavs() {
  try { favorites = new Set(JSON.parse(localStorage.getItem('optriq_favs') || '[]')); } catch { favorites = new Set(); }
}
function saveFavs() { localStorage.setItem('optriq_favs', JSON.stringify([...favorites])); }
function toggleFav(id, name) {
  if (favorites.has(id)) { favorites.delete(id); toast(t('fav_removed')); }
  else { favorites.add(id); toast(t('fav_added')); }
  saveFavs(); renderCards(filterRestaurants());
}

// ─── LOCATION ─────────────────────────────────────────────────────
function requestLocation() {
  const btn = document.getElementById('location-btn');
  btn.textContent = '…';
  navigator.geolocation?.getCurrentPosition(
    pos => {
      userCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> ${t('loc_active')}`;
      btn.classList.add('active');
      document.getElementById('distance-chips').style.display = 'flex';
      applyFilters();
    },
    () => { btn.textContent = t('loc_fail'); }
  );
}

// ─── DARK MODE ────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('optriq_theme');
  const pref  = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', saved || pref);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('optriq_theme', next);
}

// ─── LANGUAGE ─────────────────────────────────────────────────────
function initLang() {
  const lang = getLang();
  document.documentElement.lang = lang;
  renderLangDropdown();
  applyI18n();
}
function renderLangDropdown() {
  const btn  = document.getElementById('lang-btn');
  const drop = document.getElementById('lang-dropdown');
  if (!btn || !drop) return;
  const cur = getLang();
  btn.innerHTML = `<span class="lang-flag">${LANGUAGES[cur].flag}</span><span>${LANGUAGES[cur].label}</span>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
  drop.innerHTML = Object.values(LANGUAGES).map(l =>
    `<button class="lang-option ${l.code===cur?'active':''}" data-code="${l.code}">
       <span class="lang-flag">${l.flag}</span><span>${l.label}</span>
     </button>`
  ).join('');
}
function applyI18n() {
  const cur = getLang();
  const tx  = T[cur] || T.de;
  const map = {
    '[data-i18n="nav_about"]': tx.nav_about,
    '[data-i18n="nav_contact"]': tx.nav_contact,
    '[data-i18n="hero_label"]': tx.hero_label,
    '[data-i18n="hero_h1_1"]': tx.hero_h1_1,
    '[data-i18n="hero_h1_em"]': tx.hero_h1_em,
    '[data-i18n="hero_desc"]': tx.hero_desc,
    '[data-i18n="all_restaurants"]': tx.all_restaurants,
    '[data-i18n="topbar_text"]': tx.topbar,
    '[data-i18n="topbar_cta"]': tx.topbar_cta,
  };
  Object.entries(map).forEach(([sel, val]) => {
    document.querySelectorAll(sel).forEach(el => { el.textContent = val; });
  });
  const si = document.getElementById('search-input');
  if (si) si.placeholder = tx.search_ph;
  document.getElementById('open-now-chip')?.setAttribute('data-label', tx.open_now);
  if (document.getElementById('open-now-chip')) document.getElementById('open-now-chip').textContent = tx.open_now;
  if (document.getElementById('favorites-chip')) document.getElementById('favorites-chip').textContent = tx.fav;
  if (document.getElementById('location-btn') && !userCoords) document.getElementById('location-btn').lastChild.textContent = ` ${tx.my_loc}`;
  document.querySelectorAll('#sort-select option').forEach(o => {
    const map2 = { rating: tx.sort_rating, distance: tx.sort_dist, price: tx.sort_price, name: tx.sort_name };
    if (map2[o.value]) o.textContent = map2[o.value];
  });
  document.querySelectorAll('#city-filter option[value=""]').forEach(o => o.textContent = tx.all_cities);
  document.querySelectorAll('#cuisine-filter option[value=""]').forEach(o => o.textContent = tx.all_cuisines);
  document.querySelectorAll('#rating-filter option[value=""]').forEach(o => o.textContent = tx.all_ratings);
  document.querySelectorAll('#rating-filter option[value="4.5"]').forEach(o => o.textContent = tx.stars_45);
  document.querySelectorAll('#rating-filter option[value="4.0"]').forEach(o => o.textContent = tx.stars_40);
  document.querySelectorAll('#rating-filter option[value="3.5"]').forEach(o => o.textContent = tx.stars_35);
  document.querySelectorAll('[data-price=""]').forEach(o => o.textContent = tx.price_all);
  document.querySelector('[data-km=""]')?.setAttribute('aria-label', tx.dist_all);
  if (document.querySelector('[data-km=""]')) document.querySelector('[data-km=""]').textContent = tx.dist_all;
  renderCards(filterRestaurants());
  renderStats(allRestaurants);
}

// ─── WEATHER ──────────────────────────────────────────────────────
const WX_ICONS = {0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',48:'🌫',51:'🌦',61:'🌧',63:'🌧',71:'🌨',80:'🌦',95:'⛈'};
async function loadWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`;
    const data = await (await fetch(url)).json();
    const temp = Math.round(data.current.temperature_2m);
    const code = data.current.weather_code;
    const icon = WX_ICONS[code] || '🌡';
    const el = document.getElementById('weather-strip');
    if (!el) return;
    const isGood = temp >= 18 && [0,1,2,3].includes(code);
    el.style.display = 'flex';
    el.innerHTML = `<span class="wx-icon">${icon}</span><span class="wx-temp">${temp}°C</span><span class="wx-msg">${isGood ? '– Perfekt für die Terrasse!' : temp >= 10 ? '– Drinnen gemütlich.' : '– Warm bleiben!'}</span>`;
  } catch {}
}

// ─── MEAL TIME BAR ────────────────────────────────────────────────
function renderMealTimeBar() {
  const bar = document.getElementById('meal-time-bar');
  if (!bar) return;
  const lang = getLang();
  const active = Object.entries(MEAL_TIMES).find(([,v]) => NOW_MINS >= v.from && NOW_MINS < v.to)?.[0] || null;
  bar.innerHTML = `<div class="meal-bar-label">Für heute:</div>` +
    Object.entries(MEAL_TIMES).map(([key, m]) => {
      const lbl = lang === 'en' ? m.en : lang === 'da' ? m.da : m.label;
      const isCurrent = key === active;
      return `<button class="meal-chip ${activeMealTime===key?'active':''} ${isCurrent?'current':''}" data-meal="${key}">
        ${m.icon} ${lbl}${isCurrent?' <span class="meal-now">jetzt</span>':''}
      </button>`;
    }).join('');
  bar.style.display = 'flex';
}

// ─── MAP VIEW ─────────────────────────────────────────────────────
function initMapView(restaurants) {
  const el = document.getElementById('map-view');
  if (!el) return;
  el.style.display = 'block';
  document.getElementById('restaurant-grid').style.display = 'none';

  if (leafletMap) { leafletMap.remove(); leafletMap = null; }

  // Center on restaurants or Germany
  const withCoords = restaurants.filter(r => r.lat && r.lng);
  const center = withCoords.length
    ? [withCoords.reduce((s,r)=>s+r.lat,0)/withCoords.length, withCoords.reduce((s,r)=>s+r.lng,0)/withCoords.length]
    : [53.5, 9.5];

  leafletMap = L.map(el, { zoomControl: true }).setView(center, withCoords.length > 1 ? 9 : 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap', maxZoom: 19
  }).addTo(leafletMap);

  withCoords.forEach(r => {
    const rv = r.google_rating || r.tripadvisor_rating;
    const popup = `<div style="font-family:Inter,sans-serif;min-width:180px">
      <strong style="font-size:14px">${r.name}</strong><br>
      ${rv ? `<span style="color:#b8895a">★ ${rv.toFixed(1)}</span> · ` : ''}${r.cuisine_type||''}<br>
      <a href="restaurant.html?slug=${r.slug}" style="color:#b8895a;font-weight:600;font-size:13px">Zur Detailseite →</a>
    </div>`;
    L.marker([r.lat, r.lng])
      .bindPopup(popup, { maxWidth: 220 })
      .addTo(leafletMap);
  });

  if (userCoords) {
    L.circleMarker([userCoords.lat, userCoords.lng], { radius: 8, color: '#22a85a', fillColor: '#22a85a', fillOpacity: 0.5 })
      .bindPopup('Mein Standort').addTo(leafletMap);
  }
  setTimeout(() => leafletMap.invalidateSize(), 100);
}

function hideMapView() {
  const el = document.getElementById('map-view');
  if (el) el.style.display = 'none';
  document.getElementById('restaurant-grid').style.display = 'grid';
  if (leafletMap) { leafletMap.remove(); leafletMap = null; }
}

// ─── DATA ─────────────────────────────────────────────────────────
async function loadRestaurants() {
  progress(0.3);
  try {
    const [data, hours] = await Promise.all([
      supabaseFetch('restaurants?is_active=eq.true&order=google_rating.desc.nullslast'),
      supabaseFetch('opening_hours_weekly?select=restaurant_id,day_of_week,is_closed,open_time,close_time'),
    ]);
    progress(0.7);
    allRestaurants = data; allHours = hours;
    loadFavs();
    populateFilters(data);
    await loadReservationCounts(data);
    renderStats(data);
    renderMealTimeBar();
    renderCards(filterRestaurants());
    progress(1);
  } catch {
    document.getElementById('restaurant-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1"><p>${t('load_err')}</p></div>`;
    progress(1);
  }
}
async function loadReservationCounts(rs) {
  await Promise.all(rs.map(async r => {
    try { reservationCounts[r.id] = await supabaseRpc('get_today_reservation_count', {form_slug: r.reservation_slug||r.slug}) ?? 0; }
    catch { reservationCounts[r.id] = null; }
  }));
}

// ─── STATS ────────────────────────────────────────────────────────
function renderStats(rs) {
  const cities = new Set(rs.map(r => r.city).filter(Boolean)).size;
  const el = document.getElementById('stats-strip');
  if (!el) return;
  el.innerHTML = `<strong>${rs.length}</strong> ${t('stat_restaurants'||'Restaurants')}
    <span class="stats-divider">·</span>
    <strong>${cities}</strong> ${cities===1?T[getLang()].stats_city||'Stadt':T[getLang()].stats_cities||'Städte'}
    <span class="stats-divider">·</span> ${t('stat_free')}
    <span class="stats-divider">·</span> ${t('stat_instant')}`;
}

// ─── FILTERS ──────────────────────────────────────────────────────
function populateFilters(rs) {
  const cities = [...new Set(rs.map(r => r.city).filter(Boolean))].sort();
  const cuisines = [...new Set(rs.map(r => r.cuisine_type).filter(Boolean))].sort();
  cities.forEach(c => { const o=document.createElement('option'); o.value=c; o.textContent=c; document.getElementById('city-filter').appendChild(o); });
  cuisines.forEach(c => { const o=document.createElement('option'); o.value=c; o.textContent=c; document.getElementById('cuisine-filter').appendChild(o); });
}
function filterRestaurants() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const city  = document.getElementById('city-filter').value;
  const cui   = document.getElementById('cuisine-filter').value;
  const minR  = parseFloat(document.getElementById('rating-filter').value) || 0;

  let res = allRestaurants.filter(r => {
    const rv = r.google_rating||r.tripadvisor_rating||0;
    const sl = r.reservation_slug||r.slug;
    return (!query||r.name.toLowerCase().includes(query)||(r.description||'').toLowerCase().includes(query))
      && (!city||r.city===city) && (!cui||r.cuisine_type===cui)
      && (!minR||rv>=minR) && (!activePrice||r.price_range===activePrice)
      && (!showOnlyOpen||isOpen(sl))
      && (!showOnlyFav||favorites.has(r.id))
      && (!activeMealTime||isOpenDuring(sl, MEAL_TIMES[activeMealTime].from, MEAL_TIMES[activeMealTime].to));
  });

  if (userCoords && activeDistanceKm)
    res = res.filter(r => !r.lat||!r.lng||haversineKm(userCoords.lat,userCoords.lng,r.lat,r.lng)<=activeDistanceKm);

  res.sort((a,b) => {
    if (activeSort==='rating') return (b.google_rating||b.tripadvisor_rating||0)-(a.google_rating||a.tripadvisor_rating||0);
    if (activeSort==='price')  { const p={'€':1,'€€':2,'€€€':3}; return (p[a.price_range]||9)-(p[b.price_range]||9); }
    if (activeSort==='name')   return a.name.localeCompare(b.name,'de');
    if (activeSort==='distance'&&userCoords) {
      const dA=(a.lat&&a.lng)?haversineKm(userCoords.lat,userCoords.lng,a.lat,a.lng):9999;
      const dB=(b.lat&&b.lng)?haversineKm(userCoords.lat,userCoords.lng,b.lat,b.lng):9999;
      return dA-dB;
    }
    return 0;
  });
  return res;
}

// ─── RENDER ───────────────────────────────────────────────────────
function renderCards(rs) {
  const grid  = document.getElementById('restaurant-grid');
  const count = document.getElementById('result-count');
  count.textContent = `${rs.length} ${rs.length!==1?t('all_restaurants'):'Restaurant'}`;
  if (!rs.length) { grid.innerHTML=`<div class="empty-state" style="grid-column:1/-1"><p>${t('no_results')}</p></div>`; return; }

  const seen = new Set(getSeenSlugs());
  const tx = T[getLang()]||T.de;

  grid.innerHTML = rs.map((r,i) => {
    const dist = (userCoords&&r.lat&&r.lng) ? haversineKm(userCoords.lat,userCoords.lng,r.lat,r.lng) : null;
    const cnt  = reservationCounts[r.id];
    const rt   = rating(r);
    const sl   = r.reservation_slug||r.slug;
    const open = isOpen(sl);
    const closing = open ? closingSoonInfo(sl) : null;
    const nextOpen = !open ? nextOpenInfo(sl) : null;
    const isFav = favorites.has(r.id);
    const wasSeen = seen.has(r.slug);

    return `<div class="restaurant-card" style="animation-delay:${i*55}ms" onclick="location.href='restaurant.html?slug=${r.slug}'">
      <button class="card-fav-btn ${isFav?'active':''}" onclick="event.stopPropagation();window.toggleFav('${r.id}','${r.name}')" aria-label="Favorit">
        ${isFav?'♥':'♡'}
      </button>
      <div class="card-image">
        ${r.cover_image_url
          ? `<img src="${r.cover_image_url}" alt="${r.name}" loading="lazy" onload="this.classList.add('loaded')">`
          : `<div class="card-image-placeholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg></div>`}
        ${r.cuisine_type ? `<div class="card-image-badges"><span class="card-cuisine-tag">${r.cuisine_type}</span></div>` : ''}
        ${closing ? `<span class="card-open-badge closing">${closing}</span>` : `<span class="card-open-badge ${open?'open':'closed'}">${open?tx.open:tx.closed}</span>`}
        ${nextOpen && !open ? `<span class="card-next-open">${nextOpen}</span>` : ''}
        ${r.price_range ? `<span class="card-price-tag">${r.price_range}</span>` : ''}
        ${dist!==null ? `<span class="card-distance-tag">${distLabel(dist)}</span>` : ''}
        ${wasSeen ? `<span class="card-seen-badge">${tx.seen}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-top">
          <div class="card-name">${r.name}</div>
          ${rt ? `<div class="card-rating"><span class="card-stars">${starsHtml(rt.v)}</span> ${rt.v.toFixed(1)}</div>` : ''}
        </div>
        <div class="card-location">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${[r.city, r.address].filter(Boolean).join(' · ')}
        </div>
        ${r.description ? `<p class="card-description">${r.description}</p>` : ''}
        <div class="card-footer">
          <div class="card-footer-left">
            ${cnt!=null&&cnt>0 ? `<span class="card-reservations-badge">${cnt} ${cnt!==1?tx.res_today_pl:tx.res_today_sg}</span>` : ''}
            ${rt?.n ? `<span class="card-review-count">${rt.n} ${tx.reviews}</span>` : ''}
          </div>
          <span class="card-btn">${tx.reserve}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
window.toggleFav = toggleFav;

function applyFilters() { renderCards(filterRestaurants()); }

// ─── EVENTS ───────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', applyFilters);
document.getElementById('city-filter').addEventListener('change', applyFilters);
document.getElementById('cuisine-filter').addEventListener('change', applyFilters);
document.getElementById('rating-filter').addEventListener('change', applyFilters);
document.getElementById('location-btn').addEventListener('click', requestLocation);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
document.getElementById('sort-select')?.addEventListener('change', e => { activeSort=e.target.value; applyFilters(); });

document.getElementById('price-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-price]'); if (!chip) return;
  document.querySelectorAll('[data-price]').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active'); activePrice=chip.dataset.price; applyFilters();
});
document.getElementById('distance-chips').addEventListener('click', e => {
  const chip = e.target.closest('[data-km]'); if (!chip) return;
  document.querySelectorAll('[data-km]').forEach(c=>c.classList.remove('active'));
  chip.classList.add('active'); activeDistanceKm=chip.dataset.km?parseFloat(chip.dataset.km):null; applyFilters();
});

document.getElementById('open-now-chip')?.addEventListener('click', e => {
  showOnlyOpen = !showOnlyOpen;
  e.currentTarget.classList.toggle('active', showOnlyOpen);
  applyFilters();
});
document.getElementById('favorites-chip')?.addEventListener('click', e => {
  showOnlyFav = !showOnlyFav;
  e.currentTarget.classList.toggle('active', showOnlyFav);
  applyFilters();
});

// Lang dropdown
document.getElementById('lang-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('lang-dropdown')?.classList.toggle('open');
});
document.getElementById('lang-dropdown')?.addEventListener('click', e => {
  const btn = e.target.closest('[data-code]'); if (!btn) return;
  setLang(btn.dataset.code);
  renderLangDropdown();
  applyI18n();
  document.getElementById('lang-dropdown').classList.remove('open');
});
document.addEventListener('click', () => document.getElementById('lang-dropdown')?.classList.remove('open'));

// Back to top
const btt = document.getElementById('back-to-top');
window.addEventListener('scroll', () => {
  btt?.classList.toggle('visible', window.scrollY > 400);
}, {passive: true});
btt?.addEventListener('click', () => window.scrollTo({top:0, behavior:'smooth'}));

// Meal time chips
document.getElementById('meal-time-bar')?.addEventListener('click', e => {
  const chip = e.target.closest('[data-meal]'); if (!chip) return;
  const key = chip.dataset.meal;
  activeMealTime = activeMealTime === key ? null : key;
  renderMealTimeBar();
  applyFilters();
});

// Map/Grid toggle
document.getElementById('view-toggle')?.addEventListener('click', () => {
  mapView = !mapView;
  document.getElementById('icon-map').style.display = mapView ? 'none' : 'block';
  document.getElementById('icon-grid').style.display = mapView ? 'block' : 'none';
  if (mapView) initMapView(filterRestaurants());
  else hideMapView();
});

// Location → weather
const origRequestLocation = requestLocation;
window._extendedRequestLocation = () => {
  if (!navigator.geolocation) return;
  const btn = document.getElementById('location-btn');
  btn.textContent = '…';
  navigator.geolocation.getCurrentPosition(pos => {
    userCoords = {lat: pos.coords.latitude, lng: pos.coords.longitude};
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg> ${t('loc_active')}`;
    btn.classList.add('active');
    document.getElementById('distance-chips').style.display = 'flex';
    loadWeather(pos.coords.latitude, pos.coords.longitude);
    applyFilters();
  }, () => { btn.textContent = t('loc_fail'); });
};
document.getElementById('location-btn').removeEventListener('click', requestLocation);
document.getElementById('location-btn').addEventListener('click', window._extendedRequestLocation);

// Init
initTheme();
initLang();
loadRestaurants();
