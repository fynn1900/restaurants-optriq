// Operator dashboard data – password gated. Aggregates reservations & ratings
// across all restaurants. Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, DASHBOARD_PASSWORD
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const PW     = process.env.DASHBOARD_PASSWORD || 'optriq2025';

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  try { return await res.json(); } catch { return []; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Server nicht konfiguriert' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  if ((body.password || '') !== PW) { res.status(401).json({ error: 'Falsches Passwort.' }); return; }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [restaurants, reservations, guests] = await Promise.all([
      sb('restaurants?select=name,slug,reservation_slug,city,google_rating,google_review_count,is_active'),
      sb('reservations?select=restaurant_id,date,status,guests'),
      sb('guests?select=id,created_at'),
    ]);

    const perRestaurant = (restaurants || []).map(r => {
      const rid = r.reservation_slug || r.slug;
      const all = (reservations || []).filter(x => x.restaurant_id === rid);
      const todayCount = all.filter(x => x.date === today && !['Abgesagt','Storniert','Abgeschlossen'].includes(x.status)).length;
      const totalGuests = all.reduce((s, x) => s + (x.guests || 0), 0);
      return {
        name: r.name, city: r.city, active: r.is_active,
        rating: r.google_rating, reviewCount: r.google_review_count,
        totalReservations: all.length, todayReservations: todayCount, totalGuests,
      };
    }).sort((a, b) => b.totalReservations - a.totalReservations);

    const totals = {
      restaurants: (restaurants || []).length,
      reservations: (reservations || []).length,
      todayReservations: perRestaurant.reduce((s, r) => s + r.todayReservations, 0),
      guests: (guests || []).length,
      avgRating: (() => {
        const rated = (restaurants || []).filter(r => r.google_rating);
        return rated.length ? (rated.reduce((s, r) => s + r.google_rating, 0) / rated.length).toFixed(2) : '–';
      })(),
    };

    res.status(200).json({ totals, perRestaurant });
  } catch (e) {
    res.status(500).json({ error: 'Serverfehler.' });
  }
};
