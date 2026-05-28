/**
 * Enriches restaurants table from booking_forms using Google Places API.
 * Run: GOOGLE_PLACES_KEY=xxx node scripts/enrich-restaurants.mjs
 */

const SUPABASE_URL = 'https://rmogxnkbzxvktillhtfg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb2d4bmtienh2a3RpbGxodGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjgwNzI3NiwiZXhwIjoyMDg4MzgzMjc2fQ.fToQqBAZ8XA7Ufj1Zz_tkurKXfngHSw4JAS9-RJmLm8';
const PLACES_KEY = process.env.GOOGLE_PLACES_KEY;

if (!PLACES_KEY) {
  console.error('❌  Kein GOOGLE_PLACES_KEY gesetzt. Abbruch.');
  process.exit(1);
}

const SKIP_SLUGS = ['test'];

async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
    ...options,
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function placesTextSearch(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=de&key=${PLACES_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results?.[0] ?? null;
}

async function placeDetails(placeId) {
  const fields = 'place_id,name,formatted_address,website,formatted_phone_number,rating,user_ratings_total,photos,types,price_level,geometry';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=de&key=${PLACES_KEY}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result ?? null;
}

function photoUrl(photoRef, maxWidth = 1200) {
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${PLACES_KEY}`;
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function priceLevel(level) {
  if (level === 1) return '€';
  if (level === 2) return '€€';
  if (level === 3 || level === 4) return '€€€';
  return null;
}

function guessCuisine(types = []) {
  const map = {
    restaurant: null,
    food: null,
    meal_takeaway: null,
    cafe: 'Café',
    bakery: 'Bäckerei',
    bar: 'Bar',
    meal_delivery: null,
    japanese_restaurant: 'Japanisch',
    chinese_restaurant: 'Chinesisch',
    italian_restaurant: 'Italienisch',
    french_restaurant: 'Französisch',
    mexican_restaurant: 'Mexikanisch',
    indian_restaurant: 'Indisch',
    thai_restaurant: 'Thailändisch',
    seafood_restaurant: 'Meeresfrüchte',
    steak_house: 'Steakhaus',
    pizza_restaurant: 'Pizzeria',
    sushi_restaurant: 'Sushi',
  };
  for (const t of types) {
    if (map[t]) return map[t];
  }
  return null;
}

function extractCity(address) {
  if (!address) return null;
  const parts = address.split(',').map(p => p.trim());
  // German addresses: "Street Nr, PLZ Stadt, Land" → second-to-last usually
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2];
    return cityPart.replace(/^\d{4,6}\s*/, '').trim();
  }
  return null;
}

async function run() {
  console.log('📋  Lade booking_forms aus Supabase…');
  const forms = await sb('booking_forms?select=id,name,slug,logo_url,banner_url');

  const toProcess = forms.filter(f => !SKIP_SLUGS.includes(f.slug) && f.name && f.name.length > 3);
  console.log(`✅  ${toProcess.length} Restaurants gefunden:\n${toProcess.map(f => `   • ${f.name}`).join('\n')}\n`);

  for (const form of toProcess) {
    console.log(`🔍  Suche Google Places: "${form.name}"…`);

    const searchResult = await placesTextSearch(form.name);
    if (!searchResult) {
      console.warn(`   ⚠️  Nicht gefunden, überspringe.`);
      continue;
    }

    console.log(`   → Gefunden: ${searchResult.name} (${searchResult.formatted_address})`);

    const details = await placeDetails(searchResult.place_id);
    if (!details) {
      console.warn(`   ⚠️  Details nicht abrufbar, überspringe.`);
      continue;
    }

    const photos = (details.photos || []).slice(0, 8).map(p => photoUrl(p.photo_reference));
    const coverPhoto = photos[0] ?? form.banner_url ?? null;
    const galleryPhotos = photos.slice(1);
    const city = extractCity(details.formatted_address);
    const slug = slugify(form.slug || form.name);

    const record = {
      booking_form_id: form.id,
      name: details.name || form.name,
      slug,
      city,
      address: details.formatted_address,
      phone: details.formatted_phone_number ?? null,
      website_url: details.website ?? null,
      google_rating: details.rating ?? null,
      google_review_count: details.user_ratings_total ?? null,
      google_place_id: details.place_id,
      cover_image_url: coverPhoto,
      logo_url: form.logo_url ?? null,
      gallery_urls: galleryPhotos.length > 0 ? galleryPhotos : null,
      price_range: priceLevel(details.price_level),
      cuisine_type: guessCuisine(details.types || []),
      is_active: true,
    };

    console.log(`   📝  Speichere: ${record.name} | ${city} | ⭐ ${record.google_rating} (${record.google_review_count} Bewertungen)`);

    const existing = await sb(`restaurants?slug=eq.${slug}&select=id`);
    if (existing?.length > 0) {
      await sb(`restaurants?slug=eq.${slug}`, {
        method: 'PATCH',
        body: JSON.stringify(record),
      });
      console.log(`   ✅  Aktualisiert.`);
    } else {
      await sb('restaurants', {
        method: 'POST',
        body: JSON.stringify(record),
      });
      console.log(`   ✅  Neu angelegt.`);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n🎉  Fertig! Alle Restaurants in Supabase gespeichert.');
  console.log('    → https://restaurants-optriq.vercel.app');
}

run().catch(err => {
  console.error('❌  Fehler:', err.message);
  process.exit(1);
});
