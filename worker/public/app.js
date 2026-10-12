'use strict';
// FinTrack · app (vanilla JS). Datos: /api/* del Worker. Cotizaciones: DolarApi.
// Estructura: utilidades → íconos → datos → cálculos → juego → router → pantallas → acciones → arranque.

const APP_VERSION = 'V2.0';

/* ═══ Utilidades ═══════════════════════════════════════════ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TZ = 'America/Argentina/Buenos_Aires';
const _day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });
const _hm = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const _h = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
const dayOf = d => _day.format(new Date(d));
const today = () => dayOf(Date.now());
const D = day => new Date(day + 'T12:00:00Z');
const addDays = (day, n) => { const d = D(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diffDays = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const dow = day => D(day).getUTCDay();
const weekStart = day => addDays(day, -((dow(day) + 6) % 7));
const ymOf = day => day.slice(0, 7);
const addMonths = (m, n) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + n; while (mo > 12) { mo -= 12; y++; } while (mo < 1) { mo += 12; y--; } return `${y}-${String(mo).padStart(2, '0')}`; };
const dim = m => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MES3 = MES.map(m => m.slice(0, 3).toUpperCase());
const DIA3 = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const monthName = m => MES[+m.slice(5, 7) - 1];
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const hhmm = ts => _hm.format(new Date(ts));
const hourNow = () => +_h.format(new Date());
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const median = a => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PREFIX = { ARS: '$', USD: 'US$ ', USDC: 'USDC ' };
function money(n, cur = 'ARS', o = {}) {
  const a = Math.abs(n || 0);
  const cents = Math.round(a * 100) % 100 !== 0;
  const dec = o.dec === false ? false : o.dec === true ? true : cents && (cur !== 'ARS' || a < 1e7);
  const sign = n < 0 ? '−' : o.sign && n > 0 ? '+' : '';
  return sign + PREFIX[cur] + (dec ? nf2.format(a) : nf0.format(Math.round(a)));
}
const m0 = (n, cur = 'ARS') => money(n, cur, { dec: false });
// Corto para espacios chicos: millones abreviados ($2,55 M)
const mS = n => (Math.abs(n) >= 1e6 ? `${n < 0 ? '−' : ''}$${nf2.format(Math.abs(n) / 1e6)} M` : m0(n));
function parseAmt(s) {
  s = String(s || '').trim().replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s);
}
const vib = (p = 10) => { try { navigator.vibrate?.(p); } catch { /* sin vibración */ } };
const LS = {
  get(k, f) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio */ } },
};
function normalizeText(...parts) {
  return ' ' + parts.filter(Boolean).join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/(payu|merpago|mercpago|mp)\*(ar\*)?/g, ' ').replace(/[*_\-./]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
}
const mkey = m => normalizeText(m.counterparty || m.description || '').replace(/\d+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');

/* ═══ Íconos (SVG propios, trazo 1.5, puntas cuadradas) ════ */
const circ = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const P = {
  home: 'M4 10.5 12 4l8 6.5V20h-5.5v-6h-5v6H4z', list: 'M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5',
  plus: 'M12 5v14M5 12h14', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', wallet: 'M3 7h18v13H3zM3 7l2-3h14l2 3M16 13.5h2',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4', back: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
  swap: 'M5 8h14l-3-3M19 16H5l3 3', cal: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  cart: 'M3 4h2l2.5 11h11L21 7H6.2M9 20h.5M17 20h.5', bike: `${circ(6, 16, 3)}${circ(18, 16, 3)}M6 16l4-7h5l3 7M13 9l-1.5-4H9`,
  glass: 'M7 3h10l-1 7a4 4 0 0 1-8 0zM12 14v6M8 21h8', car: 'M4 16v-5l2-5h12l2 5v5zM4 16v3h3v-3M17 16v3h3v-3M7 12.5h.5M16.5 12.5h.5',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z', repeat: 'M4 9a7 7 0 0 1 12-4l3 3M20 15a7 7 0 0 1-12 4l-3-3M19 4v4h-4M5 20v-4h4',
  house: 'M3 11l9-7 9 7M5 9.5V20h14V9.5', card: 'M3 6h18v12H3zM3 10h18M7 15h4',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z', bag: 'M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2',
  shirt: 'M8 4 3 7l2 4 2-1v10h10V10l2 1 2-4-5-3a4 4 0 0 1-8 0z', book: 'M4 5h7v15H4zM13 5h7v15h-7',
  game: 'M6 9h12a3 3 0 0 1 3 3v3a2 2 0 0 1-3.5 1.3L16 15H8l-1.5 1.3A2 2 0 0 1 3 15v-3a3 3 0 0 1 3-3zM8 11v3M6.5 12.5h3M15.5 12h.5M17.5 13.5h.5',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', gift: 'M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0',
  arrows: 'M7 7h12l-3-3M17 17H5l3 3', dots: 'M6 12h.5M12 12h.5M18 12h.5', trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  coin: `${circ(12, 12, 9)}M9.5 9.5c0-1.5 5-1.5 5 0s-5 1.5-5 3 5 1.5 5 0M12 7v10`,
  bank: 'M3 21h18M4 10h16M12 3 3 8h18zM6 10v8M10 10v8M14 10v8M18 10v8',
  star: 'M12 3l2.6 5.8 6.4.6-4.8 4.3 1.4 6.3L12 16.8 6.4 20l1.4-6.3L3 9.4l6.4-.6z', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6 6 18',
  flame: 'M12 21c-4 0-6-3-6-6 0-4 4-6 4-10 3 2 6 5 6 9 1-1 1.5-2 1.5-3 1.5 1.5 2.5 3.5 2.5 5 0 3-3 5-8 5z',
  target: `${circ(12, 12, 9)}${circ(12, 12, 5)}${circ(12, 12, 1)}`, sync: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  gear: `${circ(12, 12, 3)}M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1`,
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4', trophy: 'M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 21h8',
  search: `${circ(11, 11, 7)}M16 16l5 5`, trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13', down: 'M12 4v12M6 11l6 6 6-6M4 20h16',
  up: 'M12 20V8M6 13l6-6 6 6M4 4h16', tax: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3', brief: 'M4 8h16v12H4zM9 8V5h6v3M4 13h16',
  percent: `M5 19 19 5${circ(7, 7, 2)}${circ(17, 17, 2)}`, eye: `M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z${circ(12, 12, 3)}`,
  ret: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', ban: `${circ(12, 12, 9)}M5.6 5.6l12.8 12.8`,
};
const ic = (k, s = 20, w = 1.5) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="square" aria-hidden="true"><path d="${P[k] || P.dots}"/></svg>`;
const LOGO = (s = 30) => `<svg width="${s}" height="${s}" viewBox="0 0 30 30" fill="none" role="img" aria-label="FinTrack"><rect width="30" height="30" rx="3" fill="#4157FF"/><path d="M9 23V7h12M9 14.5h8" stroke="#EEEAE2" stroke-width="2.6" stroke-linecap="square"/><path d="M13 23l5-5 2.5 2.5L25 15" stroke="#EEEAE2" stroke-width="1.6" stroke-linecap="square"/></svg>`;

/* ═══ Categorías ═══════════════════════════════════════════ */
// Lo que ve Rodrigo: 10 categorías claras. El Worker clasifica más fino (delivery, salidas, ropa...)
// y acá se agrupan. Al elegir un grupo se guarda su id "def".
const GROUPS = {
  gasto: [
    { id: 'super', name: 'Súper', icon: 'cart', ids: ['super'], ess: true },
    { id: 'salidas', name: 'Comida afuera', icon: 'glass', ids: ['salidas', 'delivery'], ess: false },
    { id: 'transporte', name: 'Transporte', icon: 'car', ids: ['transporte'], ess: true },
    { id: 'casa', name: 'Casa y servicios', icon: 'house', ids: ['hogar', 'servicios', 'impuestos'], ess: true, def: 'servicios' },
    { id: 'suscripciones', name: 'Suscripciones', icon: 'repeat', ids: ['suscripciones'], ess: false },
    { id: 'salud', name: 'Salud', icon: 'heart', ids: ['salud', 'educacion'], ess: true },
    { id: 'compras', name: 'Compras y gustos', icon: 'bag', ids: ['compras', 'ropa', 'entretenimiento', 'regalos'], ess: false },
    { id: 'tarjeta', name: 'Tarjeta', icon: 'card', ids: ['tarjeta'], ess: true },
    { id: 'personas', name: 'A personas', icon: 'arrows', ids: ['transferencias'], ess: true, def: 'transferencias' },
    { id: 'otros', name: 'Otros', icon: 'dots', ids: ['otros'], ess: true },
  ],
  ingreso: [
    { id: 'sueldo', name: 'Sueldo', icon: 'brief', ids: ['sueldo'] },
    { id: 'extra', name: 'Ingresos extra', icon: 'coin', ids: ['extra'] },
    { id: 'rendimientos', name: 'Rendimientos', icon: 'percent', ids: ['rendimientos'] },
    { id: 'recibidas', name: 'De otras personas', icon: 'arrows', ids: ['recibidas'] },
    { id: 'otros_ingreso', name: 'Otros', icon: 'dots', ids: ['otros_ingreso'] },
  ],
};
const G_OF = {};
for (const k of ['gasto', 'ingreso']) for (const g of GROUPS[k]) { g.def ||= g.ids[0]; G_OF[g.id] = g; for (const id of g.ids) G_OF[id] = g; }
const CATS = () => GROUPS;
const gid = id => G_OF[id]?.id || 'otros';
const inKind = (id, kind) => GROUPS[kind].includes(G_OF[id]);
const catName = id => (id === 'propias' ? 'Desde tus cuentas' : G_OF[id]?.name || 'Sin categoría');
const catEssential = id => G_OF[id]?.ess ?? true;
const catIcon = id => G_OF[id]?.icon || 'dots';
// Sugerencias al cargar a mano (subconjunto de las reglas de fábrica del Worker)
const SUGGEST = [['delivery', 'pedidosya rappi delivery'], ['transporte', 'uber cabify didi sube nafta ypf shell axion peaje taxi'], ['super', 'super carrefour coto dia jumbo disco chino almacen verduleria kiosco'], ['salidas', 'bar cerveza resto birra cena almuerzo cafe pizza boliche cine'], ['servicios', 'luz gas agua internet celular edenor metrogas personal movistar claro'], ['suscripciones', 'netflix spotify disney hbo youtube icloud chatgpt'], ['salud', 'farmacia medico gimnasio gym osde'], ['hogar', 'alquiler expensas'], ['compras', 'mercadolibre amazon compra'], ['ropa', 'ropa zapatillas remera'], ['regalos', 'regalo cumple']];
function suggestCat(text, kind) {
  const t = normalizeText(text);
  if (t.trim().length < 3) return null;
  const rule = (S.data?.rules || []).find(r => t.includes(' ' + normalizeText(r.pattern).trim()) && (r.kind || 'gasto') === kind);
  if (rule?.category) return rule.category;
  if (kind === 'ingreso') return /binance|usdc|cliente|freelance|extra/.test(t) ? 'extra' : /sueldo|salario/.test(t) ? 'sueldo' : null;
  return SUGGEST.find(([, w]) => w.split(' ').some(x => t.includes(' ' + x)))?.[0] || null;
}

/* ═══ Datos ════════════════════════════════════════════════ */
const S = { data: null, fx: LS.get('ft2_fx', null), syncing: false, loaded: false };
let K = {}, MOVS = [], BYID = {}, CACHE = {};
const memo = (k, f) => (k in CACHE ? CACHE[k] : (CACHE[k] = f()));
const DEFAULT_POCKETS = [
  { id: 'mp', name: 'Mercado Pago', sub: 'Dinero disponible', currency: 'ARS', auto: true, rate: 19 },
  { id: 'reserva', name: 'Reserva Emergencias', sub: 'Mercado Pago', currency: 'ARS', auto: true, rate: 19 },
  { id: 'inv_mp', name: 'Inversiones MP', sub: 'Renta fija y variable', currency: 'ARS', invest: true },
  { id: 'usd_mp', name: 'Dólares MP', sub: 'Mercado Pago', currency: 'USD' },
  { id: 'binance', name: 'Binance', sub: 'USDC', currency: 'USDC', invest: true },
  { id: 'cocos', name: 'Cocos', sub: 'Broker', currency: 'USD', invest: true },
  { id: 'icbc', name: 'ICBC', sub: 'Banco · sueldo', currency: 'ARS' },
  { id: 'efectivo', name: 'Efectivo', sub: 'En mano', currency: 'ARS' },
];

let reloadGuard = false;
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin', method: opts.method || 'GET',
    headers: opts.body !== undefined ? { 'content-type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    // Sesión vencida (Cloudflare Access redirige al login): recargar una vez
    if (!reloadGuard && !sessionStorage.getItem('ft2_rl')) { reloadGuard = true; sessionStorage.setItem('ft2_rl', '1'); location.reload(); }
    throw new Error('Se cortó la sesión. Volvé a entrar.');
  }
  sessionStorage.removeItem('ft2_rl');
  if (res.status === 401) { location.reload(); throw new Error('Se cortó la sesión.'); }
  const d = await res.json();
  if (!res.ok || d.ok === false) throw new Error(d.error || `Error ${res.status}`);
  return d;
}

function setData(d) {
  S.data = d;
  K = d.kv || {};
  MOVS = (d.movements || []).slice().sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  BYID = Object.fromEntries(MOVS.map(m => [m.id, m]));
  CACHE = {};
}
async function loadState() {
  const d = await api('/api/state');
  setData(d);
  LS.set('ft2_cache', d);
  S.loaded = true;
}
function saveKv(key, value) {
  K[key] = value;
  S.data.kv = { ...S.data.kv, [key]: value };
  CACHE = {};
  LS.set('ft2_cache', S.data);
  return api(`/api/kv/${key}`, { method: 'PUT', body: value }).catch(e => toast(`No se guardó: ${e.message}`));
}
function upsertLocal(m) {
  const i = S.data.movements.findIndex(x => x.id === m.id);
  if (i >= 0) S.data.movements[i] = m; else S.data.movements.push(m);
  setData(S.data);
  LS.set('ft2_cache', S.data);
}

/* ═══ Cotizaciones (DolarApi) ══════════════════════════════ */
const RATES = { blue: 'Blue', bolsa: 'MEP', oficial: 'Oficial', contadoconliqui: 'CCL', cripto: 'Cripto' };
const rateKey = () => K.prefs?.rate || 'blue';
const rate = (k = rateKey()) => S.fx?.[k]?.venta || S.fx?.blue?.venta || 1450;
async function fetchFx(force) {
  if (!force && S.fx && Date.now() - S.fx.at < 10 * 60e3) return;
  try {
    const arr = await (await fetch('https://dolarapi.com/v1/dolares')).json();
    const fx = { at: Date.now() };
    for (const d of arr) fx[d.casa] = { compra: d.compra, venta: d.venta };
    S.fx = fx;
    LS.set('ft2_fx', fx);
    const hist = LS.get('ft2_fxh', {});
    hist[today()] = Object.fromEntries(Object.keys(RATES).map(k => [k, fx[k]?.venta]));
    LS.set('ft2_fxh', Object.fromEntries(Object.entries(hist).sort().slice(-10)));
    CACHE = {};
    softRender();
  } catch { /* sin red: queda la última cotización */ }
}
function fxDelta(k) {
  const hist = LS.get('ft2_fxh', {});
  const prev = Object.keys(hist).filter(d => d < today()).sort().pop();
  const a = hist[prev]?.[k], b = S.fx?.[k]?.venta;
  return a && b ? ((b - a) / a) * 100 : null;
}
const arsOf = m => (m.currency === 'ARS' ? m.amount : m.amount * rate());
const toArs = (n, cur) => (cur === 'ARS' ? n : n * rate());
const fromArs = (n, cur) => (cur === 'ARS' ? n : n / rate());

/* ═══ Cálculos ═════════════════════════════════════════════ */
const live = m => m.kind !== 'descartado';
const needsReview = m => m.review && !m.user_edited && live(m);
function title(m) {
  if (m.op === 'payout') return m.note || m.counterparty || 'Transferencia a otra cuenta';
  if (m.op === 'rendimiento') return m.description;
  let t = (m.counterparty || m.description || '').replace(/^(payu|merpago|mercpago|mp)\*(ar\*)?/i, '').replace(/\*/g, ' ').trim();
  if (t && (t === t.toLowerCase() || t === t.toUpperCase())) t = t.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  if (m.kind === 'interno' && m.amount > 0 && !m.counterparty) t = 'Ingreso desde tu banco';
  return t || (m.amount > 0 ? 'Ingreso' : 'Gasto');
}
function catOf(m) {
  if (m.kind === 'interno') return { icon: 'swap', name: 'Movimiento interno' };
  if (m.kind === 'reintegro') return { icon: 'ret', name: 'Devolución' };
  if (m.kind === 'descartado') return { icon: 'ban', name: 'Ignorado' };
  return { icon: catIcon(m.category), name: catName(m.category) };
}
// Entró = suma de lo positivo. Salió = suma de lo negativo. Diferencia = entró − salió.
// Cuenta todo lo que movió alguna de tus cuentas (los movimientos sin cuenta o cancelados no existen).
// Las categorías solo reparten lo que salió (o entró): no cambian ningún total.
const counts = m => live(m) && m.pocket != null;
function rangeStats(from, to) {
  return memo(`rs${from}${to}`, () => {
    let gas = 0, ing = 0, nec = 0, cap = 0;
    const cats = {}, inc = {};
    for (const x of MOVS) {
      if (x.day < from || x.day > to || !counts(x)) continue;
      const v = arsOf(x);
      if (v < 0) {
        const c = inKind(x.category, 'gasto') ? gid(x.category) : 'otros';
        gas -= v; cats[c] = (cats[c] || 0) - v;
        if (x.essential === 0) cap -= v; else nec -= v;
      } else {
        const c = inKind(x.category, 'ingreso') ? gid(x.category) : x.kind === 'interno' ? 'propias' : 'otros_ingreso';
        ing += v; inc[c] = (inc[c] || 0) + v;
      }
    }
    return { gas, ing, nec, cap, cats, inc, ahorro: ing - gas };
  });
}
const monthStats = m => rangeStats(`${m}-01`, `${m}-31`);
const firstDay = () => memo('fd', () => (MOVS.length ? MOVS[MOVS.length - 1].day : today()));
const closedMonths = () => memo('cm', () => { const out = []; for (let m = ymOf(firstDay()); m < ymOf(today()); m = addMonths(m, 1)) out.push(m); return out; });

// Gasto hormiga: capricho chico
const hormigaLimit = () => K.prefs?.hormiga ?? 10000;
const isHormiga = m => m.kind === 'gasto' && live(m) && m.essential === 0 && -arsOf(m) < hormigaLimit() && m.category !== 'transferencias';
const hormigaDays = () => memo('hd', () => new Set(MOVS.filter(isHormiga).map(m => m.day)));
function streak() {
  return memo('streak', () => {
    const hd = hormigaDays(), t = today(), f = firstDay();
    let cur = 0;
    for (let d = t; d >= f && !hd.has(d); d = addDays(d, -1)) cur++;
    let best = 0, run = 0;
    for (let d = f; d <= t; d = addDays(d, 1)) { run = hd.has(d) ? 0 : run + 1; best = Math.max(best, run); }
    return { cur, best };
  });
}

// Bolsillos: saldo = ancla + movimientos del bolsillo posteriores a la ancla
const pockets = () => memo('pk', () => (K.pockets?.length ? K.pockets : DEFAULT_POCKETS));
function pocketBal(p) {
  if (!p.anchor) return null;
  let b = p.anchor.amount;
  for (const m of MOVS) if (m.pocket === p.id && live(m) && m.ts > p.anchor.ts && m.currency === p.currency) b += m.amount;
  return b;
}
function patrimony() {
  return memo('pat', () => {
    let ars = 0, any = false;
    const by = { ARS: 0, USD: 0, USDC: 0 };
    for (const p of pockets()) {
      const b = pocketBal(p);
      if (b == null) continue;
      any = true;
      const v = toArs(b, p.currency);
      ars += v; by[p.currency] += v;
    }
    // Saldo de hace 30 días: se descuentan los movimientos de los bolsillos con saldo cargado
    const since = addDays(today(), -30);
    const anchored = new Set(pockets().filter(p => p.anchor).map(p => p.id));
    let flow = 0;
    for (const m of MOVS) if (anchored.has(m.pocket) && live(m) && m.day > since) flow += arsOf(m);
    const past = ars - flow;
    return { ars, usd: ars / rate(), any, by, change: past > 0 ? ((ars - past) / past) * 100 : null };
  });
}
function balanceSeries(days = 30) {
  const anchored = new Set(pockets().filter(p => p.anchor).map(p => p.id));
  const pat = patrimony();
  const t = today();
  const out = [];
  let bal = pat.ars;
  const byDay = {};
  for (const m of MOVS) if (anchored.has(m.pocket) && live(m)) byDay[m.day] = (byDay[m.day] || 0) + arsOf(m);
  for (let i = 0; i < days; i++) {
    const d = addDays(t, -i);
    out.unshift({ d, v: bal });
    bal -= byDay[d] || 0;
  }
  return out;
}

// Recurrentes: mismo comercio en 2 de los últimos 3 meses, monto ±20% y día ±6
function recurrents() {
  return memo('rec', () => {
    const since = addDays(today(), -100), hidden = new Set(K.prefs?.recur_hidden || []);
    const groups = {};
    for (const m of MOVS) {
      if (m.kind !== 'gasto' || !live(m) || m.day < since) continue;
      const key = m.op === 'payout' ? `p|${Math.round(-arsOf(m) / 1000)}` : `k|${mkey(m)}`;
      if (key === 'k|') continue;
      (groups[key] ||= []).push(m);
    }
    const out = [], thisM = ymOf(today());
    for (const [key, g0] of Object.entries(groups)) {
      if (hidden.has(key)) continue;
      const med = median(g0.map(m => -arsOf(m)));
      const g = g0.filter(m => Math.abs(-arsOf(m) - med) <= med * 0.2);
      const months = new Set(g.map(m => ymOf(m.day)));
      if (months.size < 2 || g.length > months.size * 2) continue;
      const doms = g.map(m => +m.day.slice(8));
      const dmed = Math.round(median(doms));
      if (Math.max(...doms) - Math.min(...doms) > 12 && doms.some(d => Math.abs(d - dmed) > 6)) continue;
      const charged = g.some(m => ymOf(m.day) === thisM);
      const nm = charged ? addMonths(thisM, 1) : thisM;
      let next = `${nm}-${String(Math.min(dmed, dim(nm))).padStart(2, '0')}`;
      if (next < today()) next = today();
      const last = g[0];
      out.push({ key, name: title(last), cat: last.category, amount: -arsOf(last), next, inDays: diffDays(today(), next), mp_type: last.mp_type, last });
    }
    return out.sort((a, b) => (a.next < b.next ? -1 : 1));
  });
}

// Pasamanos: entra y sale el mismo monto el mismo día (o el siguiente)
function passThroughs() {
  return memo('pass', () => {
    const out = [], used = new Set();
    const ins = MOVS.filter(m => m.kind === 'ingreso' && !m.user_edited && live(m) && m.amount >= 1000);
    for (const a of ins) {
      const b = MOVS.find(m => m.kind === 'gasto' && !m.user_edited && live(m) && !used.has(m.id) && Math.abs(-m.amount - a.amount) <= a.amount * 0.005 && Math.abs(diffDays(a.day, m.day)) <= 1);
      if (b) { used.add(b.id); out.push([a, b]); }
    }
    return out;
  });
}

// Segundo día hábil del mes (sin feriados móviles)
function secondBusinessDay(m) {
  const fixed = ['01-01', '05-01', '05-25', '07-09', '12-08', '12-25'];
  let n = 0;
  for (let d = `${m}-01`; ; d = addDays(d, 1)) {
    if (dow(d) !== 0 && dow(d) !== 6 && !fixed.includes(d.slice(5))) n++;
    if (n === 2) return d;
  }
}

function alerts() {
  return memo('alerts', () => {
    const out = [], t = today(), m = ymOf(t);
    const sync = K.sync || {};
    for (const e of sync.last_errors || []) out.push({ lvl: 'bad', text: `No pude sincronizar con Mercado Pago: ${e}`, a: 'go:ajustes' });
    const mp = pockets().find(p => p.id === 'mp');
    if (mp && !mp.anchor) out.push({ lvl: 'info', text: 'Cargá el saldo disponible de Mercado Pago una vez y desde ahí lo sigo solo.', a: 'go:bolsillo:mp' });
    const b = K.budgets?.total;
    if (b) {
      const st = monthStats(m);
      const p = st.gas / b;
      if (p >= 1) out.push({ lvl: 'bad', text: `Te pasaste del presupuesto del mes: ${m0(st.gas)} de ${m0(b)}.`, a: 'go:analisis:pres' });
      else if (p >= 0.8) out.push({ lvl: 'warn', text: `Ya usaste el ${pct(st.gas, b)}% del presupuesto de ${monthName(m)}.`, a: 'go:analisis:pres' });
      for (const [c, lim] of Object.entries(K.budgets?.cats || {})) {
        const s = st.cats[c] || 0;
        if (lim && s >= lim) out.push({ lvl: 'warn', text: `${catName(c)}: ${m0(s)} de ${m0(lim)}. Pasaste el límite.`, a: 'go:analisis:pres' });
      }
    }
    for (const r of recurrents()) if (r.inDays >= 0 && r.inDays <= 3) out.push({ lvl: 'info', text: `${r.name} se cobra ${r.inDays === 0 ? 'hoy' : r.inDays === 1 ? 'mañana' : `en ${r.inDays} días`}: ${m0(r.amount)}.`, a: 'go:recur' });
    const pend = MOVS.filter(needsReview).length;
    if (pend) out.push({ lvl: 'info', text: `Tenés ${pend} movimiento${pend > 1 ? 's' : ''} para revisar. Cada uno suma 5 XP.`, a: 'go:reglas' });
    if (passThroughs().length) out.push({ lvl: 'warn', text: 'Hay plata que entró y salió igual el mismo día. ¿Es un pasamanos?', a: 'go:reglas' });
    const sbd = secondBusinessDay(m);
    if (t >= sbd && t <= addDays(sbd, 6) && !MOVS.some(x => x.category === 'sueldo' && ymOf(x.day) === m)) out.push({ lvl: 'info', text: '¿Ya cobraste? Cargá el sueldo del mes.', a: 'cargar:sueldo' });
    return out;
  });
}

/* ═══ Juego: XP, niveles, rachas, misiones y logros ════════ */
const LEVELS = [[1, 'Novato'], [3, 'Ordenado'], [6, 'Ahorrista'], [10, 'Estratega'], [15, 'Inversor'], [20, 'Magnate'], [30, 'Leyenda']];
const xpFor = L => 50 * L * (L - 1);
function levelOf(xp) {
  let L = 1;
  while (xpFor(L + 1) <= xp) L++;
  return { L, name: LEVELS.filter(x => x[0] <= L).pop()[1], from: xpFor(L), to: xpFor(L + 1) };
}
function savingsTarget() {
  return memo('st', () => {
    const inc = rangeStats(addDays(today(), -56), today()).ing / 8;
    return inc > 0 ? Math.max(10000, Math.round((inc * 0.2) / 5000) * 5000) : 20000;
  });
}
function missions(w) {
  return memo(`mis${w}`, () => {
    const t = today(), end = addDays(w, 6), to = end < t ? end : t;
    const st = rangeStats(w, to);
    const target = savingsTarget();
    const all = {
      ahorro: () => {
        const v = st.ing - st.gas;
        return { id: 'ahorro', title: `Guardá ${m0(target)} esta semana`, xp: 250, p: clamp(v / target), done: v >= target, sub: v >= target ? 'CUMPLIDA' : `${m0(Math.max(v, 0))} DE ${m0(target)} · FALTAN ${m0(target - Math.max(v, 0))}` };
      },
      finde: () => {
        const sat = addDays(w, 5), sun = addDays(w, 6);
        const bad = MOVS.some(m => live(m) && m.kind === 'gasto' && m.category === 'delivery' && (m.day === sat || m.day === sun));
        return { id: 'finde', title: 'Fin de semana sin delivery', xp: 100, p: bad ? 0 : sun < t ? 1 : t >= sat ? 0.5 : 0, done: !bad && sun < t, failed: bad, sub: bad ? 'SE CORTÓ' : sun < t ? 'CUMPLIDA' : 'SÁB Y DOM' };
      },
      revisar: () => {
        const wk = MOVS.filter(m => live(m) && m.day >= w && m.day <= end);
        const pend = wk.filter(needsReview).length;
        return { id: 'revisar', title: 'Dejá la semana revisada', xp: 80, p: wk.length ? 1 - pend / wk.length : 0, done: wk.length > 0 && pend === 0 && (end < t || t >= addDays(w, 4)), sub: pend ? `${pend} PENDIENTES` : 'TODO EN ORDEN' };
      },
      hormiga3: () => {
        let c = 0;
        for (let d = w; d <= to; d = addDays(d, 1)) if (!hormigaDays().has(d)) c++;
        return { id: 'hormiga3', title: '3 días sin gastos hormiga', xp: 100, p: clamp(c / 3), done: c >= 3, sub: `${Math.min(c, 3)}/3 DÍAS` };
      },
      salidas: () => {
        const prev = rangeStats(addDays(w, -7), addDays(w, -1));
        const a = st.cats.salidas || 0, b = prev.cats.salidas || 0;
        return { id: 'salidas', title: 'Menos comida afuera que la semana pasada', xp: 120, p: b ? clamp((b - a) / b) : a ? 0 : 1, done: end < t && a < b, failed: b > 0 && a >= b, sub: `${m0(a)} VS ${m0(b)}` };
      },
      extra: () => {
        const n = MOVS.filter(m => m.source === 'manual' && m.kind === 'ingreso' && m.day >= w && m.day <= end).length;
        return { id: 'extra', title: 'Cargá tus ingresos extra de la semana', xp: 50, p: n ? 1 : 0, done: n > 0, sub: n ? 'CARGADO' : 'BINANCE Y LO QUE ENTRE' };
      },
    };
    const rot = [['finde', 'hormiga3'], ['revisar', 'salidas'], ['hormiga3', 'extra'], ['salidas', 'finde']];
    const n = Math.floor(diffDays('2026-01-05', w) / 7);
    return ['ahorro', ...rot[((n % 4) + 4) % 4]].map(k => all[k]());
  });
}
const goals = () => K.goals || [];
function goalProgress(g) {
  const p = g.pocket ? pockets().find(x => x.id === g.pocket) : null;
  const bal = p ? pocketBal(p) : null;
  const cur = p ? (bal == null ? 0 : fromArs(toArs(bal, p.currency), g.currency)) : g.amount || 0;
  return { cur, p: clamp(cur / (g.target || 1)), done: cur >= g.target };
}
const ACH = [
  { id: 'conectado', name: 'Conectado', icon: 'sync', desc: 'Mercado Pago entra solo.', test: () => MOVS.some(m => m.source !== 'manual') },
  { id: 'cero', name: 'Cero pendientes', icon: 'check', desc: 'Nada para revisar.', test: () => MOVS.length > 20 && !MOVS.some(needsReview) },
  { id: 'racha7', name: 'Racha de 7', icon: 'flame', desc: 'Una semana sin gastos hormiga.', test: () => streak().best >= 7 },
  { id: 'racha30', name: 'Racha de 30', icon: 'flame', desc: 'Un mes sin gastos hormiga.', test: () => streak().best >= 30 },
  { id: 'verde', name: 'Mes en verde', icon: 'trend', desc: 'Entró más de lo que salió.', test: () => closedMonths().some(m => monthStats(m).ahorro > 0) },
  { id: 'hierro', name: 'Presupuesto de hierro', icon: 'lock', desc: 'Un mes entero bajo presupuesto.', test: () => !!K.budgets?.total && closedMonths().some(m => m >= ymOf(K.game?.start || today()) && monthStats(m).gas <= K.budgets.total) },
  { id: 'inversor', name: 'Inversor', icon: 'chart', desc: 'Cargaste tus inversiones.', test: () => pockets().some(p => p.invest && p.anchor?.amount > 0) },
  { id: 'ahorrista', name: 'Primer ahorro', icon: 'coin', desc: 'Arrancaste una meta.', test: () => goals().some(g => goalProgress(g).cur > 0) },
  { id: 'meta', name: 'Meta cumplida', icon: 'target', desc: 'Llegaste a una meta.', test: () => goals().some(g => goalProgress(g).done) },
  { id: 'entrenador', name: 'Entrenador', icon: 'star', desc: 'Cinco reglas propias.', test: () => (S.data?.rules || []).length >= 5 },
  { id: 'semana', name: 'Semana perfecta', icon: 'trophy', desc: 'Las tres misiones de una semana.', test: () => { for (let w = weekStart(K.game?.start || today()); w < weekStart(today()); w = addDays(w, 7)) if (missions(w).every(x => x.done)) return true; return false; } },
  { id: 'cien', name: 'Cien revisados', icon: 'trophy', desc: 'Cien movimientos ordenados.', test: () => MOVS.filter(m => m.category_source === 'manual').length >= 100 },
];
function game() {
  return memo('game', () => {
    const start = K.game?.start || today(), t = today();
    let xp = 0;
    for (const m of MOVS) if (m.source === 'manual' || m.category_source === 'manual') xp += 5;
    const hd = hormigaDays();
    for (let d = start; d < t; d = addDays(d, 1)) if (!hd.has(d)) xp += 15;
    for (let w = weekStart(start); w <= weekStart(t); w = addDays(w, 7)) for (const x of missions(w)) if (x.done) xp += x.xp;
    for (let m = ymOf(start); m < ymOf(t); m = addMonths(m, 1)) {
      const st = monthStats(m);
      if (st.ahorro > 0) xp += 150;
      if (K.budgets?.total && st.gas <= K.budgets.total) xp += 400;
    }
    for (const g of goals()) if (goalProgress(g).done) xp += 300;
    const ach = ACH.map(a => ({ ...a, on: !!a.test() }));
    xp += ach.filter(a => a.on).length * 100;
    return { xp, lv: levelOf(xp), ach };
  });
}

/* ═══ Celebraciones: XP flotante, cinemáticas, confeti ═════ */
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), 2600);
}
function xpFloat(n, el) {
  if (!n) return;
  const r = el?.getBoundingClientRect?.() || { left: innerWidth / 2 - 30, top: innerHeight / 2 };
  const f = document.createElement('div');
  f.className = 'xpf';
  f.textContent = `+${n} XP`;
  f.style.left = `${r.left + (r.width || 0) / 2 - 24}px`;
  f.style.top = `${r.top - 8}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 1500);
}
function confetti() {
  const c = document.createElement('canvas');
  c.className = 'confetti';
  c.width = innerWidth * devicePixelRatio;
  c.height = innerHeight * devicePixelRatio;
  document.body.appendChild(c);
  const x = c.getContext('2d');
  x.scale(devicePixelRatio, devicePixelRatio);
  const cols = ['#4157FF', '#EEEAE2', '#D8B25A', '#8FC79A'];
  const ps = Array.from({ length: 140 }, () => ({ x: innerWidth / 2, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 3, s: 4 + Math.random() * 5, r: Math.random() * 6, c: cols[(Math.random() * 4) | 0] }));
  const t0 = performance.now();
  (function frame(t) {
    x.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of ps) { p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.1; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
    if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
const CINE = [];
function queueCine(c) { CINE.push(c); if (!document.querySelector('.cine')) playCine(); }
function playCine() {
  const c = CINE.shift();
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'cine';
  el.innerHTML = `<div class="cine-ring"></div><div class="cine-box">
    <div class="cine-tag">${esc(c.tag)}</div>
    ${c.big ? `<div class="cine-big">${esc(c.big)}</div>` : `<div style="color:var(--gold);display:flex;justify-content:center;margin:26px 0 14px">${ic(c.icon || 'star', 64, 1.2)}</div>`}
    <div class="cine-label">${esc(c.label)}</div>
    ${c.sub ? `<div class="cine-sub">${esc(c.sub)}</div>` : ''}
    ${c.rows ? `<div class="cine-rows">${c.rows.map(([k, v]) => `<div class="kv"><span class="mute">${esc(k)}</span><b class="mono" style="font-weight:400">${esc(v)}</b></div>`).join('')}</div>` : ''}
    <button class="btn" data-a="closeCine">${esc(c.btn || 'Dale')}</button></div>`;
  document.body.appendChild(el);
  armNav();
  vib([30, 40, 30]);
  if (c.confetti) confetti();
}
function closeCine() {
  document.querySelector('.cine')?.remove();
  playCine();
}
// Compara con lo ya celebrado (kv.game) y dispara lo nuevo una sola vez
function celebrate(el) {
  if (!S.loaded) return;
  const g = { ...(K.game || {}) };
  if (!g.start) { g.start = today(); saveKv('game', g); }
  const G = game();
  const first = g.xp_seen == null;
  if (!first && G.xp > g.xp_seen) xpFloat(G.xp - g.xp_seen, el);
  if (!first && G.lv.L > (g.level_seen || 1)) queueCine({ tag: 'SUBISTE DE NIVEL', big: String(G.lv.L), label: G.lv.name, sub: `${nf0.format(G.xp)} XP. Así se hace.`, confetti: true });
  const seen = new Set(g.ach_seen || []);
  if (!first) for (const a of G.ach) if (a.on && !seen.has(a.id)) queueCine({ tag: 'LOGRO DESBLOQUEADO', icon: a.icon, label: a.name, sub: a.desc });
  const gs = new Set(g.goals_seen || []);
  for (const goal of goals()) if (goalProgress(goal).done && !gs.has(goal.id)) queueCine({ tag: 'META CUMPLIDA', icon: 'target', label: goal.name, sub: `Llegaste a ${money(goal.target, goal.currency)}. Bien ahí.`, confetti: true });
  const prev = addMonths(ymOf(today()), -1);
  if (g.summary_seen !== prev && prev >= ymOf(firstDay())) {
    const st = monthStats(prev);
    if (st.gas || st.ing) {
      const top = Object.entries(st.cats).sort((a, b) => b[1] - a[1])[0];
      queueCine({ tag: `RESUMEN DE ${monthName(prev).toUpperCase()}`, big: st.ing ? `${pct(st.ahorro, st.ing)}%` : m0(st.gas), label: st.ahorro >= 0 ? 'Cerraste en verde' : 'Cerraste en rojo', rows: [['Gastaste', m0(st.gas)], ['Entró', m0(st.ing)], ['Te quedó', m0(st.ahorro)], ['Lo que más pesó', top ? catName(top[0]) : '—'], ['Racha sin hormiga', `${streak().best} días`]], btn: 'Ver el mes', confetti: st.ahorro > 0 });
    }
  }
  const next = { ...g, xp_seen: G.xp, level_seen: G.lv.L, ach_seen: G.ach.filter(a => a.on).map(a => a.id), goals_seen: goals().filter(x => goalProgress(x).done).map(x => x.id), summary_seen: prev };
  if (JSON.stringify(next) !== JSON.stringify(K.game || {})) saveKv('game', next);
}

/* ═══ Router: stacks por pestaña + atrás de iOS ════════════ */
const TABS = ['inicio', 'movs', 'analisis', 'ahorros'];
let TAB = 'inicio';
const STACKS = Object.fromEntries(TABS.map(t => [t, [{ p: t, ctx: {} }]]));
const cur = () => STACKS[TAB][STACKS[TAB].length - 1];
let armed = false;
function armNav() { if (armed) return; try { history.pushState({ ft: 1 }, ''); armed = true; } catch { /* sin history */ } }
addEventListener('popstate', () => {
  armed = false;
  if (document.querySelector('.cine')) { closeCine(); armNav(); return; }
  if (back()) armNav();
});
function go(p, ctx = {}) {
  STACKS[TAB][STACKS[TAB].length - 1].y = scrollY;
  STACKS[TAB].push({ p, ctx });
  armNav();
  render();
  scrollTo(0, 0);
}
function back() {
  const s = STACKS[TAB];
  if (s.length > 1) { s.pop(); render(); const y = s[s.length - 1].y || 0; requestAnimationFrame(() => scrollTo(0, y)); return true; }
  if (TAB !== 'inicio') { TAB = 'inicio'; render(); scrollTo(0, 0); return true; }
  return false;
}
let lastKey = '';
function render() {
  const c = cur();
  // La animación de entrada solo al cambiar de pantalla, no al tocar algo dentro
  const key = `${TAB}|${STACKS[TAB].length}|${c.p}|${c.ctx?.id || c.ctx?.m || ''}`;
  const still = key === lastKey;
  lastKey = key;
  let html;
  try { html = SCREENS[c.p](c.ctx || {}); } catch (e) { console.error(e); html = `${header('Ups')}<div class="empty">Algo se rompió en esta pantalla.<br>${esc(e.message)}</div>`; }
  $('#app').innerHTML = `<div class="page${still ? ' still' : ''}">${html}</div>`;
  renderNav();
  requestAnimationFrame(() => document.querySelectorAll('[data-w]').forEach(el => { el.style.width = `${el.dataset.w}%`; }));
}
const SAFE = new Set(['inicio', 'movs', 'analisis', 'ahorros', 'progreso', 'reglas', 'recur', 'alertas', 'resumen', 'cotiz']);
function softRender() { if (SAFE.has(cur().p) && !document.activeElement?.matches('input,textarea,select')) render(); }
function renderNav() {
  const a = (t, i, l) => `<a class="${TAB === t ? 'on' : ''}" data-a="tab:${t}" href="#">${ic(i, 22)}${l}</a>`;
  $('#nav').innerHTML = `<div class="nav-in">${a('inicio', 'home', 'Inicio')}${a('movs', 'list', 'Movimientos')}<a class="plus" data-a="cargar" href="#" aria-label="Cargar movimiento">${ic('plus', 20, 2)}</a>${a('analisis', 'chart', 'Análisis')}${a('ahorros', 'wallet', 'Ahorros')}</div>`;
}

/* ═══ Piezas comunes ═══════════════════════════════════════ */
function topBar() {
  const G = game(), lv = G.lv;
  const fill = Math.round(clamp((G.xp - lv.from) / (lv.to - lv.from)) * 10);
  return `<div class="top"><div class="brand">${LOGO(30)}<span>FINTRACK</span></div><div class="top-r">
    <button class="xpchip" data-a="go:progreso"><b>NV ${lv.L} · ${nf0.format(G.xp)} XP</b><span class="segs">${Array.from({ length: 10 }, (_, i) => `<i class="${i < fill ? 'on' : ''}"></i>`).join('')}</span></button>
    <button class="iconbtn" data-a="go:alertas" aria-label="Avisos">${ic('bell', 18)}${alerts().length ? '<span class="dot"></span>' : ''}</button></div></div>`;
}
const header = (t, right = '', noBack = false) => `<div class="head">${noBack ? '' : `<button class="iconbtn" data-a="back" aria-label="Volver">${ic('back', 16, 1.6)}</button>`}<h1>${esc(t)}</h1>${right}</div>`;
const bar = (p, cls = '') => `<div class="bar"><i class="${cls}" data-w="${Math.round(clamp(p) * 100)}"></i></div>`;
function rowSub(m) {
  const tm = m.source === 'manual' ? 'a mano' : hhmm(m.ts);
  if (needsReview(m)) return `Para revisar · ${catOf(m).name} · ${tm}`;
  if (m.kind === 'gasto') return `${catName(m.category)} · ${m.essential === 0 ? 'capricho' : 'necesario'} · ${tm}`;
  if (m.kind === 'reintegro') { const l = BYID[m.linked_id]; return `Devolución${l ? ` de ${title(l)}` : ''} · ${tm}`; }
  if (m.kind === 'interno') return `Movimiento entre tus cuentas · ${tm}`;
  if (m.kind === 'descartado') return `Ignorado · ${tm}`;
  return `${catName(m.category)} · ${tm}`;
}
function movRow(m) {
  const c = catOf(m), v = m.amount;
  const cls = v > 0 && m.kind !== 'interno' && m.kind !== 'descartado' ? 'pos' : '';
  return `<button class="row" data-a="go:mov:${esc(m.id)}"><div class="ic">${ic(c.icon, 18)}${needsReview(m) ? '<span class="rv"></span>' : ''}</div>
    <div class="tx"><div class="t1">${esc(title(m))}</div><div class="t2">${esc(rowSub(m))}</div></div>
    <div class="am ${cls}">${money(v, m.currency, { sign: true })}${m.currency !== 'ARS' ? `<small>≈ ${m0(arsOf(m))}</small>` : ''}</div></button>`;
}
function dayLabel(d) {
  const t = today();
  if (d === t) return `HOY · ${DIA3[dow(d)]} ${+d.slice(8)}`;
  if (d === addDays(t, -1)) return `AYER · ${DIA3[dow(d)]} ${+d.slice(8)}`;
  return `${DIA3[dow(d)]} ${+d.slice(8)} ${MES3[+d.slice(5, 7) - 1]}`;
}
function groupedList(list, limit = 300) {
  if (!list.length) return '<div class="empty">No hay movimientos acá.</div>';
  const out = [];
  let last = null;
  for (const m of list.slice(0, limit)) {
    if (m.day !== last) {
      last = m.day;
      const tot = list.filter(x => x.day === m.day && counts(x)).reduce((s, x) => s + arsOf(x), 0);
      out.push(`<div class="day-h"><span>${dayLabel(m.day)}</span><span>${tot ? money(tot, 'ARS', { sign: true, dec: false }) : ''}</span></div>`);
    }
    out.push(movRow(m));
  }
  return out.join('') + '<div class="list-end"></div>';
}
function sparkline(series) {
  const W = 390, H = 96, vals = series.map(s => s.v);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const pts = series.map((s, i) => [Math.round((i / (series.length - 1)) * (W - 24)), Math.round(70 - ((s.v - min) / span) * 52)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  const lp = pts[pts.length - 1];
  const lbl = [0, Math.floor(series.length / 2), series.length - 1].map(i => ({ x: pts[i][0], t: `${+series[i].d.slice(8)} ${MES3[+series[i].d.slice(5, 7) - 1]}` }));
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block;margin-top:18px" role="img" aria-label="Evolución del saldo en 30 días">
    <defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#4157FF" stop-opacity=".22"/><stop offset="1" stop-color="#4157FF" stop-opacity="0"/></linearGradient></defs>
    <path d="M130.5 0V82M260.5 0V82" stroke="#1C1E25"/>
    <path d="${line} V82 H0Z" fill="url(#ga)"/>
    <path class="l" d="${line}" stroke="#4157FF" stroke-width="1.6" fill="none"/>
    <rect x="${lp[0] - 4}" y="${lp[1] - 4}" width="8" height="8" fill="#EEEAE2"/>
    <path d="M0 82.5H${W}" stroke="#23252D"/>
    ${lbl.map((l, i) => `<text x="${i === 2 ? l.x - 44 : l.x + 20}" y="95" fill="#6C6D75" font-family="Geist Mono" font-size="9.5" letter-spacing="1">${l.t}</text>`).join('')}</svg>`;
}

/* ═══ Pantallas ════════════════════════════════════════════ */
function syncLine() {
  const s = K.sync || {};
  if (S.syncing) return 'MERCADO PAGO · SINCRONIZANDO…';
  return s.last_run ? `MERCADO PAGO · ${s.last_errors?.length ? 'CON ERRORES' : 'SINCRONIZADO'} ${dayOf(s.last_run) === today() ? hhmm(s.last_run) : `${+dayOf(s.last_run).slice(8)}/${dayOf(s.last_run).slice(5, 7)}`}` : 'MERCADO PAGO · TODAVÍA SIN SINCRONIZAR';
}

function scrInicio() {
  if (!MOVS.length) {
    const errs = K.sync?.last_errors || [];
    return `${topBar()}<div class="pad"><p class="serif" style="font-size:30px;line-height:1.2;margin:12px 0 18px">${S.syncing ? 'Estoy trayendo tus movimientos de Mercado Pago…' : 'Todavía no hay movimientos.'}</p>
      ${errs.map(e => `<div class="alert bad" style="margin:0 0 8px;width:100%">${esc(e)}</div>`).join('')}
      <button class="btn" data-a="sync" ${S.syncing ? 'disabled' : ''}>${ic('sync', 18)} Sincronizar ahora</button></div>`;
  }
  const name = (K.me?.name || '').split(' ')[0];
  const h = hourNow();
  const hola = h < 6 || h >= 20 ? 'Buenas noches' : h < 13 ? 'Buen día' : 'Buenas tardes';
  const pat = patrimony(), t = today(), m = ymOf(t), prevM = addMonths(m, -1);
  const st = monthStats(m), dayN = +t.slice(8), dmax = dim(m);
  const prevSame = rangeStats(`${prevM}-01`, `${prevM}-${String(Math.min(dayN, dim(prevM))).padStart(2, '0')}`);
  // Día a día: sin transferencias a personas ni la tarjeta (montos grandes y salteados)
  const daily = x => x.gas - (x.cats.personas || 0) - (x.cats.tarjeta || 0);
  const dPrev = daily(prevSame);
  let dGas = dPrev > 0 ? Math.round(((daily(st) - dPrev) / dPrev) * 100) : null;
  if (dGas != null && Math.abs(dGas) > 300) dGas = null;
  const b = K.budgets?.total, proj = dayN ? (st.gas / dayN) * dmax : 0;
  const top = Object.entries(st.cats).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]).slice(0, 4);
  const lvlOrder = { bad: 0, warn: 1, info: 2 };
  const al = alerts().slice().sort((x, y) => lvlOrder[x.lvl] - lvlOrder[y.lvl])[0];
  const G = game(), sk = streak(), mis = missions(weekStart(t))[0];
  const noSueldo = !MOVS.some(x => x.category === 'sueldo' && ymOf(x.day) === m);
  return `${topBar()}
  <div class="pad hola">${hola}${name ? `, ${esc(name)}` : ''}</div>
  ${al ? `<button class="alert ${al.lvl === 'bad' ? 'bad' : al.lvl === 'warn' ? 'warn' : ''}" style="margin-top:16px" data-a="${esc(al.a)}">${esc(al.text)}</button>` : ''}

  <section class="pad block">
    <div class="h2">Toda tu plata</div>
    ${pat.any ? `<button style="text-align:left;width:100%" data-a="tab:ahorros"><div class="big" style="font-size:50px;margin-top:6px">${m0(pat.ars)}</div>
      <div class="sub">${m0(pat.usd, 'USD')}${pat.change != null ? ` · <span class="${pat.change >= 0 ? 'pos' : 'red'}">${pat.change >= 0 ? '▲' : '▼'} ${nf2.format(Math.abs(pat.change))}% en 30 días</span>` : ''}</div></button>`
    : `<button class="card" style="margin:10px 0 0;width:100%;text-align:left" data-a="tab:ahorros"><div class="serif" style="font-size:22px">Cargá tus saldos una vez</div><div class="sub" style="margin-top:6px">Mercado Pago, la reserva, Binance, Cocos e ICBC. Después se suma solo.</div></button>`}
  </section>

  <section class="pad block">
    <div class="h2">${cap1(monthName(m))}</div>
    <div class="trio">
      <div><span>Entró</span><b class="pos">${mS(st.ing)}</b></div>
      <div><span>Salió</span><b>${mS(st.gas)}</b></div>
      <div><span>Diferencia</span><b class="${st.ahorro >= 0 ? 'pos' : 'red'}">${mS(st.ahorro)}</b></div>
    </div>
    ${dGas != null ? `<p class="note">${dGas <= 0 ? `En el día a día vas gastando <b class="pos">${-dGas}% menos</b> que en ${monthName(prevM)} a esta altura. Bien ahí.` : `En el día a día vas gastando <b class="red">${dGas}% más</b> que en ${monthName(prevM)} a esta altura.`}</p>` : ''}
    ${b ? `<div style="margin-top:16px">${bar(st.gas / b, st.gas > b ? 'r' : '')}</div>
      <p class="note" style="margin-top:8px">${proj <= b ? `De tu presupuesto de ${m0(b)}, a este ritmo te sobran <b class="pos">${m0(b - proj)}</b>.` : `A este ritmo te pasás <b class="red">${m0(proj - b)}</b> de tu presupuesto de ${m0(b)}.`}</p>`
    : `<button class="link" data-a="go:analisis:pres">Poné un presupuesto mensual →</button>`}
    ${noSueldo ? `<button class="link" data-a="cargar:sueldo">Sumá el sueldo de ${monthName(m)} para ver lo que te queda de verdad →</button>` : ''}
  </section>

  ${top.length ? `<section class="block">
    <div class="sec-h"><span class="h2">En qué se fue</span><button class="link" style="margin:0" data-a="go:analisis:este">Ver todo →</button></div>
    ${top.map(([c, v]) => `<button class="catrow" data-a="catMovs:${c}"><div class="cr1"><span class="ic">${ic(catIcon(c), 18)}</span><span class="cn">${esc(catName(c))}</span><span class="cv">${m0(v)}</span></div>${bar(v / top[0][1], catEssential(c) ? 'w' : 'y')}</button>`).join('')}
  </section>` : ''}

  <section class="block">
    <div class="sec-h"><span class="h2">Tu juego</span><button class="link" style="margin:0" data-a="go:progreso">Ver todo →</button></div>
    <button class="row" data-a="go:progreso"><div class="ic" style="color:var(--gold)">${ic('flame', 18)}</div><div class="tx"><div class="t1">${sk.cur} día${sk.cur === 1 ? '' : 's'} sin gastos hormiga</div><div class="t2">Nivel ${G.lv.L} · ${esc(G.lv.name)} · récord ${sk.best} días</div></div></button>
    <button class="row" data-a="go:progreso"><div class="ic">${ic('target', 18)}</div><div class="tx"><div class="t1">${esc(mis.title)}</div><div style="margin-top:8px">${bar(mis.p, mis.done ? 'g' : '')}</div></div><div class="am acc">+${mis.xp}</div></button>
    <div class="list-end"></div>
  </section>`;
}

const MV = { t: 'gastos', m: null, f: 'todos', c: '', q: '' };
function scrMovs() {
  const t = today();
  MV.m ||= ymOf(t);
  const m = MV.m, st = monthStats(m), isCur = m === ymOf(t);
  const prevM = addMonths(m, -1);
  const prevSt = isCur ? rangeStats(`${prevM}-01`, `${prevM}-${String(Math.min(+t.slice(8), dim(prevM))).padStart(2, '0')}`) : monthStats(prevM);
  let list = MOVS.filter(x => x.day.startsWith(m));
  list = list.filter(counts);
  if (MV.t === 'gastos') list = list.filter(x => x.amount < 0);
  if (MV.t === 'ingresos') list = list.filter(x => x.amount > 0);
  if (MV.f === 'nec') list = list.filter(x => x.amount < 0 && x.essential !== 0);
  if (MV.f === 'cap') list = list.filter(x => x.amount < 0 && x.essential === 0);
  if (MV.f === 'rev') list = list.filter(needsReview);
  if (MV.c) list = list.filter(x => gid(x.category) === MV.c);
  if (MV.q) { const q = normalizeText(MV.q).trim(); list = list.filter(x => normalizeText(title(x), x.description, x.note, catName(x.category)).includes(q)); }
  let summary;
  if (MV.t === 'gastos') {
    let d = prevSt.gas ? ((st.gas - prevSt.gas) / prevSt.gas) * 100 : null;
    if (d != null && Math.abs(d) > 300) d = null;
    summary = `<div class="lbl" style="display:flex;justify-content:space-between"><span>SALIÓ · ${monthName(m).toUpperCase()}</span>${d != null ? `<span class="${d <= 0 ? 'pos' : 'red'}">${d <= 0 ? '▼' : '▲'} ${Math.abs(Math.round(d))}% VS ${MES3[+prevM.slice(5, 7) - 1]}</span>` : ''}</div>
      <div class="big" style="font-size:52px;margin:10px 0 16px">${m0(st.gas)}</div>
      <div style="display:flex;height:6px;gap:2px"><i style="flex:${Math.max(st.nec, 0) || 0.001};background:var(--ink)"></i><i style="flex:${Math.max(st.cap, 0) || 0.001};background:var(--gold)"></i></div>
      <div class="mono" style="display:flex;justify-content:space-between;gap:12px;margin-top:10px;font-size:10.5px;letter-spacing:1px"><span>NECESARIOS ${pct(st.nec, st.gas)}%<br><span class="mute2">${m0(st.nec)}</span></span><span class="gold" style="text-align:right">CAPRICHOS ${pct(st.cap, st.gas)}%<br><span class="mute2">${m0(st.cap)}</span></span></div>`;
  } else if (MV.t === 'ingresos') {
    summary = `<div class="lbl">ENTRÓ · ${monthName(m).toUpperCase()}</div><div class="big pos" style="font-size:52px;margin:10px 0 12px">${m0(st.ing)}</div>
      ${Object.entries(st.inc).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<div class="kv"><span class="mute">${esc(catName(c))}</span><b class="mono" style="font-weight:400">${m0(v)}</b></div>`).join('')}`;
  } else {
    summary = `<div class="lbl">BALANCE · ${monthName(m).toUpperCase()}</div><div class="big ${st.ahorro >= 0 ? 'pos' : 'red'}" style="font-size:52px;margin:10px 0 12px">${money(st.ahorro, 'ARS', { sign: true, dec: false })}</div>
      <div class="kv"><span class="mute">Entró</span><b class="mono" style="font-weight:400">${m0(st.ing)}</b></div><div class="kv"><span class="mute">Salió</span><b class="mono" style="font-weight:400">${m0(st.gas)}</b></div>`;
  }
  const catsUsed = [...new Set(MOVS.filter(x => x.day.startsWith(m) && x.category && live(x)).map(x => gid(x.category)))];
  return `${header('Movimientos', `<button class="iconbtn" data-a="go:reglas" aria-label="Reglas">${ic('gear', 17)}</button>`, true)}
  <div class="seg">${[['gastos', 'Salió'], ['ingresos', 'Entró'], ['todo', 'Todo']].map(([k, l]) => `<button class="${MV.t === k ? 'on' : ''}" data-a="mv:t:${k}">${l}</button>`).join('')}</div>
  <div class="pad" style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 14px">
    <button class="iconbtn" data-a="mv:m:-1" aria-label="Mes anterior">${ic('back', 16)}</button>
    <span class="mono" style="font-size:12px;letter-spacing:2px">${monthName(m).toUpperCase()} ${m.slice(0, 4)}</span>
    <button class="iconbtn" data-a="mv:m:1" aria-label="Mes siguiente" ${isCur ? 'disabled style="opacity:.3"' : ''}>${ic('next', 16)}</button></div>
  <section class="pad">${summary}</section>
  <div class="chips" style="margin-top:22px">
    ${MV.t === 'gastos' ? [['todos', 'TODOS'], ['nec', 'NECESARIOS'], ['cap', 'CAPRICHOS'], ['rev', 'PARA REVISAR']].map(([k, l]) => `<button class="chip ${MV.f === k ? 'on' : ''}" data-a="mv:f:${k}">${l}</button>`).join('') : ''}
    <select class="chip" data-ch="mvCat" style="appearance:none;background:transparent" aria-label="Categoría"><option value="">CATEGORÍA ▾</option>${catsUsed.map(c => `<option value="${c}" ${MV.c === c ? 'selected' : ''}>${esc(catName(c).toUpperCase())}</option>`).join('')}</select></div>
  <div class="field" style="margin-top:12px"><input class="inp" type="search" placeholder="Buscar comercio, persona o nota" value="${esc(MV.q)}" data-in="mvQ" style="height:44px"></div>
  <div style="margin-top:6px">${groupedList(list)}</div>`;
}

// ── Detalle y edición de un movimiento ──
let ED = null;
function scrMov({ id }) {
  const m = BYID[id];
  if (!m) return `${header('Movimiento')}<div class="empty">Este movimiento ya no existe.</div>`;
  if (!ED || ED.id !== id) ED = { id, kind: m.kind, category: m.category, essential: m.essential, note: m.note || '', linked_id: m.linked_id || '', rule: false, pattern: mkey(m), amount: String(Math.abs(m.amount)), description: m.description || '', day: m.day, pocket: m.pocket };
  const manual = m.source === 'manual';
  const kinds = m.amount < 0 ? [['gasto', 'Gasto'], ['interno', 'Interno'], ['descartado', 'Ignorar']] : [['ingreso', 'Ingreso'], ['reintegro', 'Parte de un gasto'], ['interno', 'Interno'], ['descartado', 'Ignorar']];
  const src = manual ? 'CARGADO A MANO' : m.source === 'mp_reporte' ? 'MERCADO PAGO · REPORTE' : 'MERCADO PAGO';
  const medio = { account_money: 'DINERO EN CUENTA', available_money: 'DINERO EN CUENTA', prepaid_card: 'PREPAGA', credit_card: 'TARJETA DE CRÉDITO', debit_card: 'DÉBITO', bank_transfer: 'TRANSFERENCIA' }[m.mp_type] || '';
  const cands = ED.kind === 'reintegro' ? MOVS.filter(x => x.kind === 'gasto' && live(x) && Math.abs(diffDays(x.day, m.day)) <= 15 && -x.amount >= m.amount * 0.3).sort((a, b) => Math.abs(-a.amount - m.amount * 1.6) - Math.abs(-b.amount - m.amount * 1.6)).slice(0, 6) : [];
  const twin = passThroughs().find(([a, b]) => a.id === id || b.id === id);
  const canRule = !manual && m.op !== 'payout' && m.op !== 'rendimiento' && ED.pattern;
  return `${header('Movimiento')}
  <section class="pad">
    <div class="big ${m.amount > 0 && m.kind !== 'interno' ? 'pos' : ''}" style="font-size:50px">${money(m.amount, m.currency, { sign: true })}</div>
    ${m.currency !== 'ARS' ? `<div class="mono mute" style="margin-top:6px">≈ ${m0(arsOf(m))} al ${RATES[rateKey()].toLowerCase()}</div>` : ''}
    <div style="font-size:18px;margin-top:12px">${esc(title(m))}</div>
    <div class="lbl" style="margin-top:6px">${DIA3[dow(m.day)]} ${+m.day.slice(8)} ${MES3[+m.day.slice(5, 7) - 1]} · ${manual ? 'A MANO' : hhmm(m.ts)} · ${src}${medio ? ` · ${medio}` : ''}</div>
    ${m.description && m.description !== title(m) ? `<div class="mute" style="font-size:13px;margin-top:8px">${esc(m.description)}</div>` : ''}
  </section>
  ${needsReview(m) ? `<div class="alert" style="margin-top:18px">Lo categoricé solo. Confirmalo o cambialo: suma +5 XP.</div>` : ''}
  ${twin ? `<div class="alert warn" style="margin-top:8px">Mismo monto entra y sale el ${+m.day.slice(8)}/${m.day.slice(5, 7)}. Si es plata que pasó por tu cuenta, marcalos "Ignorar".</div>` : ''}
  <div class="field"><label class="lbl">TIPO</label></div>
  <div class="chips">${kinds.map(([k, l]) => `<button class="chip ${ED.kind === k ? 'on' : ''}" data-a="ed:kind:${k}">${l.toUpperCase()}</button>`).join('')}</div>
  ${ED.kind === 'gasto' || ED.kind === 'ingreso' ? `<div class="field"><label class="lbl">CATEGORÍA</label></div>
    <div class="cats">${CATS()[ED.kind].map(c => `<button class="${gid(ED.category) === c.id ? 'on' : ''}" data-a="ed:cat:${c.def}">${ic(c.icon, 18)}${esc(c.name)}</button>`).join('')}</div>` : ''}
  ${ED.kind === 'gasto' ? `<div class="field"><label class="lbl">¿HACÍA FALTA?</label></div><div class="toggle2"><button class="${ED.essential !== 0 ? 'on' : ''}" data-a="ed:ess:1">Necesario</button><button class="${ED.essential === 0 ? 'on' : ''}" data-a="ed:ess:0">Capricho</button></div>` : ''}
  ${ED.kind === 'reintegro' ? `<div class="field"><label class="lbl">¿DE QUÉ GASTO ES LA PARTE?</label><div class="mute" style="font-size:13px;line-height:1.5">Lo que te pasaron se descuenta de ese gasto y no cuenta como ingreso.</div></div>
    <div style="margin-top:10px">${cands.length ? cands.map(x => `<button class="row" data-a="ed:link:${esc(x.id)}" style="${ED.linked_id === x.id ? 'background:var(--acc-dim)' : ''}"><div class="ic">${ED.linked_id === x.id ? ic('check', 18) : ic(catIcon(x.category), 18)}</div><div class="tx"><div class="t1">${esc(title(x))}</div><div class="t2">${dayLabel(x.day)}</div></div><div class="am">${money(x.amount, x.currency)}</div></button>`).join('') + '<div class="list-end"></div>' : '<div class="empty">No encontré gastos cerca de esta fecha.</div>'}</div>` : ''}
  ${manual ? `<div class="field"><label class="lbl">MONTO</label><input class="inp" inputmode="decimal" value="${esc(ED.amount)}" data-in="ed:amount"></div>
    <div class="field"><label class="lbl">DESCRIPCIÓN</label><input class="inp" value="${esc(ED.description)}" data-in="ed:description" maxlength="120"></div>
    <div class="field"><label class="lbl">FECHA</label><input class="inp" type="date" value="${ED.day}" data-in="ed:day"></div>` : ''}
  <div class="field"><label class="lbl">${m.op === 'payout' ? 'NOMBRE (EJ.: ALQUILER, TARJETA DE MAMÁ)' : 'NOTA'}</label><input class="inp" value="${esc(ED.note)}" data-in="ed:note" maxlength="300"></div>
  ${canRule ? `<div class="field"><button class="toggle2" style="padding:0;display:flex;gap:10px;align-items:center;width:100%;text-align:left" data-a="ed:rule"><span class="iconbtn" style="width:28px;height:28px;${ED.rule ? 'background:var(--acc);border-color:var(--acc)' : ''}">${ED.rule ? ic('check', 14, 2) : ''}</span><span style="font-size:14px">Aplicar siempre a los que digan «${esc(ED.pattern)}»</span></button>
    ${ED.rule ? `<input class="inp" style="margin-top:10px" value="${esc(ED.pattern)}" data-in="ed:pattern"><div class="mute" style="font-size:12px;margin-top:6px">Cambio también los anteriores que no tocaste.</div>` : ''}</div>` : ''}
  <div class="pad" style="margin-top:26px;display:flex;flex-direction:column;gap:8px">
    <button class="btn" data-a="saveMov">Guardar</button>
    ${manual ? `<button class="btn danger" data-a="delMov">${ic('trash', 16)} Borrar</button>` : ''}</div>`;
}

// ── Cargar a mano ──
let CG = null;
function newCG(preset) {
  const base = { kind: 'gasto', amount: '', currency: 'ARS', category: null, picked: false, essential: null, description: '', day: today(), pocket: 'efectivo', more: false };
  if (preset === 'binance') return { ...base, kind: 'ingreso', currency: 'USDC', category: 'extra', picked: true, description: 'Ingreso Binance', pocket: 'binance' };
  if (preset === 'sueldo') return { ...base, kind: 'ingreso', category: 'sueldo', picked: true, description: 'Sueldo', pocket: 'icbc' };
  return base;
}
function cgCats() {
  const sug = suggestCat(CG.description, CG.kind);
  if (!CG.picked) CG.category = sug;
  const shown = CATS()[CG.kind];
  return `${sug ? `<div class="lbl" style="padding:0 20px;margin-bottom:8px">CATEGORÍA SUGERIDA · <span class="acc">${esc(catName(sug).toUpperCase())}</span></div>` : '<div class="lbl" style="padding:0 20px;margin-bottom:8px">CATEGORÍA</div>'}
    <div class="cats">${shown.map(c => `<button class="${gid(CG.category) === c.id ? 'on' : ''} ${sug && gid(sug) === c.id && gid(CG.category) !== c.id ? 'sug' : ''}" data-a="cg:cat:${c.def}">${ic(c.icon, 18)}${esc(c.name)}</button>`).join('')}</div>`;
}
function cgEss() {
  if (CG.kind !== 'gasto') return '';
  const ess = CG.essential ?? (CG.category ? catEssential(CG.category) : true);
  return `<div class="field"><label class="lbl">¿HACÍA FALTA?</label></div><div class="toggle2"><button class="${ess ? 'on' : ''}" data-a="cg:ess:1">Necesario</button><button class="${!ess ? 'on' : ''}" data-a="cg:ess:0">Capricho</button></div>`;
}
function scrCargar({ preset }) {
  if (!CG || preset) { CG = newCG(preset); if (preset) cur().ctx = {}; }
  const n = parseAmt(CG.amount);
  const conv = n > 0 ? (CG.currency === 'ARS' ? `≈ ${money(n / rate(), 'USD')} AL ${RATES[rateKey()].toUpperCase()}` : `≈ ${m0(n * rate())} AL ${RATES[rateKey()].toUpperCase()}`) : '&nbsp;';
  const pks = pockets();
  return `${header('Nuevo movimiento')}
  <div class="chips" style="margin-bottom:18px"><button class="chip" data-a="cg:preset:binance">${ic('coin', 14)} BINANCE SEMANAL</button><button class="chip" data-a="cg:preset:sueldo">${ic('brief', 14)} SUELDO</button></div>
  <div class="seg">${[['gasto', 'Gasto'], ['ingreso', 'Ingreso']].map(([k, l]) => `<button class="${CG.kind === k ? 'on' : ''}" data-a="cg:kind:${k}">${l}</button>`).join('')}</div>
  <div class="lbl" style="padding:0 20px;margin-top:22px">MONTO</div>
  <div class="amount-in"><span>${CG.currency === 'ARS' ? '$' : CG.currency === 'USD' ? 'US$' : 'USDC'}</span><input inputmode="decimal" placeholder="0" value="${esc(CG.amount)}" data-in="cg:amount" aria-label="Monto" autocomplete="off"></div>
  <div class="mono mute2" style="padding:0 20px;font-size:11px;letter-spacing:1px" id="cgConv">${conv}</div>
  <div class="chips" style="margin-top:12px">${['ARS', 'USD', 'USDC'].map(c => `<button class="chip ${CG.currency === c ? 'on' : ''}" data-a="cg:cur:${c}">${c}</button>`).join('')}</div>
  <div class="field"><label class="lbl">DESCRIPCIÓN</label><input class="inp" placeholder="${CG.kind === 'gasto' ? 'Ej.: kiosco, nafta, regalo' : 'Ej.: Binance, cliente, changa'}" value="${esc(CG.description)}" data-in="cg:description" maxlength="120"></div>
  <div style="margin-top:18px" id="cgCats">${cgCats()}</div>
  <div id="cgEss">${cgEss()}</div>
  <div class="field"><label class="lbl">FECHA · CUENTA</label>
    <div style="display:flex;gap:8px"><input class="inp" type="date" value="${CG.day}" max="${today()}" data-in="cg:day" style="flex:1">
    <select class="inp" data-ch="cgPocket" style="flex:1">${pks.filter(p => p.id !== 'reserva').map(p => `<option value="${p.id}" ${CG.pocket === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div></div>
  <div class="xp-note">REGISTRAR A MANO SUMA +5 XP</div>
  <div class="pad"><button class="btn" data-a="saveCG">Guardar ${CG.kind} ${ic('check', 16, 2)}</button></div>`;
}

// ── Análisis ──
const AN = { t: 'mes' };
function scrAnalisis(ctx) {
  if (ctx.tab) { AN.t = ctx.tab; delete ctx.tab; }
  const tabs = `<div class="seg" style="margin-bottom:22px">${[['mes', 'Mes a mes'], ['este', 'Este mes'], ['pres', 'Presupuestos']].map(([k, l]) => `<button class="${AN.t === k ? 'on' : ''}" data-a="an:${k}">${l}</button>`).join('')}</div>`;
  return `${header('Análisis', '', true)}${tabs}${AN.t === 'mes' ? anMes() : AN.t === 'este' ? anEste() : anPres()}`;
}
function anMes() {
  const t = ymOf(today()), months = [];
  for (let i = 11; i >= 0; i--) months.push(addMonths(t, -i));
  const data = months.map(m => ({ m, ...monthStats(m) })).filter((x, i, a) => x.gas || x.ing || a.slice(0, i).some(y => y.gas || y.ing));
  if (!data.length) return '<div class="empty">Todavía no hay meses para comparar.</div>';
  const max = Math.max(...data.map(x => Math.max(x.gas, x.ing)), 1);
  const W = 350, H = 170, slot = W / data.length, bw = Math.min(12, slot / 3);
  const bars = data.map((x, i) => {
    const xi = i * slot + slot / 2;
    const hi = (x.ing / max) * (H - 30), hg = (x.gas / max) * (H - 30);
    return `<rect class="vbar" style="animation-delay:${i * 40}ms" x="${xi - bw - 1}" y="${H - 20 - hi}" width="${bw}" height="${hi}" fill="#EEEAE2"/>
      <rect class="vbar" style="animation-delay:${i * 40 + 20}ms" x="${xi + 1}" y="${H - 20 - hg}" width="${bw}" height="${hg}" fill="#4157FF"/>
      <text x="${xi}" y="${H - 4}" text-anchor="middle" fill="#6C6D75" font-family="Geist Mono" font-size="9">${MES3[+x.m.slice(5, 7) - 1]}</text>`;
  }).join('');
  const closed = data.filter(x => x.m < t);
  const ingT = closed.reduce((s, x) => s + x.ing, 0), ahT = closed.reduce((s, x) => s + x.ahorro, 0);
  const best = closed.slice().sort((a, b) => b.ahorro - a.ahorro)[0];
  return `<section class="pad"><div class="lbl" style="display:flex;justify-content:space-between"><span>INGRESOS VS GASTOS</span><span><span style="color:var(--ink)">■</span> ING. <span class="acc">■</span> GAS.</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="margin-top:14px" role="img" aria-label="Ingresos y gastos de los últimos meses"><path d="M0 ${H - 19.5}H${W}" stroke="#23252D"/>${bars}</svg></section>
    <div class="sec pad" style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div><div class="lbl">AHORRO PROMEDIO</div><div class="serif" style="font-size:34px;margin-top:6px">${ingT ? `${pct(ahT, ingT)}%` : '—'}</div><div class="mute" style="font-size:12.5px">de lo que entra</div></div>
      <div><div class="lbl">MEJOR MES</div><div class="serif" style="font-size:34px;margin-top:6px">${best ? cap1(monthName(best.m)) : '—'}</div><div class="mute" style="font-size:12.5px">${best ? (best.ahorro > 0 ? `guardaste ${m0(best.ahorro)}` : `faltaron ${m0(-best.ahorro)}`) : ''}</div></div></div>
    ${!MOVS.some(x => x.category === 'sueldo') ? `<button class="alert warn sec" data-a="cargar:sueldo">Tu sueldo entra a ICBC y no lo veo: cargalo cada mes y el ahorro te va a dar bien.</button>` : ''}
    <section class="sec">${data.slice().reverse().map(x => `<button class="row" data-a="go:resumen:${x.m}"><div class="tx"><div class="t1">${cap1(monthName(x.m))} ${x.m.slice(0, 4)}</div><div class="t2">ENTRÓ ${m0(x.ing)} · SALIÓ ${m0(x.gas)}</div></div><div class="am ${x.ahorro >= 0 ? 'pos' : 'red'}">${money(x.ahorro, 'ARS', { sign: true, dec: false })}</div></button>`).join('')}<div class="list-end"></div></section>`;
}
function anEste() {
  const t = today(), m = ymOf(t), st = monthStats(m), prev = monthStats(addMonths(m, -1));
  const cats = Object.entries(st.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!cats.length) return '<div class="empty">Todavía no hay gastos este mes.</div>';
  let insight = '';
  const ups = cats.map(([c, v]) => [c, v, prev.cats[c] || 0]).filter(([, v, p]) => p > 0 && v > p * 1.1).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
  if (ups[0]) { const [c, v, p] = ups[0]; insight = `${catName(c)} subió ${Math.round(((v - p) / p) * 100)}% contra ${monthName(addMonths(m, -1))}. ${['salidas', 'compras'].includes(c) ? 'Bajalo a la mitad y la misión de ahorro sale sola.' : 'Fijate si es algo puntual.'}`; }
  const gastos = MOVS.filter(x => x.day.startsWith(m) && x.amount < 0 && counts(x));
  const top = gastos.slice().sort((a, b) => arsOf(a) - arsOf(b)).slice(0, 3);
  const byDay = {};
  for (const x of gastos) byDay[x.day] = (byDay[x.day] || 0) - arsOf(x);
  const worst = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
  return `<section class="pad"><div class="lbl" style="display:flex;justify-content:space-between"><span>${monthName(m).toUpperCase()} POR CATEGORÍA</span><span style="color:var(--ink)">${m0(st.gas)}</span></div>
    <div style="margin-top:14px">${cats.map(([c, v]) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px"><span>${ic(catIcon(c), 14)}</span><span style="flex:1;margin-left:10px">${esc(catName(c))} <span class="mono mute2" style="font-size:11px">${pct(v, st.gas)}%</span></span><span class="mono">${m0(v)}</span></div>${bar(v / cats[0][1], catEssential(c) ? 'w' : 'y')}</div>`).join('')}</div></section>
    ${insight ? `<div class="card sec" style="font-size:14.5px;line-height:1.5;border-left:2px solid var(--acc)">${esc(insight)}</div>` : ''}
    <section class="sec"><div class="sec-h"><span class="lbl">LOS MÁS GRANDES</span></div>${top.map(movRow).join('')}<div class="list-end"></div></section>
    ${worst ? `<section class="sec pad"><div class="lbl">TU DÍA MÁS CARO</div><div style="font-size:15px;margin-top:8px">El ${dayLabel(worst[0]).toLowerCase()} gastaste <span class="serif" style="font-size:20px">${m0(worst[1])}</span>.</div></section>` : ''}`;
}
let PB = null;
function anPres() {
  const m = ymOf(today()), st = monthStats(m);
  PB ||= { total: K.budgets?.total ? String(K.budgets.total) : '', cats: Object.fromEntries(Object.entries(K.budgets?.cats || {}).map(([k, v]) => [k, String(v)])) };
  const avg = closedMonths().slice(-3).map(x => monthStats(x).gas);
  const sug = avg.length ? Math.round(avg.reduce((a, b) => a + b, 0) / avg.length / 10000) * 10000 : 0;
  return `<section class="pad"><div class="lbl">PRESUPUESTO MENSUAL TOTAL</div>
    <div class="mute" style="font-size:13px;line-height:1.5;margin:6px 0 10px">Lo que querés gastar como máximo por mes (sin contar movimientos internos).${sug ? ` Tus últimos meses promedian ${m0(sug)}.` : ''}</div>
    <input class="inp" inputmode="numeric" placeholder="${sug ? nf0.format(sug) : 'Ej.: 900.000'}" value="${esc(PB.total)}" data-in="pb:total">
    ${K.budgets?.total ? `<div style="margin-top:12px">${bar(st.gas / K.budgets.total, st.gas > K.budgets.total ? 'r' : '')}</div><div class="mono mute2" style="font-size:11px;margin-top:6px">${m0(st.gas)} DE ${m0(K.budgets.total)} · ${pct(st.gas, K.budgets.total)}%</div>` : ''}</section>
    <section class="sec"><div class="sec-h"><span class="lbl">POR CATEGORÍA (OPCIONAL)</span></div>
    ${CATS().gasto.filter(c => c.id !== 'personas').map(c => { const lim = K.budgets?.cats?.[c.id], s = st.cats[c.id] || 0; return `<div class="row" style="flex-wrap:wrap"><div class="ic">${ic(c.icon, 16)}</div><div class="tx"><div class="t1">${esc(c.name)}</div><div class="t2">ESTE MES ${m0(s)}</div></div><input class="inp" style="width:120px;height:40px;font-size:14px" inputmode="numeric" placeholder="Sin límite" value="${esc(PB.cats[c.id] || '')}" data-in="pb:${c.id}">${lim ? `<div style="width:100%;margin-top:8px">${bar(s / lim, s > lim ? 'r' : '')}</div>` : ''}</div>`; }).join('')}<div class="list-end"></div></section>
    <div class="pad" style="margin-top:20px"><button class="btn" data-a="savePres">Guardar presupuesto</button></div>`;
}

// ── Ahorros, bolsillos y metas ──
function scrAhorros() {
  const pat = patrimony(), tot = pat.ars || 1;
  const parts = [['ARS', 'PESOS', 'var(--ink)'], ['USD', 'USD', 'var(--acc)'], ['USDC', 'USDC', 'var(--gold)']].filter(([k]) => pat.by[k] > 0);
  const gl = goals();
  const avgSave = (() => { const c = closedMonths().slice(-3); return c.length ? c.reduce((s, m) => s + monthStats(m).ahorro, 0) / c.length : 0; })();
  return `${header('Ahorros', `<button class="lbl" style="color:var(--acc)" data-a="go:cotiz">COTIZACIONES →</button>`, true)}
  <section class="pad"><div class="lbl">PATRIMONIO</div>
    <div class="big" style="font-size:56px;margin-top:8px">${pat.any ? m0(pat.ars) : '—'}</div>
    <div class="sub" style="margin-top:8px">${pat.any ? `${m0(pat.usd, 'USD')}${pat.change != null ? ` · <span class="${pat.change >= 0 ? 'pos' : 'red'}">${pat.change >= 0 ? '▲' : '▼'} ${nf2.format(Math.abs(pat.change))}% en 30 días</span>` : ''}` : 'Tocá cada bolsillo y cargá su saldo de hoy.'}</div></section>
  ${pat.any ? sparkline(balanceSeries(30)) : ''}
  <section class="pad">
    ${parts.length ? `<div style="display:flex;height:6px;gap:2px;margin-top:18px">${parts.map(([k, , c]) => `<i style="flex:${pat.by[k]};background:${c}"></i>`).join('')}</div>
    <div class="mono" style="display:flex;gap:16px;margin-top:10px;font-size:11px;letter-spacing:1px">${parts.map(([k, l]) => `<span>${l} ${pct(pat.by[k], tot)}%</span>`).join('')}</div>` : ''}</section>
  <section class="sec"><div class="sec-h"><span class="lbl">MIS BOLSILLOS</span></div>
    ${pockets().map(p => { const b = pocketBal(p); return `<button class="row" data-a="go:bolsillo:${p.id}"><div class="ic mono" style="font-size:9.5px">${p.currency}</div><div class="tx"><div class="t1">${esc(p.name)}</div><div class="t2">${p.auto ? `SE ACTUALIZA SOLO${p.rate ? ` · RINDE ${p.rate}%` : ''}` : p.anchor ? `ACTUALIZADO ${dayLabel(dayOf(p.anchor.ts))}` : 'SIN CARGAR'}</div></div><div class="am">${b == null ? '<span class="acc">CARGAR</span>' : money(b, p.currency, { dec: p.currency !== 'ARS' })}${b != null && p.currency !== 'ARS' ? `<small>≈ ${m0(toArs(b, p.currency))}</small>` : ''}</div></button>`; }).join('')}<div class="list-end"></div></section>
  <section class="sec"><div class="sec-h"><span class="lbl">METAS</span><button data-a="go:meta:new">+ NUEVA</button></div>
    ${gl.length ? gl.map(g => { const pr = goalProgress(g); const rem = g.target - pr.cur; const per = fromArs(avgSave, g.currency); const months = per > 0 ? Math.ceil(rem / per) : null; return `<button class="row" data-a="go:meta:${g.id}" style="display:block"><div style="display:flex;justify-content:space-between"><span class="t1">${esc(g.name)}</span><span class="mono">${Math.round(pr.p * 100)}%</span></div><div style="margin:10px 0 8px">${bar(pr.p, pr.done ? 'g' : '')}</div><div class="t2" style="display:flex;justify-content:space-between"><span>${money(pr.cur, g.currency, { dec: false })} DE ${money(g.target, g.currency, { dec: false })}</span><span class="${pr.done ? 'pos' : ''}">${pr.done ? 'CUMPLIDA' : months && months <= 36 ? `LLEGÁS EN ${MES[(+ymOf(today()).slice(5, 7) - 1 + months) % 12].toUpperCase()}` : 'SUMÁ AHORRO PARA LLEGAR'}</span></div></button>`; }).join('') + '<div class="list-end"></div>' : '<div class="empty">Poné una meta (un viaje, el fondo de emergencia) y te digo cuándo llegás.</div>'}</section>`;
}
function scrBolsillo({ id }) {
  const p = pockets().find(x => x.id === id);
  if (!p) return `${header('Bolsillo')}<div class="empty">No existe.</div>`;
  const b = pocketBal(p);
  const snaps = (p.snaps || []).slice().reverse();
  const help = {
    mp: 'Abrí Mercado Pago y copiá lo que dice "Dinero disponible". Lo cargás una vez: después lo actualizo solo con cada movimiento.',
    reserva: 'Copiá el total de la reserva. Los rendimientos diarios se suman solos.',
  }[p.id] || (p.invest ? 'Actualizá el valor cuando quieras (una vez por semana alcanza). Te muestro cuánto rindió entre cargas.' : 'Actualizalo cuando cambie. Si cargás movimientos a mano en esta cuenta, se suman solos.');
  return `${header(p.name)}
  <section class="pad"><div class="lbl">${p.auto ? 'SALDO CALCULADO' : 'VALOR ACTUAL'}</div><div class="big" style="font-size:50px;margin-top:8px">${b == null ? '—' : money(b, p.currency)}</div>
    ${b != null && p.currency !== 'ARS' ? `<div class="mono mute" style="margin-top:6px">≈ ${m0(toArs(b, p.currency))}</div>` : ''}
    <p class="mute" style="font-size:13.5px;line-height:1.5;margin-top:14px">${esc(help)}</p></section>
  <div class="field"><label class="lbl">${b == null ? 'SALDO DE HOY' : 'CORREGIR CON EL SALDO DE HOY'} (${p.currency})</label><input class="inp" inputmode="decimal" id="pkAmt" placeholder="${b == null ? 'Ej.: 541.255,25' : nf2.format(b)}"></div>
  ${p.id === 'reserva' || p.id === 'mp' ? `<div class="field"><label class="lbl">RINDE (% ANUAL)</label><input class="inp" inputmode="decimal" id="pkRate" value="${p.rate || ''}"></div>` : ''}
  <div class="field"><label class="lbl">NOMBRE</label><input class="inp" id="pkName" value="${esc(p.name)}" maxlength="40"></div>
  <div class="pad" style="margin-top:22px"><button class="btn" data-a="savePocket:${p.id}">Guardar</button></div>
  ${snaps.length > 1 ? `<section class="sec"><div class="sec-h"><span class="lbl">HISTORIAL</span><span class="lbl ${snaps[0].amount >= snaps[snaps.length - 1].amount ? 'pos' : 'red'}">${money(snaps[0].amount - snaps[snaps.length - 1].amount, p.currency, { sign: true })}</span></div>${snaps.slice(0, 12).map(s => `<div class="row"><div class="tx"><div class="t1">${dayLabel(s.day)}</div></div><div class="am">${money(s.amount, p.currency)}</div></div>`).join('')}<div class="list-end"></div></section>` : ''}`;
}
function scrMeta({ id }) {
  const g = goals().find(x => x.id === id) || { id: 'new', name: '', target: '', currency: 'ARS', pocket: '', amount: '' };
  return `${header(id === 'new' ? 'Nueva meta' : 'Meta')}
  <div class="field"><label class="lbl">NOMBRE</label><input class="inp" id="gName" value="${esc(g.name)}" placeholder="Ej.: Viaje a Italia" maxlength="40"></div>
  <div class="field"><label class="lbl">OBJETIVO</label><div style="display:flex;gap:8px"><input class="inp" id="gTarget" inputmode="decimal" value="${g.target || ''}" style="flex:2"><select class="inp" id="gCur" style="flex:1">${['ARS', 'USD', 'USDC'].map(c => `<option ${g.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div></div>
  <div class="field"><label class="lbl">¿DÓNDE ESTÁ LA PLATA?</label><select class="inp" id="gPocket"><option value="">La cargo a mano</option>${pockets().map(p => `<option value="${p.id}" ${g.pocket === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
    <div class="mute" style="font-size:12.5px;margin-top:6px;line-height:1.5">Si elegís un bolsillo, el avance es su saldo y se actualiza solo.</div></div>
  <div class="field"><label class="lbl">LLEVÁS (SI ES A MANO)</label><input class="inp" id="gAmount" inputmode="decimal" value="${g.amount || ''}"></div>
  <div class="pad" style="margin-top:22px;display:flex;flex-direction:column;gap:8px"><button class="btn" data-a="saveGoal:${g.id}">Guardar meta</button>${id !== 'new' ? `<button class="btn danger" data-a="delGoal:${g.id}">${ic('trash', 16)} Borrar meta</button>` : ''}</div>`;
}

// ── Cotizaciones y convertidor ──
const CV = { amt: '100', dir: 'u2a' };
function scrCotiz() {
  fetchFx();
  const k = rateKey(), f = S.fx?.[k];
  const n = parseAmt(CV.amt) || 0;
  const res = CV.dir === 'u2a' ? n * rate() : n / rate();
  const d = fxDelta(k);
  return `${header('Cotizaciones', `<span class="mono mute2" style="font-size:11px">${S.fx ? hhmm(S.fx.at) : ''}</span>`)}
  <section class="pad"><div class="lbl" style="display:flex;justify-content:space-between"><span>DÓLAR ${RATES[k].toUpperCase()}</span>${d != null ? `<span class="${d >= 0 ? 'pos' : 'red'}">${d >= 0 ? '▲' : '▼'} ${nf2.format(Math.abs(d))}% · AYER</span>` : ''}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-top:12px"><div><div class="lbl">COMPRA</div><div class="serif" style="font-size:40px">${f ? m0(f.compra) : '—'}</div></div><div><div class="lbl">VENTA</div><div class="serif" style="font-size:40px">${f ? m0(f.venta) : '—'}</div></div></div></section>
  <section class="sec"><div class="sec-h"><span class="lbl">CONVERTIDOR</span><button data-a="cv:flip">${ic('swap', 16)}</button></div>
    <div class="card"><div class="lbl">${CV.dir === 'u2a' ? 'USD' : 'ARS'}</div><input class="inp" style="border:0;padding:0;font-family:var(--serif);font-size:40px;height:56px" inputmode="decimal" value="${esc(CV.amt)}" data-in="cv:amt">
      <div class="rule" style="margin:10px 0"></div><div class="lbl">${CV.dir === 'u2a' ? 'ARS' : 'USD'}</div><div class="serif" style="font-size:40px" id="cvRes">${CV.dir === 'u2a' ? m0(res) : money(res, 'USD')}</div></div>
    <div class="lbl" style="padding:0 20px;margin:14px 0 8px">CON ${RATES[k].toUpperCase()} VENTA · TOCÁ PARA USAR OTRO</div>
    <div class="chips">${Object.entries(RATES).map(([key, l]) => `<button class="chip ${k === key ? 'on' : ''}" data-a="setRate:${key}">${l.toUpperCase()}</button>`).join('')}</div></section>
  <section class="sec">${Object.entries(RATES).filter(([key]) => key !== k).map(([key, l]) => { const dd = fxDelta(key); return `<button class="row" data-a="setRate:${key}"><div class="tx"><div class="t1">Dólar ${l}</div><div class="t2">COMPRA ${S.fx?.[key] ? nf0.format(S.fx[key].compra) : '—'}</div></div><div class="am">${S.fx?.[key] ? m0(S.fx[key].venta) : '—'}${dd != null ? `<small class="${dd >= 0 ? 'pos' : 'red'}">${dd >= 0 ? '+' : '−'}${nf2.format(Math.abs(dd))}%</small>` : ''}</div></button>`; }).join('')}<div class="list-end"></div></section>
  <p class="mute3 pad" style="font-size:11.5px;margin-top:14px">Fuente: DolarApi.com. Esta cotización se usa para pasar todo a pesos y a dólares en la app.</p>`;
}

// ── Recurrentes ──
function scrRecur() {
  const rec = recurrents(), t = today(), m = ymOf(t);
  const monthly = rec.reduce((s, r) => s + r.amount, 0), b = K.budgets?.total;
  const charges = {};
  for (const r of rec) charges[+r.next.slice(8)] = ymOf(r.next) === m ? 'fut' : charges[+r.next.slice(8)];
  for (const r of rec) for (const x of MOVS) if (ymOf(x.day) === m && x.kind === 'gasto' && (r.key === `k|${mkey(x)}` || r.key === `p|${Math.round(-arsOf(x) / 1000)}`)) charges[+x.day.slice(8)] ||= 'past';
  const first = (dow(`${m}-01`) + 6) % 7, n = dim(m), todayN = +t.slice(8);
  const cells = Array.from({ length: first }, () => '<span style="border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line)"></span>').join('')
    + Array.from({ length: n }, (_, i) => { const d = i + 1, c = charges[d]; const cls = d === todayN ? 'today' : c === 'fut' && d > todayN ? 'hit' : d > todayN ? 'fut' : ''; return `<span class="${cls}">${d}${c && d !== todayN && cls !== 'hit' ? '<i></i>' : ''}</span>`; }).join('');
  return `${header('Recurrentes')}
  <section class="pad" style="display:flex;justify-content:space-between;align-items:flex-end"><div><div class="lbl">FIJOS POR MES</div><div class="big" style="font-size:46px;margin-top:6px">${m0(monthly)}</div></div>${b ? `<div class="lbl" style="text-align:right;line-height:1.5">${pct(monthly, b)}% DE TU<br>PRESUPUESTO</div>` : ''}</section>
  <section class="sec pad"><div class="lbl" style="display:flex;justify-content:space-between;margin-bottom:8px"><span>${monthName(m).toUpperCase()} ${m.slice(0, 4)}</span><span>${rec.length} COBROS</span></div>
    <div class="cal" style="border:0;font-size:9.5px;color:var(--mute3)">${['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO'].map(d => `<span style="border:0;height:auto;text-align:center">${d}</span>`).join('')}</div>
    <div class="cal" style="margin-top:6px">${cells}</div></section>
  <section class="sec"><div class="sec-h"><span class="lbl">PRÓXIMOS</span></div>
    ${rec.length ? rec.map(r => `<div class="row"><div class="ic mono" style="font-size:10px;flex-direction:column;line-height:1.1">${+r.next.slice(8)}<span style="font-size:8px;color:var(--mute2)">${MES3[+r.next.slice(5, 7) - 1]}</span></div><button class="tx" style="text-align:left" data-a="go:mov:${esc(r.last.id)}"><div class="t1">${esc(r.name)}</div><div class="t2">${r.inDays === 0 ? 'HOY' : r.inDays === 1 ? 'MAÑANA' : `EN ${r.inDays} DÍAS`} · ${esc(catName(r.cat).toUpperCase())}</div></button><div class="am">${m0(r.amount)}</div><button class="iconbtn" style="width:36px;height:36px" data-a="hideRec:${esc(r.key)}" aria-label="No es fijo">${ic('x', 14)}</button></div>`).join('') + '<div class="list-end"></div>' : '<div class="empty">Todavía no detecté gastos fijos. Aparecen cuando un mismo cobro se repite dos meses.</div>'}</section>`;
}

// ── Tu progreso ──
function scrProgreso() {
  const G = game(), lv = G.lv, sk = streak(), t = today(), m = ymOf(t), hd = hormigaDays(), f = firstDay();
  const ticks = Array.from({ length: 30 }, (_, i) => `<span style="width:2px;height:${i % 5 ? 10 : 14}px;background:${i / 30 < (G.xp - lv.from) / (lv.to - lv.from) ? 'var(--acc)' : 'var(--line2)'}"></span>`).join('');
  const first = (dow(`${m}-01`) + 6) % 7;
  const grid = Array.from({ length: first }, () => '<span></span>').join('') + Array.from({ length: dim(m) }, (_, i) => {
    const d = `${m}-${String(i + 1).padStart(2, '0')}`;
    const c = d === t ? 't' : d > t ? 'f' : d < f ? 'p' : hd.has(d) ? 'h' : 'c';
    return `<span class="${c}" title="${d}"></span>`;
  }).join('');
  const ms = missions(weekStart(t));
  return `${header('Tu progreso')}
  <section class="pad" style="display:flex;gap:20px;align-items:flex-end;padding-bottom:18px;border-bottom:1px solid var(--line);margin:0 20px;padding-left:0;padding-right:0">
    <div><div class="lbl">NIVEL</div><div class="serif" style="font-size:96px;line-height:.9;letter-spacing:-3px">${lv.L}</div></div>
    <div style="flex:1;display:flex;flex-direction:column;gap:8px;padding-bottom:6px"><span class="serif" style="font-size:22px">${esc(lv.name)}</span>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;height:14px">${ticks}</div>
      <span class="mono mute" style="font-size:10px;letter-spacing:1px">${nf0.format(G.xp)} / ${nf0.format(lv.to)} XP · ${nf0.format(lv.to - G.xp)} PARA NV ${lv.L + 1}</span></div></section>
  <section class="pad" style="display:flex;gap:20px;margin-top:22px">
    <div style="width:120px;display:flex;flex-direction:column;gap:6px"><span class="lbl">RACHA</span><span class="serif" style="font-size:44px;line-height:1">${sk.cur}<span class="mute" style="font-size:20px"> día${sk.cur === 1 ? '' : 's'}</span></span><span class="mute" style="font-size:12.5px;line-height:1.4">sin gastos hormiga. Tu récord es ${sk.best}.</span></div>
    <div style="flex:1"><div class="streak mono" style="font-size:8.5px;color:var(--mute3);text-align:center;margin-bottom:4px">${'LMMJVSD'.split('').map(x => `<span style="height:auto">${x}</span>`).join('')}</div><div class="streak">${grid}</div>
      <div class="mono mute3" style="font-size:9px;margin-top:8px;letter-spacing:1px"><span class="gold">■</span> HORMIGA · <span class="acc">■</span> HOY · MENOS DE ${m0(hormigaLimit())}</div></div></section>
  <section class="sec"><div class="sec-h"><span class="lbl">MISIONES DE LA SEMANA</span><span class="lbl">CIERRA EL DOMINGO</span></div>
    ${ms.map(x => `<div class="mission ${x.done ? 'done' : ''}"><div class="mt"><span>${esc(x.title)}</span><b>+${x.xp} XP</b></div><div style="margin:10px 0 6px">${bar(x.p, x.done ? 'g' : x.failed ? 'r' : '')}</div><div class="lbl" style="font-size:9.5px">${esc(x.sub)}</div></div>`).join('')}<div class="list-end"></div></section>
  <section class="sec"><div class="sec-h"><span class="lbl">LOGROS · ${G.ach.filter(a => a.on).length}/${G.ach.length}</span></div>
    <div class="ach">${G.ach.map(a => `<div class="${a.on ? '' : 'off'}" title="${esc(a.desc)}">${ic(a.on ? a.icon : 'lock', 22)}<span>${esc(a.name)}</span></div>`).join('')}</div></section>
  <section class="sec pad"><div class="lbl" style="margin-bottom:8px">CÓMO SE GANA XP</div><div class="mute" style="font-size:13px;line-height:1.7">+5 por cada movimiento que revisás o cargás a mano · +15 por día sin gastos hormiga · misiones semanales · +150 por mes en verde · +400 por mes bajo presupuesto · +300 por meta cumplida · +100 por logro.</div></section>`;
}

// ── Reglas y revisión (pantalla "Reglas Mercado Pago") ──
function scrReglas() {
  const m = ymOf(today()), sync = K.sync || {};
  const mov = MOVS.filter(x => x.day.startsWith(m) && live(x) && x.source !== 'manual');
  const auto = mov.filter(x => !x.review || x.user_edited).length;
  const pend = MOVS.filter(needsReview);
  const pass = passThroughs();
  return `${header('Reglas automáticas', `<button class="iconbtn" data-a="sync" aria-label="Sincronizar">${ic('sync', 17)}</button>`)}
  <section class="pad"><div class="lbl ${sync.last_errors?.length ? 'red' : 'pos'}">MERCADO PAGO · ${sync.last_errors?.length ? 'CON ERRORES' : sync.last_run ? 'CONECTADO' : 'SIN SINCRONIZAR'}</div>
    <div class="serif" style="font-size:34px;line-height:1.15;margin-top:10px">${mov.length ? `${pct(auto, mov.length)}% se categorizó solo este mes` : 'Todavía no hay movimientos este mes'}</div>
    <div class="lbl" style="margin-top:10px">${nf0.format(MOVS.length)} MOVIMIENTOS · ${syncLine().replace('MERCADO PAGO · ', '')}</div>
    ${(sync.last_errors || []).map(e => `<div class="alert bad" style="margin:12px 0 0;width:100%">${esc(e)}</div>`).join('')}</section>
  ${pass.length ? `<section class="sec"><div class="sec-h"><span class="lbl">¿PASAMANOS? · ${pass.length}</span></div>${pass.map(([a, b]) => `<div style="border-top:1px solid var(--line);padding:14px 20px"><div style="font-size:14.5px">${esc(title(a))} → ${esc(title(b))}</div><div class="lbl" style="margin-top:4px">${m0(a.amount)} · ${dayLabel(a.day)}</div><div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" style="height:40px" data-a="passReal:${esc(a.id)}:${esc(b.id)}">Son reales</button><button class="btn" style="height:40px" data-a="passIgnore:${esc(a.id)}:${esc(b.id)}">Ignorar los dos</button></div></div>`).join('')}<div class="list-end"></div></section>` : ''}
  <section class="sec"><div class="sec-h"><span class="lbl">PARA REVISAR · ${pend.length}</span></div>
    ${pend.length ? pend.slice(0, 40).map(x => `<div style="border-top:1px solid var(--line);padding:14px 20px"><div style="display:flex;justify-content:space-between;gap:10px"><span class="mono" style="font-size:12.5px;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((x.counterparty || x.description || title(x)).toUpperCase())}</span><span class="mono">${money(x.amount, x.currency, { sign: true })}</span></div>
      <div class="mute" style="font-size:13px;margin-top:4px">Sugerida: ${esc(catOf(x).name)}${x.kind === 'gasto' ? ` · ${x.essential === 0 ? 'Capricho' : 'Necesario'}` : ''} · ${dayLabel(x.day).toLowerCase()}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button class="btn ghost" style="height:40px" data-a="go:mov:${esc(x.id)}">Cambiar</button><button class="btn" style="height:40px" data-a="confirm:${esc(x.id)}">Confirmar</button></div></div>`).join('') + '<div class="list-end"></div>' : '<div class="empty">Nada para revisar. Todo en orden.</div>'}</section>
  <section class="sec"><div class="sec-h"><span class="lbl">TUS REGLAS</span></div>
    ${(S.data?.rules || []).length ? S.data.rules.map(r => `<div class="row"><div class="tx"><div class="t1 mono" style="font-size:13px">${esc(r.pattern.toUpperCase())}* → ${esc(r.kind === 'interno' ? 'Interno' : r.kind === 'descartado' ? 'Ignorar' : catName(r.category))}</div></div><button class="iconbtn" style="width:36px;height:36px" data-a="delRule:${esc(r.id)}" aria-label="Borrar regla">${ic('trash', 14)}</button></div>`).join('') + '<div class="list-end"></div>' : '<div class="empty">Cuando corregís un movimiento podés tildar "aplicar siempre" y la regla aparece acá.</div>'}</section>`;
}
function scrAlertas() {
  const al = alerts();
  return `${header('Avisos')}${al.length ? al.map(a => `<button class="alert ${a.lvl === 'bad' ? 'bad' : a.lvl === 'warn' ? 'warn' : ''}" data-a="${esc(a.a)}">${esc(a.text)}</button>`).join('') : '<div class="empty">No hay nada que te tenga que avisar. Todo tranqui.</div>'}
  <div class="pad" style="margin-top:20px"><button class="btn ghost" data-a="go:ajustes">${ic('gear', 16)} Ajustes</button></div>`;
}
function scrResumen({ m }) {
  const st = monthStats(m), cats = Object.entries(st.cats).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return `${header(`${cap1(monthName(m))} ${m.slice(0, 4)}`)}
  <section class="pad"><div class="lbl">TE QUEDÓ</div><div class="big ${st.ahorro >= 0 ? 'pos' : 'red'}" style="font-size:56px;margin-top:8px">${money(st.ahorro, 'ARS', { sign: true, dec: false })}</div>
    <div class="mute" style="margin-top:8px">${st.ing ? `${pct(st.ahorro, st.ing)}% de lo que entró` : ''}</div>
    <div style="margin-top:18px"><div class="kv"><span class="mute">Entró</span><b class="mono" style="font-weight:400">${m0(st.ing)}</b></div><div class="kv"><span class="mute">Gastaste</span><b class="mono" style="font-weight:400">${m0(st.gas)}</b></div><div class="kv"><span class="mute">Necesarios / caprichos</span><b class="mono" style="font-weight:400">${pct(st.nec, st.gas)}% / ${pct(st.cap, st.gas)}%</b></div>${K.budgets?.total ? `<div class="kv"><span class="mute">Presupuesto</span><b class="mono ${st.gas <= K.budgets.total ? 'pos' : 'red'}" style="font-weight:400">${st.gas <= K.budgets.total ? 'CUMPLIDO' : 'PASADO'}</b></div>` : ''}</div></section>
  <section class="sec pad"><div class="lbl" style="margin-bottom:8px">EN QUÉ SE FUE</div>${cats.map(([c, v]) => `<div style="padding:10px 0;border-top:1px solid var(--line)"><div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:8px"><span>${esc(catName(c))}</span><span class="mono">${m0(v)}</span></div>${bar(v / cats[0][1], catEssential(c) ? 'w' : 'y')}</div>`).join('')}</section>
  <div class="pad" style="margin-top:22px"><button class="btn ghost" data-a="mvMonth:${m}">Ver los movimientos</button></div>`;
}
function scrAjustes() {
  const sync = K.sync || {};
  return `${header('Ajustes')}
  <section class="pad"><div class="lbl">MERCADO PAGO</div>
    <div class="kv"><span class="mute">Última sincronización</span><b class="mono" style="font-weight:400">${sync.last_run ? `${dayLabel(dayOf(sync.last_run))} ${hhmm(sync.last_run)}` : '—'}</b></div>
    <div class="kv"><span class="mute">Último reporte del banco</span><b class="mono" style="font-weight:400">${sync.report_at ? dayLabel(dayOf(sync.report_at)) : 'EN CAMINO'}</b></div>
    ${(sync.last_errors || []).map(e => `<div class="alert bad" style="margin:8px 0;width:100%">${esc(e)}</div>`).join('')}
    <button class="btn ghost" style="margin-top:10px" data-a="sync">${ic('sync', 16)} Sincronizar ahora</button>
    <p class="mute3" style="font-size:12px;line-height:1.5">Se sincroniza solo cada 2 horas. Las transferencias a otros bancos y los rendimientos llegan con el reporte diario (1 a 3 días de atraso).</p></section>
  <section class="sec pad"><div class="lbl">GASTO HORMIGA</div><div class="mute" style="font-size:13px;margin:6px 0 10px">Capricho de menos de este monto. Corta la racha.</div>
    <div style="display:flex;gap:8px"><input class="inp" id="hormiga" inputmode="numeric" value="${hormigaLimit()}"><button class="btn" style="width:120px" data-a="saveHormiga">Guardar</button></div></section>
  <section class="sec pad"><div class="lbl" style="margin-bottom:10px">ACCESOS</div>
    <button class="btn ghost" data-a="go:bolsillo:mp">${ic('wallet', 16)} Saldos de mis bolsillos</button>
    <button class="btn ghost" style="margin-top:8px" data-a="go:analisis:pres">${ic('chart', 16)} Presupuesto</button>
    <button class="btn ghost" style="margin-top:8px" data-a="go:reglas">${ic('check', 16)} Reglas y pendientes</button></section>
  <section class="sec pad"><div class="lbl" style="margin-bottom:10px">BACKUP</div>
    <button class="btn ghost" data-a="exportJson">${ic('down', 16)} Exportar JSON</button>
    <label class="btn ghost" style="margin-top:8px">${ic('up', 16)} Importar JSON<input type="file" accept="application/json,.json" data-ch="importFile" style="display:none"></label>
    <div id="importPrev"></div></section>
  <p class="mono mute3 pad" style="font-size:10.5px;letter-spacing:1px;margin-top:26px">FINTRACK ${APP_VERSION} · DATOS EN TU CLOUDFLARE · COTIZACIONES DOLARAPI</p>`;
}

const SCREENS = { inicio: scrInicio, movs: scrMovs, analisis: scrAnalisis, ahorros: scrAhorros, mov: scrMov, cargar: scrCargar, bolsillo: scrBolsillo, meta: scrMeta, cotiz: scrCotiz, recur: scrRecur, progreso: scrProgreso, reglas: scrReglas, alertas: scrAlertas, ajustes: scrAjustes, resumen: scrResumen };

/* ═══ Acciones ═════════════════════════════════════════════ */
const A = {
  tab(t) { if (t === TAB) STACKS[t] = [STACKS[t][0]]; TAB = t; render(); scrollTo(0, 0); vib(); },
  go(p, arg) {
    const ctx = p === 'mov' ? { id: arg } : p === 'bolsillo' ? { id: arg } : p === 'meta' ? { id: arg } : p === 'resumen' ? { m: arg } : {};
    if (p === 'analisis') { AN.t = typeof arg === 'string' ? arg : AN.t; if (arg === 'pres') PB = null; return A.tab('analisis'); }
    if (p === 'mov') ED = null;
    go(p, ctx);
  },
  back() { back(); },
  cargar(preset) { preset = typeof preset === 'string' ? preset : undefined; if (cur().p === 'cargar' && !preset) return; CG = null; go('cargar', { preset }); },
  closeCine,
  async sync() {
    if (S.syncing) return;
    S.syncing = true; softRender();
    try {
      const r = await api('/api/sync', { method: 'POST' });
      await loadState();
      toast(r.skipped ? r.message : r.ok ? 'Listo, todo al día.' : 'Sincronicé, pero hubo errores.');
    } catch (e) { toast(e.message); }
    S.syncing = false; softRender(); celebrate();
  },
  mv(k, v) {
    if (k === 't') { MV.t = v; MV.f = 'todos'; MV.c = ''; }
    if (k === 'f') MV.f = MV.f === v ? 'todos' : v;
    if (k === 'm') { const nm = addMonths(MV.m, +v); if (nm <= ymOf(today())) MV.m = nm; }
    render(); vib();
  },
  mvMonth(m) { MV.m = m; MV.t = 'todo'; A.tab('movs'); },
  catMovs(c) { MV.m = ymOf(today()); MV.t = 'gastos'; MV.f = 'todos'; MV.c = c; A.tab('movs'); },
  an(t) { AN.t = t; PB = null; render(); },
  ed(k, v, el) {
    if (k === 'kind') { ED.kind = v; if (v === 'gasto' && !inKind(ED.category, 'gasto')) { ED.category = 'otros'; ED.essential = 1; } if (v === 'ingreso' && !inKind(ED.category, 'ingreso')) ED.category = 'otros_ingreso'; }
    if (k === 'cat') { ED.category = v; if (ED.kind === 'gasto') ED.essential = catEssential(v) ? 1 : 0; }
    if (k === 'ess') ED.essential = +v;
    if (k === 'link') ED.linked_id = ED.linked_id === v ? '' : v;
    if (k === 'rule') ED.rule = !ED.rule;
    const y = scrollY; render(); scrollTo(0, y); vib();
  },
  async saveMov(el) {
    const m = BYID[ED.id];
    if (ED.kind === 'reintegro' && !ED.linked_id) return toast('Elegí de qué gasto es la parte.');
    const body = { kind: ED.kind, note: ED.note.trim() || null };
    if (ED.kind === 'gasto' || ED.kind === 'ingreso') body.category = ED.category; else body.category = null;
    body.essential = ED.kind === 'gasto' ? ED.essential !== 0 : null;
    body.linked_id = ED.kind === 'reintegro' ? ED.linked_id : null;
    if (m.source === 'manual') { body.amount = parseAmt(ED.amount); body.description = ED.description; body.day = ED.day; if (!(body.amount > 0)) return toast('Monto inválido.'); }
    if (ED.rule && ED.pattern.trim().length >= 3) body.rule = { pattern: ED.pattern.trim() };
    try {
      const r = await api(`/api/movements/${encodeURIComponent(ED.id)}`, { method: 'PATCH', body });
      if (r.applied) await loadState(); else upsertLocal(r.movement);
      toast(r.applied ? `Guardado. La regla ordenó ${r.applied} más.` : 'Guardado.');
      ED = null; back(); celebrate(el);
    } catch (e) { toast(e.message); }
  },
  async delMov() {
    if (!confirmTwice('delMov')) return toast('Tocá de nuevo para borrar.');
    try {
      await api(`/api/movements/${encodeURIComponent(ED.id)}`, { method: 'DELETE' });
      S.data.movements = S.data.movements.filter(x => x.id !== ED.id); setData(S.data); LS.set('ft2_cache', S.data);
      ED = null; toast('Borrado.'); back();
    } catch (e) { toast(e.message); }
  },
  async confirm(id, el) {
    const m = BYID[id];
    try {
      const r = await api(`/api/movements/${encodeURIComponent(id)}`, { method: 'PATCH', body: { kind: m.kind, category: m.category, essential: m.kind === 'gasto' ? m.essential !== 0 : null } });
      upsertLocal(r.movement); render(); celebrate(el); vib();
    } catch (e) { toast(e.message); }
  },
  async passIgnore(a, b, el) {
    try {
      for (const id of [a, b]) upsertLocal((await api(`/api/movements/${encodeURIComponent(id)}`, { method: 'PATCH', body: { kind: 'descartado', category: null } })).movement);
      render(); celebrate(el);
    } catch (e) { toast(e.message); }
  },
  async passReal(a, b, el) {
    try {
      for (const id of [a, b]) { const m = BYID[id]; upsertLocal((await api(`/api/movements/${encodeURIComponent(id)}`, { method: 'PATCH', body: { kind: m.kind, category: m.category } })).movement); }
      render(); celebrate(el);
    } catch (e) { toast(e.message); }
  },
  async delRule(id) {
    try { await api(`/api/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }); S.data.rules = S.data.rules.filter(r => r.id !== id); CACHE = {}; render(); toast('Regla borrada. Los movimientos ya ordenados quedan como están.'); } catch (e) { toast(e.message); }
  },
  cg(k, v) {
    if (k === 'kind') { CG.kind = v; CG.category = null; CG.picked = false; CG.essential = null; }
    if (k === 'cur') { CG.currency = v; if (v === 'USDC' && CG.pocket === 'efectivo') CG.pocket = 'binance'; }
    if (k === 'cat') { CG.category = v; CG.picked = true; CG.essential = null; }
    if (k === 'ess') CG.essential = v === '1';
    if (k === 'preset') { CG = newCG(v); }
    const y = scrollY; render(); scrollTo(0, y); vib();
  },
  async saveCG(el) {
    const amount = parseAmt(CG.amount);
    if (!(amount > 0)) return toast('Poné un monto.');
    if (!CG.category) return toast('Elegí una categoría.');
    const p = pockets().find(x => x.id === CG.pocket);
    if (p && p.currency !== CG.currency) return toast(`${p.name} es en ${p.currency}. Cambiá la moneda o la cuenta.`);
    const ess = CG.essential ?? catEssential(CG.category);
    try {
      const r = await api('/api/movements', { method: 'POST', body: { kind: CG.kind, amount, currency: CG.currency, category: CG.category, essential: CG.kind === 'gasto' ? ess : null, description: CG.description.trim(), day: CG.day, pocket: CG.pocket } });
      upsertLocal(r.movement);
      toast(`${CG.kind === 'gasto' ? 'Gasto' : 'Ingreso'} guardado.`);
      CG = null; back(); celebrate(el);
    } catch (e) { toast(e.message); }
  },
  async savePres() {
    const total = parseAmt(PB.total);
    const cats = {};
    for (const [k, v] of Object.entries(PB.cats)) { const n = parseAmt(v); if (n > 0) cats[k] = n; }
    await saveKv('budgets', { total: total > 0 ? total : null, cats });
    PB = null; toast('Presupuesto guardado.'); render(); celebrate();
  },
  async savePocket(id) {
    const list = pockets().map(p => ({ ...p }));
    const p = list.find(x => x.id === id);
    const amt = parseAmt($('#pkAmt')?.value);
    const name = $('#pkName')?.value.trim();
    if (name) p.name = name.slice(0, 40);
    const rt = parseAmt($('#pkRate')?.value);
    if (rt >= 0 && $('#pkRate')) p.rate = rt;
    if (Number.isFinite(amt)) {
      p.anchor = { amount: amt, ts: new Date().toISOString() };
      p.snaps = [...(p.snaps || []), { day: today(), amount: amt }].filter((s, i, a) => i === a.length - 1 || s.day !== a[a.length - 1].day).slice(-60);
    }
    await saveKv('pockets', list);
    toast('Guardado.'); back(); celebrate();
  },
  async saveGoal(id) {
    const target = parseAmt($('#gTarget').value);
    const name = $('#gName').value.trim();
    if (!name || !(target > 0)) return toast('Poné nombre y objetivo.');
    const g = { id: id === 'new' ? `g${Date.now().toString(36)}` : id, name: name.slice(0, 40), target, currency: $('#gCur').value, pocket: $('#gPocket').value || null, amount: parseAmt($('#gAmount').value) || 0 };
    await saveKv('goals', [...goals().filter(x => x.id !== g.id), g]);
    toast('Meta guardada.'); back(); celebrate();
  },
  async delGoal(id) {
    if (!confirmTwice('goal' + id)) return toast('Tocá de nuevo para borrar.');
    await saveKv('goals', goals().filter(x => x.id !== id));
    back();
  },
  setRate(k) { saveKv('prefs', { ...(K.prefs || {}), rate: k }); render(); vib(); },
  cv(k) { if (k === 'flip') { CV.dir = CV.dir === 'u2a' ? 'a2u' : 'u2a'; render(); } },
  async hideRec(key) { await saveKv('prefs', { ...(K.prefs || {}), recur_hidden: [...(K.prefs?.recur_hidden || []), key] }); render(); toast('Listo, ese no lo cuento como fijo.'); },
  async saveHormiga() { const n = parseAmt($('#hormiga').value); if (!(n > 0)) return toast('Monto inválido.'); await saveKv('prefs', { ...(K.prefs || {}), hormiga: n }); toast('Guardado.'); render(); },
  async exportJson() {
    try {
      const d = await api('/api/export');
      const file = new File([JSON.stringify(d, null, 2)], `fintrack_backup_${today()}.json`, { type: 'application/json' });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: 'Backup FinTrack' });
      else { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
    } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  },
  async doImport() {
    try { const r = await api('/api/import', { method: 'POST', body: IMPORT }); IMPORT = null; await loadState(); toast(`Importado: ${r.movements} movimientos y ${r.rules} reglas.`); render(); } catch (e) { toast(e.message); }
  },
};
const INPUT = {
  mvQ(v) { MV.q = v; clearTimeout(INPUT.t); INPUT.t = setTimeout(() => { const el = document.activeElement; render(); const n = document.querySelector('[data-in="mvQ"]'); if (el?.dataset.in === 'mvQ' && n) { n.focus(); n.setSelectionRange(v.length, v.length); } }, 250); },
  ed(k, v) { ED[k] = v; },
  cg(k, v) {
    CG[k] = v;
    if (k === 'amount') { const n = parseAmt(v); const el = $('#cgConv'); if (el) el.innerHTML = n > 0 ? (CG.currency === 'ARS' ? `≈ ${money(n / rate(), 'USD')} AL ${RATES[rateKey()].toUpperCase()}` : `≈ ${m0(n * rate())} AL ${RATES[rateKey()].toUpperCase()}`) : '&nbsp;'; }
    if (k === 'description') { const el = $('#cgCats'); if (el) el.innerHTML = cgCats(); const e2 = $('#cgEss'); if (e2) e2.innerHTML = cgEss(); }
  },
  pb(k, v) { if (k === 'total') PB.total = v; else PB.cats[k] = v; },
  cv(k, v) { CV.amt = v; const n = parseAmt(v) || 0; const el = $('#cvRes'); if (el) el.textContent = CV.dir === 'u2a' ? m0(n * rate()) : money(n / rate(), 'USD'); },
};
let IMPORT = null;
const CHANGE = {
  mvCat(v) { MV.c = v; render(); },
  cgPocket(v) { CG.pocket = v; const p = pockets().find(x => x.id === v); if (p && p.currency !== CG.currency) { CG.currency = p.currency; render(); } },
  importFile(_, el) {
    const f = el.files?.[0];
    if (!f) return;
    f.text().then(txt => {
      let d;
      try { d = JSON.parse(txt); } catch { return toast('Ese archivo no es un JSON.'); }
      if (d?.app !== 'fintrack' || d.version !== 1 || !Array.isArray(d.movements)) return toast('No es un backup de FinTrack.');
      const mine = d.movements.filter(m => m.source === 'manual' || m.user_edited);
      const days = d.movements.map(m => m.day).filter(Boolean).sort();
      IMPORT = d;
      $('#importPrev').innerHTML = `<div class="card" style="margin:12px 0 0"><div class="lbl">VISTA PREVIA</div><div style="font-size:14px;line-height:1.6;margin-top:8px">${mine.length} movimientos tuyos (cargados o corregidos) · ${(d.rules || []).length} reglas · del ${days[0] || '—'} al ${days[days.length - 1] || '—'}. Lo de Mercado Pago vuelve solo con la sincronización.</div><button class="btn" style="margin-top:12px" data-a="doImport">Importar</button></div>`;
    });
    el.value = '';
  },
};
const _twice = {};
function confirmTwice(k) { const now = Date.now(); if (_twice[k] && now - _twice[k] < 3000) { delete _twice[k]; return true; } _twice[k] = now; return false; }

document.addEventListener('click', e => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  if (el.tagName === 'A') e.preventDefault();
  const [fn, ...args] = el.dataset.a.split(':');
  if (A[fn]) A[fn](...args, el, e);
});
document.addEventListener('input', e => {
  const el = e.target.closest('[data-in]');
  if (!el) return;
  const [fn, k] = el.dataset.in.split(':');
  if (INPUT[fn]) k === undefined ? INPUT[fn](el.value) : INPUT[fn](k, el.value);
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-ch]');
  if (el && CHANGE[el.dataset.ch]) CHANGE[el.dataset.ch](el.value, el);
});

/* ═══ Arranque ═════════════════════════════════════════════ */
async function boot() {
  const cached = LS.get('ft2_cache', null);
  if (cached?.movements) { setData(cached); render(); }
  try {
    await loadState();
    render();
  } catch (e) {
    if (!cached) $('#app').innerHTML = `<div class="empty">No pude cargar tus datos.<br>${esc(e.message)}</div>`;
    else toast('Sin conexión: te muestro lo último que tenía.');
  }
  $('#splash')?.classList.add('off');
  setTimeout(() => $('#splash')?.remove(), 500);
  fetchFx();
  if (S.loaded) {
    celebrate();
    const last = K.sync?.last_run;
    if (!last || Date.now() - Date.parse(last) > 15 * 60e3) A.sync();
  }
}
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.loaded && Date.now() - Date.parse(K.sync?.last_run || 0) > 15 * 60e3) A.sync();
});
boot();
