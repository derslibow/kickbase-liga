/* Kickbase Liga – Statistikseite (mobile-first, ohne Build-Schritt) */

const CDN = 'https://kickbase.b-cdn.net/';
const COLORS = ['#ff3b3b', '#3b9bff', '#2fd27a', '#f5c542', '#b46bff', '#ff8a3b', '#21d4d4', '#ff5fb0', '#9bd13b', '#c9d1dc', '#8a6bff', '#ffb3a1', '#4e7dff', '#e0e05a', '#5affc8', '#ff2fd2', '#a0a0ff', '#ffd08a'];
const POS = { 1: 'TW', 2: 'ABW', 3: 'MF', 4: 'ST' };

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString('de-DE'));
const money = (n, sign = false) => {
  if (n == null || isNaN(n)) return '–';
  const a = Math.abs(n);
  const s = a >= 1e6 ? (a / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: a >= 1e8 ? 0 : 1 }) + ' Mio' : a >= 1e3 ? Math.round(a / 1e3).toLocaleString('de-DE') + ' Tsd' : Math.round(a).toString();
  return (n < 0 ? '−' : sign && n > 0 ? '+' : '') + s + ' €';
};
const img = (path) => (path ? CDN + path : '');
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let D = null; // Rohdaten
let S = null; // berechnete Statistiken
let chart = null;

/* ---------------- Daten laden & auswerten ---------------- */

async function load() {
  try {
    const r = await fetch('data/league.json?v=' + Math.floor(Date.now() / 60000));
    if (!r.ok) throw new Error('Daten nicht gefunden (' + r.status + ')');
    D = await r.json();
    S = compute(D);
    header();
    route();
  } catch (e) {
    view.innerHTML = `<div class="error">⚠️ Daten konnten nicht geladen werden.<br><small>${esc(e.message)}</small></div>`;
  }
}

function compute(D) {
  const mgr = {};
  D.managers.forEach((m, i) => {
    mgr[m.id] = { ...m, color: COLORS[i % COLORS.length], days: [], wins: 0, second: 0, third: 0, last: 0, zero: 0, podium: 0, total: 0, best: null, worst: null, players: {}, transfers: [], realized: 0, open: 0 };
  });

  const finished = D.finalDays ?? (D.currentDayFinished ? D.currentDay : D.currentDay - 1);
  const dayStats = [];

  for (const d of D.days) {
    const rows = d.rows.filter((r) => mgr[r.u]);
    if (!rows.length) continue;
    const isFinal = d.day <= finished;
    const played = rows.some((r) => r.mdp > 0);
    const maxPl = Math.max(...rows.map((r) => r.mdpl || 0));
    const top = [...rows].sort((a, b) => b.mdp - a.mdp);
    dayStats.push({ day: d.day, isFinal, played, winner: top[0], loser: top[top.length - 1], avg: rows.reduce((s, r) => s + r.mdp, 0) / rows.length, rows });

    for (const r of rows) {
      const m = mgr[r.u];
      // Punkte je Spieler für diesen Manager
      const lineup = r.lp.map((pid) => ({ pid, p: D.players[pid]?.pts?.[d.day] ?? null }));
      // Spieltag mit 0 Punkten gewertet (z. B. negativer Kontostand): Spieler bringen dann nichts
      const voided = isFinal && played && r.mdp === 0 && lineup.some((l) => l.p);
      if (!voided) for (const { pid, p } of lineup) {
        const e = (m.players[pid] ||= { pid, pts: 0, apps: 0, zero: 0 });
        if (p != null) { e.pts += p; e.apps++; if (p <= 0) e.zero++; }
      }
      m.days.push({ day: d.day, mdp: r.mdp, mdpl: r.mdpl, sp: r.sp, spl: r.spl, tv: r.tv, lineup, isFinal, maxPl, voided });
      if (!isFinal || !played) continue;
      if (r.mdpl === 1) m.wins++;
      if (r.mdpl === 2) m.second++;
      if (r.mdpl === 3) m.third++;
      if (r.mdpl <= 3) m.podium++;
      if (r.mdpl === maxPl) m.last++;
      if (r.mdp === 0) m.zero++;
      if (!m.best || r.mdp > m.best.mdp) m.best = { mdp: r.mdp, day: d.day };
      if (!m.worst || r.mdp < m.worst.mdp) m.worst = { mdp: r.mdp, day: d.day };
    }
  }

  for (const m of Object.values(mgr)) {
    const fin = m.days.filter((x) => x.isFinal && dayStats.find((s) => s.day === x.day)?.played);
    m.finCount = fin.length;
    m.avg = fin.length ? fin.reduce((s, x) => s + x.mdp, 0) / fin.length : 0;
    m.avgPl = fin.length ? fin.reduce((s, x) => s + x.mdpl, 0) / fin.length : 0;
    m.total = m.sp;
    // Siegesserie / Platz-Höchst- und Tiefstwerte
    let streak = 0, bestStreak = 0;
    for (const x of fin) { streak = x.mdpl === 1 ? streak + 1 : 0; bestStreak = Math.max(bestStreak, streak); }
    m.winStreak = bestStreak;
    const pls = m.days.map((x) => x.spl).filter(Boolean);
    m.bestRank = pls.length ? Math.min(...pls) : null;
    m.worstRank = pls.length ? Math.max(...pls) : null;
    m.playerList = Object.values(m.players).sort((a, b) => b.pts - a.pts);
    m.playerSum = m.playerList.reduce((s, p) => s + p.pts, 0);
    m.adjust = (m.sp || 0) - m.playerSum; // Boni/Abzüge, die keinem Spieler zuzuordnen sind
  }

  // Transfers: Käufe/Verkäufe je Spieler paaren
  const allDeals = [];
  for (const [uid, list] of Object.entries(D.transfers)) {
    const m = mgr[uid];
    if (!m) continue;
    const sorted = [...list].sort((a, b) => new Date(a.dt) - new Date(b.dt));
    const buys = {};
    m.buyCount = 0; m.sellCount = 0; m.spent = 0; m.earned = 0;
    for (const t of sorted) {
      if (t.tty === 1) {
        (buys[t.pi] ||= []).push(t);
        m.buyCount++; m.spent += t.trp;
      } else if (t.tty === 2) {
        m.sellCount++; m.earned += t.trp;
        const b = (buys[t.pi] || []).shift();
        if (b) {
          const deal = { uid, pi: t.pi, pn: t.pn, pim: t.pim, tid: t.tid, buy: b.trp, sell: t.trp, profit: t.trp - b.trp, from: b.dt, to: t.dt, status: 'sold' };
          deal.pts = pointsBetween(m, t.pi, b.dt, t.dt);
          m.transfers.push(deal); allDeals.push(deal); m.realized += deal.profit;
        }
      }
    }
    // Noch im Kader: aktueller Marktwert − Kaufpreis
    for (const p of D.squads[uid] || []) {
      if (p.prc == null || p.prc <= 0) continue;
      const lastBuy = (buys[p.pi] || []).slice(-1)[0];
      const deal = { uid, pi: p.pi, pn: p.pn, pim: p.pim, tid: p.tid, buy: p.prc, sell: p.mv, profit: p.mv - p.prc, from: lastBuy?.dt || null, to: null, status: 'open' };
      deal.pts = pointsBetween(m, p.pi, deal.from, null);
      m.transfers.push(deal); allDeals.push(deal); m.open += deal.profit;
    }
    m.squadValue = (D.squads[uid] || []).reduce((s, p) => s + (p.mv || 0), 0);
  }

  const managers = Object.values(mgr).sort((a, b) => (a.spl || 99) - (b.spl || 99));
  return { mgr, managers, dayStats, finished, allDeals };
}

// Punkte, die ein Spieler für einen Manager in einem Zeitraum geholt hat (über Aufstellungen)
function pointsBetween(m, pid, from, to) {
  let pts = 0;
  for (const d of m.days) for (const l of d.lineup) if (l.pid === String(pid) && l.p != null) pts += l.p;
  return pts; // Aufstellungen sind eindeutig dem Manager zugeordnet – Zeitraum reicht hier aus
}

/* ---------------- Rahmen ---------------- */

function header() {
  $('#league-name').textContent = D.league.name || 'Kickbase Liga';
  const li = $('#league-img');
  if (D.league.img) li.src = img(D.league.img); else li.style.display = 'none';
  const upd = new Date(D.updated);
  $('#league-sub').textContent = `Spieltag ${D.currentDay}${D.currentDayFinished ? '' : ' (läuft)'} · Stand ${upd.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

const me = () => store.get('kb-me', null);

function avatar(m, cls = '') {
  if (m.img) return `<img class="avatar ${cls}" src="${img(m.img)}" alt="" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar ${cls}',textContent:'${esc(m.name[0] || '?')}'}))">`;
  return `<div class="avatar ${cls}">${esc((m.name || '?')[0])}</div>`;
}
function pimg(path) {
  return path ? `<img class="pimg" src="${img(path)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<div class="pimg"></div>`;
}
const pname = (pid) => D.players[pid]?.n || `#${pid}`;
const meBadge = (id) => (id === me() ? '<span class="me-badge">Ich</span>' : '');

function route() {
  const [, tab = 'tabelle', arg] = (location.hash || '#/tabelle').split('/');
  document.querySelectorAll('#tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab || (tab === 'manager' && a.dataset.tab === 'tabelle')));
  if (chart) { chart.destroy(); chart = null; }
  const fn = { tabelle: vTable, stats: vStats, verlauf: vHistory, transfers: vTransfers, rechner: vCalc, manager: vManager }[tab] || vTable;
  fn(arg);
  if (tab !== 'verlauf') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

/* ---------------- Tabelle ---------------- */

function vTable() {
  const last = S.dayStats.filter((d) => d.played).slice(-1)[0];
  const lead = S.managers[0]?.sp || 0;
  const prevDay = D.days.find((d) => d.day === (last?.day || 1) - 1);
  const prevRank = Object.fromEntries((prevDay?.rows || []).map((r) => [r.u, r.spl]));

  let html = '';
  if (last) {
    const w = S.mgr[last.winner.u], l = S.mgr[last.loser.u];
    html += `<div class="tiles">
      <div class="tile"><div class="lbl">🥇 Sieger Spieltag ${last.day}${last.isFinal ? '' : ' (live)'}</div><div class="val num">${fmt(last.winner.mdp)}</div><div class="who">${esc(w?.name)}</div></div>
      <div class="tile"><div class="lbl">🔦 Letzter Spieltag ${last.day}</div><div class="val num">${fmt(last.loser.mdp)}</div><div class="who">${esc(l?.name)}</div></div>
    </div>`;
  }
  html += `<h2>Gesamttabelle</h2><div class="card flush">`;
  for (const m of S.managers) {
    const pr = prevRank[m.id];
    const mv = pr && m.spl ? pr - m.spl : 0;
    const mvHtml = mv > 0 ? `<span class="move pos">▲${mv}</span>` : mv < 0 ? `<span class="move neg">▼${-mv}</span>` : '';
    const lastDay = m.days.find((x) => x.day === last?.day);
    html += `<a class="row" href="#/manager/${m.id}">
      <div class="rank r${m.spl}">${m.spl}</div>${avatar(m)}
      <div class="grow"><div class="name">${esc(m.name)}${meBadge(m.id)}${mvHtml}</div>
      <div class="meta num">${m.spl === 1 ? 'Tabellenführer' : '−' + fmt(lead - m.sp) + ' Pkt.'} · ST ${last?.day}: ${fmt(lastDay?.mdp)}</div></div>
      <div class="right"><div class="big num">${fmt(m.sp)}</div><div class="meta">Punkte</div></div><span class="chev">›</span></a>`;
  }
  html += `</div><p class="hint">Tippe auf einen Manager, um zu sehen, welche Spieler ihm wie viele Punkte gebracht haben.</p>`;
  html += foot();
  view.innerHTML = html;
}

/* ---------------- Stats ---------------- */

let statSort = store.get('kb-statsort', { k: 'wins', dir: -1 });

function vStats() {
  const ms = S.managers;
  const top = (fn, dir = -1) => [...ms].sort((a, b) => dir * (fn(a) - fn(b)))[0];
  const allDays = ms.flatMap((m) => m.days.filter((x) => x.isFinal && x.mdp != null).map((x) => ({ ...x, m })));
  const playedDays = allDays.filter((x) => S.dayStats.find((s) => s.day === x.day)?.played);
  const hi = playedDays.sort((a, b) => b.mdp - a.mdp)[0];
  const lo = [...playedDays].sort((a, b) => a.mdp - b.mdp)[0];
  const mostWins = top((m) => m.wins * 1000 + m.podium);
  const mostLast = top((m) => m.last);
  const bestAvg = top((m) => m.avg);
  const streak = top((m) => m.winStreak);

  // Bester Einzelspieler-Auftritt für einen Manager
  let bestShow = null;
  for (const m of ms) for (const d of m.days) for (const l of d.lineup) if (l.p != null && (!bestShow || l.p > bestShow.p)) bestShow = { ...l, m, day: d.day };
  // Wer hat einem Manager insgesamt am meisten gebracht
  let bestLoyal = null;
  for (const m of ms) { const p = m.playerList[0]; if (p && (!bestLoyal || p.pts > bestLoyal.pts)) bestLoyal = { ...p, m }; }

  let html = `<h2>Rekorde</h2><div class="tiles">
    ${tile('👑 Meiste Spieltagssiege', mostWins?.wins, mostWins?.name)}
    ${tile('🔥 Höchste Spieltagspunkte', fmt(hi?.mdp), hi ? `${hi.m.name} · ST ${hi.day}` : '')}
    ${tile('🧊 Wenigste Spieltagspunkte', fmt(lo?.mdp), lo ? `${lo.m.name} · ST ${lo.day}` : '')}
    ${tile('📐 Bester Schnitt', fmt(bestAvg?.avg), bestAvg?.name)}
    ${tile('🔦 Am öftesten Letzter', mostLast?.last, mostLast?.name)}
    ${tile('⚡ Längste Siegesserie', streak?.winStreak, streak?.name)}
    ${bestShow ? tile('🚀 Bester Einzelauftritt', fmt(bestShow.p), `${pname(bestShow.pid)} für ${bestShow.m.name} · ST ${bestShow.day}`) : ''}
    ${bestLoyal ? tile('🤝 Treuester Punktelieferant', fmt(bestLoyal.pts), `${pname(bestLoyal.pid)} für ${bestLoyal.m.name}`) : ''}
  </div>`;

  const cols = [
    ['name', 'Manager'], ['wins', '🥇'], ['second', '🥈'], ['third', '🥉'], ['podium', 'Podest'], ['last', 'Letzter'], ['zero', '0 Pkt.'], ['avg', 'Ø Pkt.'], ['avgPl', 'Ø Platz'], ['best', 'Bester ST'], ['worst', 'Schlechtester'],
  ];
  const val = (m, k) => (k === 'best' ? m.best?.mdp ?? -1 : k === 'worst' ? m.worst?.mdp ?? 1e9 : k === 'name' ? m.name.toLowerCase() : m[k]);
  const sorted = [...ms].sort((a, b) => {
    const va = val(a, statSort.k), vb = val(b, statSort.k);
    if (typeof va === 'string') return statSort.dir * va.localeCompare(vb);
    return statSort.dir * (va - vb) || b.wins - a.wins;
  });
  html += `<h2>Spieltags-Bilanz</h2><p class="hint">${S.finished} abgeschlossene Spieltage · Spalte antippen zum Sortieren · seitlich wischen</p>
  <div class="card flush scroll"><table><thead><tr>${cols.map(([k, l]) => `<th data-k="${k}" class="${statSort.k === k ? 'sorted' : ''}">${l}${statSort.k === k ? (statSort.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>
  ${sorted.map((m) => `<tr class="${m.id === me() ? 'me' : ''}"><td><a href="#/manager/${m.id}">${esc(m.name)}</a></td><td class="num">${m.wins}</td><td class="num">${m.second}</td><td class="num">${m.third}</td><td class="num">${m.podium}</td><td class="num">${m.last}</td><td class="num">${m.zero}</td><td class="num">${fmt(m.avg)}</td><td class="num">${m.avgPl.toFixed(1).replace('.', ',')}</td><td class="num">${fmt(m.best?.mdp)}</td><td class="num">${fmt(m.worst?.mdp)}</td></tr>`).join('')}
  </tbody></table></div>`;

  // Spieltage im Überblick
  html += `<h2>Alle Spieltage</h2><div class="card flush">`;
  for (const d of [...S.dayStats].reverse()) {
    if (!d.played) continue;
    const w = S.mgr[d.winner.u], l = S.mgr[d.loser.u];
    html += `<div class="row"><div class="rank">${d.day}</div><div class="grow"><div class="name">🥇 ${esc(w?.name)} <span class="meta num">${fmt(d.winner.mdp)}</span></div><div class="meta">🔦 ${esc(l?.name)} ${fmt(d.loser.mdp)} · Ø ${fmt(d.avg)}${d.isFinal ? '' : ' · läuft'}</div></div></div>`;
  }
  html += `</div>` + foot();
  view.innerHTML = html;
  view.querySelectorAll('th[data-k]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.k;
    statSort = { k, dir: statSort.k === k ? -statSort.dir : k === 'name' || k === 'avgPl' || k === 'last' || k === 'zero' ? 1 : -1 };
    store.set('kb-statsort', statSort);
    vStats();
  }));
}
const tile = (lbl, val, who) => `<div class="tile"><div class="lbl">${lbl}</div><div class="val num">${val ?? '–'}</div><div class="who">${esc(who || '')}</div></div>`;

/* ---------------- Verlauf (Platzierungs-Graph) ---------------- */

function vHistory() {
  const mode = store.get('kb-histmode', 'rank');
  let hidden = new Set(store.get('kb-hidden', []));
  const ms = S.managers;
  view.innerHTML = `
    <h2>Verlauf</h2>
    <div class="seg" id="seg"><button data-m="rank" class="${mode === 'rank' ? 'on' : ''}">Tabellenplatz</button><button data-m="points" class="${mode === 'points' ? 'on' : ''}">Gesamtpunkte</button><button data-m="md" class="${mode === 'md' ? 'on' : ''}">Spieltagsplatz</button></div>
    <div class="chips" id="who"><span class="chip" data-q="all">Alle</span><span class="chip" data-q="none">Keine</span>${me() ? '<span class="chip" data-q="me">Nur ich</span>' : ''}<span class="chip" data-q="top3">Top 3</span>${ms.map((m) => `<span class="chip ${hidden.has(m.id) ? 'off' : ''}" data-id="${m.id}"><span class="dot" style="background:${m.color}"></span>${esc(m.name)}</span>`).join('')}</div>
    <div class="card"><div class="chart-wrap"><canvas id="cv"></canvas></div></div>
    <p class="hint">Namen antippen, um Manager ein- oder auszublenden. Punkte im Graph antippen für Details.</p>` + foot();

  const draw = () => {
    if (chart) chart.destroy();
    if (!window.Chart) { setTimeout(draw, 150); return; }
    const labels = D.days.map((d) => 'ST ' + d.day);
    const datasets = ms.filter((m) => !hidden.has(m.id)).map((m) => ({
      label: m.name,
      data: D.days.map((d) => { const r = d.rows.find((x) => x.u === m.id); if (!r) return null; return mode === 'rank' ? r.spl : mode === 'md' ? (r.mdp > 0 || d.day <= S.finished ? r.mdpl : null) : r.sp; }),
      borderColor: m.color, backgroundColor: m.color,
      borderWidth: m.id === me() ? 4 : 2.5, pointRadius: 3.5, pointHoverRadius: 6, tension: mode === 'points' ? 0.25 : 0.15,
    }));
    const n = ms.length;
    chart = new Chart($('#cv'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'nearest', intersect: false },
        layout: { padding: { right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index', intersect: false, itemSort: (a, b) => (mode === 'points' ? b.parsed.y - a.parsed.y : a.parsed.y - b.parsed.y),
            callbacks: { label: (c) => ` ${c.dataset.label}: ${mode === 'points' ? fmt(c.parsed.y) + ' Pkt.' : 'Platz ' + c.parsed.y}` },
          },
        },
        scales: {
          x: { grid: { color: '#22262f' }, ticks: { color: '#9aa3b2', maxRotation: 0, autoSkip: true } },
          y: mode === 'points'
            ? { grid: { color: '#22262f' }, ticks: { color: '#9aa3b2', callback: (v) => fmt(v) } }
            : { reverse: true, min: 0.6, max: n + 0.4, afterBuildTicks: (ax) => { ax.ticks = Array.from({ length: n }, (_, i) => ({ value: i + 1 })); }, grid: { color: '#22262f' }, ticks: { color: '#9aa3b2', autoSkip: false, font: { size: 11 } } },
        },
      },
    });
  };
  draw();

  $('#seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; store.set('kb-histmode', b.dataset.m); vHistory(); });
  $('#who').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c || c.dataset.q) return;
    const id = c.dataset.id; hidden.has(id) ? hidden.delete(id) : hidden.add(id);
    store.set('kb-hidden', [...hidden]); c.classList.toggle('off'); draw();
  });
  $('#who').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c || !c.dataset.q) return;
    const q = c.dataset.q;
    if (q === 'all') hidden = new Set();
    if (q === 'none') hidden = new Set(ms.map((m) => m.id));
    if (q === 'me') hidden = new Set(ms.filter((m) => m.id !== me()).map((m) => m.id));
    if (q === 'top3') hidden = new Set(ms.filter((m) => m.spl > 3).map((m) => m.id));
    store.set('kb-hidden', [...hidden]);
    document.querySelectorAll('#who .chip[data-id]').forEach((el) => el.classList.toggle('off', hidden.has(el.dataset.id)));
    draw();
  });
}

/* ---------------- Transfers ---------------- */

function vTransfers(arg) {
  const filter = store.get('kb-tfilter', 'all');
  const deals = S.allDeals.filter((d) => filter === 'all' || d.status === filter);
  const best = [...deals].sort((a, b) => b.profit - a.profit).slice(0, 10);
  const flops = [...deals].sort((a, b) => a.profit - b.profit).filter((d) => d.profit < 0).slice(0, 10);
  const bal = [...S.managers].sort((a, b) => (b.realized + b.open) - (a.realized + a.open));

  const dealRow = (d) => {
    const m = S.mgr[d.uid];
    return `<div class="row">${pimg(d.pim)}<div class="grow"><div class="name">${esc(d.pn)}${d.status === 'open' ? '<span class="tag open">im Kader</span>' : ''}</div>
      <div class="meta">${esc(m?.name)} · ${money(d.buy)} → ${money(d.sell)}${d.pts ? ` · ${fmt(d.pts)} Pkt.` : ''}</div></div>
      <div class="right big num ${d.profit >= 0 ? 'pos' : 'neg'}">${money(d.profit, true)}</div></div>`;
  };

  let html = `<h2>Transfers</h2>
    <div class="seg" id="tf"><button data-f="all" class="${filter === 'all' ? 'on' : ''}">Alle</button><button data-f="sold" class="${filter === 'sold' ? 'on' : ''}">Verkauft</button><button data-f="open" class="${filter === 'open' ? 'on' : ''}">Noch im Kader</button></div>
    <p class="hint">Verkauft = Verkaufspreis − Kaufpreis. Im Kader = aktueller Marktwert − Kaufpreis.</p>
    <h2>💰 Beste Transfers</h2><div class="card flush">${best.map(dealRow).join('') || '<div class="empty">Noch keine Transfers.</div>'}</div>
    <h2>🗑️ Größte Flops</h2><div class="card flush">${flops.map(dealRow).join('') || '<div class="empty">Keine Verlust-Transfers 🎉</div>'}</div>
    <h2>Transfer-Bilanz je Manager</h2><div class="card flush">
    ${bal.map((m) => `<a class="row" href="#/manager/${m.id}">${avatar(m, 'sm')}<div class="grow"><div class="name">${esc(m.name)}${meBadge(m.id)}</div><div class="meta">${m.buyCount || 0} Käufe · ${m.sellCount || 0} Verkäufe · realisiert <span class="${m.realized >= 0 ? 'pos' : 'neg'}">${money(m.realized, true)}</span></div></div><div class="right"><div class="big num ${m.realized + m.open >= 0 ? 'pos' : 'neg'}">${money(m.realized + m.open, true)}</div><div class="meta">inkl. Kader</div></div></a>`).join('')}
    </div>` + foot();
  view.innerHTML = html;
  $('#tf').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; store.set('kb-tfilter', b.dataset.f); vTransfers(); });
}

/* ---------------- Manager-Detail ---------------- */

function vManager(id) {
  const m = S.mgr[id];
  if (!m) { location.hash = '#/tabelle'; return; }
  const maxPts = Math.max(1, ...m.playerList.map((p) => p.pts));
  const maxMd = Math.max(1, ...m.days.map((d) => d.mdp));
  const isMe = me() === id;

  let html = `<a class="back" href="#/tabelle">‹ Zurück</a>
  <div class="hero">${avatar(m)}<div class="grow"><h2>${esc(m.name)}${meBadge(id)}</h2><div class="meta">Platz ${m.spl} · ${fmt(m.sp)} Punkte · Teamwert ${money(m.tv)}</div></div></div>
  <button class="btn ${isMe ? '' : 'primary'}" id="setme" style="margin-bottom:12px">${isMe ? '✓ Das bin ich' : 'Das bin ich'}</button>
  <div class="tiles">
    ${tile('🥇 Spieltagssiege', m.wins, `${m.second}× Zweiter · ${m.third}× Dritter`)}
    ${tile('🔦 Letzter', m.last, `${m.zero}× 0 Punkte`)}
    ${tile('📐 Ø pro Spieltag', fmt(m.avg), `Ø Platz ${m.avgPl.toFixed(1).replace('.', ',')}`)}
    ${tile('🔥 Bester Spieltag', fmt(m.best?.mdp), m.best ? 'Spieltag ' + m.best.day : '')}
    ${tile('📈 Beste / schlechteste Platzierung', `${m.bestRank ?? '–'} / ${m.worstRank ?? '–'}`, 'in der Gesamttabelle')}
    ${tile('💸 Transfer-Bilanz', money(m.realized + m.open, true), `davon realisiert ${money(m.realized, true)}`)}
  </div>

  <h2>Wer hat dich hierhin gebracht?</h2>
  <p class="hint">Punkte, die jeder Spieler geholt hat, während er bei ${esc(m.name)} in der Startelf stand.</p>
  <div class="card flush">
    ${m.playerList.filter((p) => p.apps > 0).map((p, i) => {
      const pl = D.players[p.pid] || {};
      return `<div class="row${i >= 12 ? ' more' : ''}"${i >= 12 ? ' hidden' : ''}>${pimg(pl.img)}<div class="grow"><div class="name">${esc(pl.n || p.pid)} <span class="tag">${POS[pl.pos] || ''}</span></div>
      <div class="meta">${p.apps}× aufgestellt · Ø ${fmt(p.pts / p.apps)}${p.zero ? ` · ${p.zero}× ≤0` : ''}</div>
      <div class="bar"><i style="width:${Math.max(0, (p.pts / maxPts) * 100)}%"></i></div></div>
      <div class="right"><div class="big num ${p.pts < 0 ? 'neg' : ''}">${fmt(p.pts)}</div><div class="meta">${m.playerSum ? Math.round((p.pts / m.playerSum) * 100) : 0}%</div></div></div>`;
    }).join('') || '<div class="empty">Keine Daten.</div>'}
    ${m.playerList.filter((p) => p.apps > 0).length > 12 ? `<button class="row btn-more" id="more" style="width:100%;border:0;background:none;justify-content:center;color:var(--accent);font-weight:600">Alle ${m.playerList.filter((p) => p.apps > 0).length} Spieler anzeigen</button>` : ''}
    ${m.adjust ? `<div class="row"><div class="pimg" style="display:grid;place-items:center">±</div><div class="grow"><div class="name">Bonus / Abzüge</div><div class="meta">nicht einem Spieler zuzuordnen</div></div><div class="right big num ${m.adjust < 0 ? 'neg' : 'pos'}">${m.adjust > 0 ? '+' : ''}${fmt(m.adjust)}</div></div>` : ''}
  </div>

  <h2>Spieltag für Spieltag</h2>
  <div class="card"><div class="mini">${m.days.map((d) => `<i class="${d.mdpl === 1 && d.isFinal ? 'win' : ''}" style="height:${Math.max(3, (d.mdp / maxMd) * 100)}%" title="ST ${d.day}: ${d.mdp}"></i>`).join('')}</div>
  <div class="meta" style="margin-top:6px">Gold = Spieltagssieg</div></div>
  <div class="card flush">
    ${[...m.days].reverse().map((d) => {
      const cls = d.mdpl === 1 ? 'p1' : d.mdpl === 2 ? 'p2' : d.mdpl === 3 ? 'p3' : d.mdpl === d.maxPl && d.isFinal ? 'last' : '';
      const lineup = [...d.lineup].sort((a, b) => (b.p ?? -999) - (a.p ?? -999));
      return `<details class="md"><summary><div class="rank">${d.day}</div><div class="grow"><div class="name num">${fmt(d.mdp)} Punkte</div><div class="meta">Tabelle: Platz ${d.spl ?? '–'}${d.isFinal ? '' : ' · läuft'}${d.voided ? ' · mit 0 gewertet' : ''}</div></div><span class="pill ${cls}">${d.mdpl || '–'}.</span><span class="chev">▾</span></summary>
      <div class="md-lineup">${lineup.map((l) => `<div class="lr"><span>${esc(pname(l.pid))} <span class="meta">${POS[D.players[l.pid]?.pos] || ''}</span></span><b class="num ${l.p < 0 ? 'neg' : ''}">${l.p == null ? '–' : fmt(l.p)}</b></div>`).join('') || '<div class="empty">Keine Aufstellung</div>'}</div></details>`;
    }).join('')}
  </div>

  <h2>Transfers von ${esc(m.name)}</h2>
  <div class="card flush">
    ${[...m.transfers].sort((a, b) => b.profit - a.profit).map((d) => `<div class="row">${pimg(d.pim)}<div class="grow"><div class="name">${esc(d.pn)}${d.status === 'open' ? '<span class="tag open">im Kader</span>' : ''}</div><div class="meta">${money(d.buy)} → ${money(d.sell)}${d.pts ? ` · ${fmt(d.pts)} Pkt.` : ''}</div></div><div class="right big num ${d.profit >= 0 ? 'pos' : 'neg'}">${money(d.profit, true)}</div></div>`).join('') || '<div class="empty">Noch keine Transfers.</div>'}
  </div>` + foot();
  view.innerHTML = html;
  $('#setme').addEventListener('click', () => { store.set('kb-me', isMe ? null : id); vManager(id); });
  $('#more')?.addEventListener('click', (e) => { view.querySelectorAll('.row.more').forEach((r) => (r.hidden = false)); e.currentTarget.remove(); });
}

/* ---------------- Kader-Rechner ---------------- */

function vCalc() {
  const ms = S.managers;
  let uid = store.get('kb-calc-uid', me() || ms[0]?.id);
  if (!S.mgr[uid]) uid = ms[0]?.id;
  const budgets = store.get('kb-budgets', {});
  // Eigener Kontostand kommt automatisch von Kickbase (Account, der die Daten abruft)
  const ownerId = D.owner?.id;
  let budget = budgets[uid] ?? (uid === ownerId && D.owner?.budget != null ? D.owner.budget : 0);
  let sel = new Set(store.get('kb-calc-sel-' + uid, []));
  const squad = [...(D.squads[uid] || [])].sort((a, b) => (a.pos - b.pos) || b.mv - a.mv);

  view.innerHTML = `<h2>Kader-Rechner</h2>
    <p class="hint">Spieler zum Verkaufen anhaken und sehen, wie viel Geld du danach hast. Verkaufswert = aktueller Marktwert.</p>
    <div class="field"><label>Manager</label><select id="cu">${ms.map((m) => `<option value="${m.id}" ${m.id === uid ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Aktueller Kontostand in € (aus der Kickbase-App, kann auch negativ sein)</label><input id="cb" type="number" inputmode="numeric" step="1000" value="${budget}" /></div>
    <div class="card calc-sum" id="sum"></div>
    <div class="chips"><span class="chip" id="none">Auswahl leeren</span><span class="chip" id="worst">Schwächste Punktesammler wählen</span></div>
    <div class="card flush" id="list">
      ${squad.map((p) => `<label class="check ${sel.has(p.pi) ? 'sel' : ''}"><input type="checkbox" value="${p.pi}" ${sel.has(p.pi) ? 'checked' : ''}/>${pimg(p.pim)}<div class="grow"><div class="name">${esc(p.pn)} <span class="tag">${POS[p.pos] || ''}</span></div><div class="meta">${fmt(p.p)} Pkt. · Ø ${fmt(p.ap)}${p.prc ? ` · gekauft ${money(p.prc)}` : ''}</div></div><div class="right"><div class="num" style="font-weight:600">${money(p.mv)}</div><div class="meta num ${p.prc ? (p.mv - p.prc >= 0 ? 'pos' : 'neg') : ''}">${p.prc ? money(p.mv - p.prc, true) : ''}</div></div></label>`).join('') || '<div class="empty">Kein Kader gefunden.</div>'}
    </div>` + foot();

  const upd = () => {
    const chosen = squad.filter((p) => sel.has(p.pi));
    const plus = chosen.reduce((s, p) => s + (p.mv || 0), 0);
    const after = budget + plus;
    const left = squad.length - chosen.length;
    $('#sum').innerHTML = `<div class="meta">Kontostand nach Verkauf</div>
      <div class="big2 num ${after >= 0 ? 'pos' : 'neg'}">${money(after)}</div>
      <div class="meta num">${money(budget)} + ${money(plus)} aus ${chosen.length} Spieler${chosen.length === 1 ? '' : 'n'} · ${left} bleiben im Kader${left < 11 ? ' ⚠️ weniger als 11' : ''}</div>`;
    store.set('kb-calc-sel-' + uid, [...sel]);
  };
  upd();

  $('#cu').addEventListener('change', (e) => { store.set('kb-calc-uid', e.target.value); vCalc(); });
  $('#cb').addEventListener('input', (e) => { budget = Number(e.target.value) || 0; budgets[uid] = budget; store.set('kb-budgets', budgets); upd(); });
  $('#list').addEventListener('change', (e) => {
    const cb = e.target; if (!cb.matches('input[type=checkbox]')) return;
    cb.checked ? sel.add(cb.value) : sel.delete(cb.value);
    cb.closest('label').classList.toggle('sel', cb.checked); upd();
  });
  $('#none').addEventListener('click', () => { sel = new Set(); vCalcRefresh(); });
  $('#worst').addEventListener('click', () => {
    // So viele schwache Spieler wählen, bis der Kontostand nicht mehr negativ ist (mind. 1)
    const ranked = [...squad].sort((a, b) => (a.ap || 0) - (b.ap || 0));
    sel = new Set(); let b = budget;
    for (const p of ranked) { if (b >= 0 && sel.size > 0) break; sel.add(p.pi); b += p.mv || 0; }
    vCalcRefresh();
  });
  function vCalcRefresh() { store.set('kb-calc-sel-' + uid, [...sel]); vCalc(); }
}

const foot = () => `<div class="foot">Daten: Kickbase · aktualisiert ${new Date(D.updated).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>`;

load();
