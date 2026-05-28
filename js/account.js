// Guest account: login/signup modal + session. Talks to /api/auth (serverless).
const TOKEN_KEY = 'optriq_token';
const USER_KEY  = 'optriq_user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function getUser()  { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
function setSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function logout() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); renderAccountButton(); }

async function api(action, payload) {
  const res = await fetch('/api/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action, ...payload }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Fehler');
  return data;
}

export async function syncFavorites(favArray) {
  const token = getToken();
  if (!token) return;
  try { await api('favorites', { token, favorites: favArray }); } catch {}
}

// ─── UI ───────────────────────────────────────────────────────────
export function initAccount(onLogin) {
  injectModal();
  renderAccountButton();
  window._openAuth = openModal;

  const form = document.getElementById('auth-form');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const mode = form.dataset.mode || 'login';
    const err  = document.getElementById('auth-err');
    err.style.display = 'none';
    const btn = document.getElementById('auth-submit'); btn.disabled = true; btn.textContent = 'Bitte warten…';
    try {
      const payload = mode === 'signup'
        ? { name: document.getElementById('auth-name').value, email: document.getElementById('auth-email').value, password: document.getElementById('auth-pw').value }
        : { email: document.getElementById('auth-email').value, password: document.getElementById('auth-pw').value };
      const data = await api(mode, payload);
      setSession(data.token, data.user);
      closeModal(); renderAccountButton();
      if (onLogin) onLogin(data.user);
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block';
    } finally { btn.disabled = false; btn.textContent = (form.dataset.mode==='signup'?'Registrieren':'Anmelden'); }
  });

  document.getElementById('auth-switch')?.addEventListener('click', () => setMode(form.dataset.mode === 'login' ? 'signup' : 'login'));
  document.getElementById('auth-close')?.addEventListener('click', closeModal);
  document.getElementById('auth-modal')?.addEventListener('click', e => { if (e.target.id === 'auth-modal') closeModal(); });
}

function setMode(mode) {
  const form = document.getElementById('auth-form');
  form.dataset.mode = mode;
  document.getElementById('auth-title').textContent = mode === 'signup' ? 'Konto erstellen' : 'Willkommen zurück';
  document.getElementById('auth-name-wrap').style.display = mode === 'signup' ? 'block' : 'none';
  document.getElementById('auth-submit').textContent = mode === 'signup' ? 'Registrieren' : 'Anmelden';
  document.getElementById('auth-switch').textContent = mode === 'signup' ? 'Schon ein Konto? Anmelden' : 'Noch kein Konto? Registrieren';
  document.getElementById('auth-err').style.display = 'none';
}
function openModal() { document.getElementById('auth-modal')?.classList.add('open'); }
function closeModal() { document.getElementById('auth-modal')?.classList.remove('open'); }

function renderAccountButton() {
  const slot = document.getElementById('account-slot');
  if (!slot) return;
  const user = getUser();
  if (user) {
    slot.innerHTML = `<button class="account-btn" id="account-menu-btn" title="${user.email}">
      <span class="account-avatar">${(user.name||'?')[0].toUpperCase()}</span>
      <span class="account-name">${(user.name||'').split(' ')[0]}</span>
    </button>`;
    document.getElementById('account-menu-btn').addEventListener('click', () => {
      if (confirm(`Eingeloggt als ${user.name}.\nAbmelden?`)) logout();
    });
  } else {
    slot.innerHTML = `<button class="account-btn login" onclick="window._openAuth()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
      Anmelden
    </button>`;
  }
}

function injectModal() {
  if (document.getElementById('auth-modal')) return;
  const div = document.createElement('div');
  div.id = 'auth-modal'; div.className = 'auth-modal';
  div.innerHTML = `
    <div class="auth-card">
      <button class="auth-close" id="auth-close" aria-label="Schließen">×</button>
      <h2 id="auth-title">Willkommen zurück</h2>
      <p class="auth-sub">Favoriten geräteübergreifend speichern & schneller reservieren.</p>
      <form id="auth-form" data-mode="login">
        <div id="auth-name-wrap" style="display:none">
          <input id="auth-name" type="text" placeholder="Dein Name" autocomplete="name">
        </div>
        <input id="auth-email" type="email" placeholder="E-Mail" autocomplete="email" required>
        <input id="auth-pw" type="password" placeholder="Passwort" autocomplete="current-password" required>
        <div class="auth-err" id="auth-err"></div>
        <button type="submit" class="btn-primary" id="auth-submit" style="width:100%">Anmelden</button>
      </form>
      <button class="auth-switch" id="auth-switch">Noch kein Konto? Registrieren</button>
    </div>`;
  document.body.appendChild(div);
}
