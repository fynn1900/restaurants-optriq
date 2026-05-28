/**
 * Enriches restaurants table from booking_forms using Nominatim (OpenStreetMap).
 * Free, no API key needed.
 * Run: node scripts/enrich-restaurants.mjs
 */

const SUPABASE_URL = 'https://rmogxnkbzxvktillhtfg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJtb2d4bmtienh2a3RpbGxodGZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjgwNzI3NiwiZXhwIjoyMDg4MzgzMjc2fQ.fToQqBAZ8XA7Ufj1Zz_tkurKXfngHSw4JAS9-RJmLm8';
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

async function nominatimSearch(query) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&countrycodes=de,at,ch`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'optriq-restaurants/1.0 (fynn@optriq-automations.org)' }
  });
  const data = await res.json();
  return data[0] ?? null;
}

function slugify(str) {
  return str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function run() {
  console.log('📋  Lade booking_forms aus Supabase…');
  const forms = await sb('booking_forms?select=id,name,slug,logo_url,banner_url');
  const toProcess = forms.filter(f => !SKIP_SLUGS.includes(f.slug) && f.name?.length > 3);

  console.log(`✅  ${toProcess.length} Restaurants:\n${toProcess.map(f => `   • ${f.name}`).join('\n')}\n`);

  for (const form of toProcess) {
    console.log(`🔍  Nominatim: "${form.name}"…`);

    const result = await nominatimSearch(form.name);
    if (!result) {
      console.warn(`   ⚠️  Nicht gefunden. Wird ohne Koordinaten gespeichert.`);
    } else {
      console.log(`   → ${result.display_name}`);
      console.log(`   → Koordinaten: ${result.lat}, ${result.lon}`);
    }

    const addr = result?.address ?? {};
    const city = addr.city || addr.town || addr.village || addr.municipality || null;
    const slug = slugify(form.slug || form.name);

    const record = {
      booking_form_id: form.id,
      name: form.name,
      slug,
      city,
      address: result?.display_name?.split(',').slice(0, 3).join(',').trim() ?? null,
      lat: result ? parseFloat(result.lat) : null,
      lng: result ? parseFloat(result.lon) : null,
      logo_url: form.logo_url ?? null,
      cover_image_url: form.banner_url ?? null,
      is_active: true,
    };

    const existing = await sb(`restaurants?slug=eq.${slug}&select=id`);
    if (existing?.length > 0) {
      await sb(`restaurants?slug=eq.${slug}`, {
        method: 'PATCH',
        body: JSON.stringify(record),
      });
      console.log(`   ✅  Koordinaten + Adresse aktualisiert.`);
    } else {
      await sb('restaurants', {
        method: 'POST',
        body: JSON.stringify(record),
      });
      console.log(`   ✅  Neu angelegt.`);
    }

    // Nominatim rate limit: 1 req/s
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log('\n🎉  Fertig!');
  console.log('    Tipp: Rating, Website, Fotos & Beschreibung direkt in Supabase ergänzen.');
  console.log('    → https://supabase.com/dashboard/project/rmogxnkbzxvktillhtfg/editor');
}

run().catch(err => {
  console.error('❌  Fehler:', err.message);
  process.exit(1);
});
