// Live availability engine for the discovery portal.
// Faithfully mirrors the algorithm in optriq-booking/js/form.js so the slots
// shown here match what the real booking form will accept.
import { supabaseFetch } from './supabase.js';

const OUTDOOR_RE = /au[sß]en|drau[sß]{1,2}en|outside|outdoor|terrasse|garten/i;

const toMins = t => { const [h,m] = String(t).slice(0,5).split(':').map(Number); return h*60 + (m||0); };
const minsToTime = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const todayStr = () => new Date().toISOString().slice(0,10);

// Load everything needed to compute availability for one restaurant.
export async function loadAvailabilityData(cfgSlug) {
  const [forms, tables, shifts, ohWeekly, ohExc] = await Promise.all([
    supabaseFetch(`booking_forms?slug=eq.${encodeURIComponent(cfgSlug)}&limit=1`),
    supabaseFetch(`tables?restaurant_id=eq.${cfgSlug}&select=id,capacity,location,is_hochtisch,is_barrier_free,is_summer_only,active,is_offline`),
    supabaseFetch(`shift_times?restaurant_id=eq.${cfgSlug}&select=start_time,end_time,is_summer_only,last_arrival_time`),
    supabaseFetch(`opening_hours_weekly?restaurant_id=eq.${cfgSlug}`),
    supabaseFetch(`opening_hours_exceptions?restaurant_id=eq.${cfgSlug}&date=gte.${todayStr()}`),
  ]);
  return { cfg: forms[0] || null, tables: tables || [], shifts: shifts || [], ohWeekly: ohWeekly || [], ohExc: ohExc || [] };
}

function getOhForDate(data, dateStr) {
  const exc = data.ohExc.find(e => e.date === dateStr);
  if (exc) return { isClosed: exc.is_closed, open: exc.open_time?.slice(0,5)||null, close: exc.close_time?.slice(0,5)||null };
  const dow = new Date(dateStr + 'T12:00:00').getDay();
  const w = data.ohWeekly.find(r => r.day_of_week === dow);
  if (!w || w.is_closed) return { isClosed: true };
  return { isClosed: false, open: w.open_time?.slice(0,5)||null, close: w.close_time?.slice(0,5)||null };
}

function getTablePool(data, location) {
  const cfg = data.cfg;
  const base = data.tables.filter(t =>
    t.active !== false && t.is_offline !== true && (cfg.summer_mode || !t.is_summer_only));
  if (location === 'draussen') return cfg.summer_mode ? base.filter(t => OUTDOOR_RE.test(t.location||'')) : [];
  if (location === 'drinnen')  return base.filter(t => !OUTDOOR_RE.test(t.location||''));
  return base;
}

// Greedy table assignment → largest free table = maxFit
function calcTableAvailability(data, location, bookings) {
  const pool = getTablePool(data, location);
  if (!pool.length) { const m = data.cfg.max_persons || 0; return { totalFreeSeats: m, maxFit: m }; }

  const hasAssign = bookings.some(b => b.assigned_table_id);
  if (hasAssign) {
    const taken = new Set(bookings.map(b => b.assigned_table_id ? String(b.assigned_table_id) : null).filter(Boolean));
    const free = pool.filter(t => !taken.has(String(t.id)));
    return { totalFreeSeats: free.reduce((s,t)=>s+(t.capacity||2),0), maxFit: free.length?Math.max(...free.map(t=>t.capacity||2)):0 };
  }
  const slots = pool.map(t => ({ cap: t.capacity||2, taken:false }))
    .sort((a,b) => a.cap - b.cap);
  [...bookings].sort((a,b)=>(b.guests||1)-(a.guests||1)).forEach(bk => {
    const g = bk.guests||1;
    const idx = slots.findIndex(t => !t.taken && t.cap >= g);
    if (idx >= 0) slots[idx].taken = true;
    else { const fb = [...slots].map((t,i)=>({...t,i})).filter(t=>!t.taken).at(-1); if (fb) slots[fb.i].taken = true; }
  });
  const free = slots.filter(t=>!t.taken);
  return { totalFreeSeats: free.reduce((s,t)=>s+t.cap,0), maxFit: free.length?Math.max(...free.map(t=>t.cap)):0 };
}

// Build raw shift windows for a date (mirrors loadShifts)
function buildShiftWindows(data, dateStr) {
  const cfg = data.cfg;
  const oh = getOhForDate(data, dateStr);
  if (oh.isClosed) return [];

  if (!cfg.shifts_enabled) {
    const dur = cfg.booking_duration, interval = cfg.booking_interval || dur;
    if (dur > 0 && interval > 0) {
      const openM = toMins(oh.open||'12:00'), closeM = toMins(oh.close||'22:00');
      const limitM = cfg.last_booking_before_close ? closeM - cfg.last_booking_before_close
        : cfg.last_booking_time ? toMins(cfg.last_booking_time.slice(0,5)) : closeM - dur;
      const out = [];
      for (let m = openM; m <= limitM; m += interval) out.push({ start: minsToTime(m), end: minsToTime(Math.min(m+dur, closeM)) });
      if (out.length) return out;
    }
    return [{ start: oh.open||'12:00', end: oh.close||'22:00' }];
  }
  // shift mode
  return data.shifts
    .filter(s => cfg.summer_mode || !s.is_summer_only)
    .map(s => ({ start: s.start_time.slice(0,5), end: s.end_time.slice(0,5), lastArrival: s.last_arrival_time?.slice(0,5)||null }));
}

// Main entry: returns array of { start, end, label, available, maxFit, totalFreeSeats, pct }
export function computeSlots(data, dateStr, guests, location = 'egal', reservations = []) {
  const cfg = data.cfg;
  if (!cfg) return [];
  const windows = buildShiftWindows(data, dateStr);
  if (!windows.length) return [];

  // lead-time filter
  const nowMs = Date.now();
  const leadMs = (cfg.min_lead_hours||0) * 3600000;
  const valid = windows.filter(s => new Date(dateStr+'T'+s.start+':00').getTime() - nowMs > leadMs);

  const bkDur = cfg.booking_duration || null;
  return valid.map(s => {
    const startM = toMins(s.start), endM = toMins(s.end), slotDur = endM - startM;
    const overlap = reservations.filter(r => {
      if (!r.time) return true;
      const rs = toMins(r.time), re = rs + (bkDur || slotDur);
      return rs < endM && re > startM;
    });
    const { totalFreeSeats, maxFit } = calcTableAvailability(data, location, overlap);
    const totalCap = totalFreeSeats + overlap.reduce((s2,r)=>s2+(r.guests||0),0);
    const pct = totalCap > 0 ? 1 - totalFreeSeats/totalCap : 1;
    return { start: s.start, end: s.end, label: s.label||'', available: maxFit >= guests, maxFit, totalFreeSeats, pct };
  });
}

// Fetch the non-PII reservation list for a date (same columns the form uses)
export async function fetchReservations(cfgSlug, dateStr) {
  try {
    return await supabaseFetch(`reservations?restaurant_id=eq.${cfgSlug}&date=eq.${dateStr}&status=not.in.(Abgesagt,Abgeschlossen,Storniert)&select=time,guests,status,assigned_table_id`);
  } catch { return []; }
}

export const _util = { toMins, minsToTime, todayStr, getOhForDate };
