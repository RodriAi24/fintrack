'use strict';
// FinTrack · versión provisoria mientras se construye la app completa (ver CLAUDE.md, "Estado actual").
// Muestra el estado de la sincronización con Mercado Pago y permite sincronizar a mano.

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const time = ts => ts ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(ts)) : '—';

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const d = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
  if (!res.ok || d.ok === false) throw new Error(d.error || `HTTP ${res.status}`);
  return d;
}

async function render() {
  const app = $('#app');
  try {
    const d = await api('/api/state');
    const movs = d.movements.filter(m => m.kind !== 'descartado');
    const sync = d.kv.sync || {};
    const review = movs.filter(m => m.review).length;
    app.innerHTML = `
      <div class="top"><div class="brand"><svg width="30" height="30" viewBox="0 0 30 30" fill="none"><rect width="30" height="30" rx="3" fill="#4157FF"/><path d="M9 23V7h12M9 14.5h8" stroke="#EEEAE2" stroke-width="2.6" stroke-linecap="square"/><path d="M13 23l5-5 2.5 2.5L25 15" stroke="#EEEAE2" stroke-width="1.6" stroke-linecap="square"/></svg><span>FINTRACK</span></div></div>
      <div class="pad">
        <div class="lbl">EN CONSTRUCCIÓN</div>
        <p style="font-family:var(--serif);font-size:28px;line-height:1.2;margin:10px 0 24px">La app nueva está en camino. Mientras, Mercado Pago ya se sincroniza solo.</p>
        <div class="kv"><span class="mute">Movimientos guardados</span><b class="mono">${nf.format(movs.length)}</b></div>
        <div class="kv"><span class="mute">Para revisar</span><b class="mono">${nf.format(review)}</b></div>
        <div class="kv"><span class="mute">Última sincronización</span><b class="mono">${time(sync.last_run)}</b></div>
        <div class="kv"><span class="mute">Último reporte bajado</span><b class="mono">${time(sync.report_at)}</b></div>
        ${(sync.last_errors || []).map(e => `<div class="alert bad" style="margin:12px 0 0;width:100%">${esc(e)}</div>`).join('')}
        <button class="btn" id="sync" style="margin-top:24px">Sincronizar ahora</button>
      </div>
      <div class="sec">${movs.slice(0, 15).map(m => `
        <div class="row"><div class="tx"><div class="t1">${esc(m.counterparty || m.description || m.op || 'Movimiento')}</div>
        <div class="t2">${esc([m.kind, m.category, m.day].filter(Boolean).join(' · '))}</div></div>
        <div class="am ${m.amount > 0 ? 'pos' : ''}">${m.amount < 0 ? '−' : '+'}$${nf.format(Math.abs(m.amount))}</div></div>`).join('')}
        <div class="list-end"></div></div>`;
    $('#sync').onclick = async () => {
      $('#sync').disabled = true;
      try {
        const r = await api('/api/sync', { method: 'POST' });
        if (r.skipped) alert(r.message);
      } catch (e) {
        alert(e.message);
      }
      render();
    };
  } catch (e) {
    app.innerHTML = `<div class="empty">No pude cargar los datos: ${esc(e.message)}</div>`;
  }
  $('#splash')?.classList.add('off');
}

render();
