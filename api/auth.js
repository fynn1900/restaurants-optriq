// Serverless auth for guest accounts. Passwords are hashed with scrypt; the
// Supabase service-role key never leaves the server. Sessions are stateless
// HMAC-signed tokens. Env vars required (set in Vercel):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, AUTH_SECRET
const crypto = require('node:crypto');

const SB_URL  = process.env.SUPABASE_URL;
const SB_KEY  = process.env.SUPABASE_SERVICE_KEY;
const SECRET  = process.env.AUTH_SECRET || 'dev-insecure-secret-change-me';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function signToken(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 30*24*3600*1000 })).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

async function sb(path, options = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
    ...options,
  });
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text) }; } catch { return { ok: res.ok, data: text }; }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Server nicht konfiguriert' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { action } = body || {};

  try {
    if (action === 'signup') {
      const { name, email, password } = body;
      if (!name || !email || !password || password.length < 6)
        return res.status(400).json({ error: 'Name, E-Mail und Passwort (min. 6 Zeichen) erforderlich.' });
      const mail = String(email).toLowerCase().trim();
      const { data: existing } = await sb(`guests?email=eq.${encodeURIComponent(mail)}&select=id`);
      if (Array.isArray(existing) && existing.length) return res.status(409).json({ error: 'E-Mail bereits registriert.' });
      const { ok, data } = await sb('guests', { method: 'POST', body: JSON.stringify({ name, email: mail, password_hash: hashPassword(password) }) });
      if (!ok) return res.status(500).json({ error: 'Registrierung fehlgeschlagen.' });
      const g = data[0];
      return res.status(200).json({ token: signToken({ id: g.id, name: g.name, email: g.email }), user: { id: g.id, name: g.name, email: g.email, favorites: g.favorites || [] } });
    }

    if (action === 'login') {
      const { email, password } = body;
      const mail = String(email || '').toLowerCase().trim();
      const { data } = await sb(`guests?email=eq.${encodeURIComponent(mail)}&select=*`);
      const g = Array.isArray(data) ? data[0] : null;
      if (!g || !verifyPassword(password || '', g.password_hash)) return res.status(401).json({ error: 'E-Mail oder Passwort falsch.' });
      await sb(`guests?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify({ last_login: new Date().toISOString() }) });
      return res.status(200).json({ token: signToken({ id: g.id, name: g.name, email: g.email }), user: { id: g.id, name: g.name, email: g.email, favorites: g.favorites || [] } });
    }

    if (action === 'me') {
      const session = verifyToken(body.token);
      if (!session) return res.status(401).json({ error: 'Nicht eingeloggt.' });
      const { data } = await sb(`guests?id=eq.${session.id}&select=id,name,email,favorites`);
      const g = Array.isArray(data) ? data[0] : null;
      if (!g) return res.status(401).json({ error: 'Account nicht gefunden.' });
      return res.status(200).json({ user: g });
    }

    if (action === 'favorites') {
      const session = verifyToken(body.token);
      if (!session) return res.status(401).json({ error: 'Nicht eingeloggt.' });
      await sb(`guests?id=eq.${session.id}`, { method: 'PATCH', body: JSON.stringify({ favorites: body.favorites || [] }) });
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unbekannte Aktion.' });
  } catch (e) {
    return res.status(500).json({ error: 'Serverfehler.' });
  }
};
