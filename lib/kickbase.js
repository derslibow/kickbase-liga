// Holt alle Rohdaten einer Kickbase-Liga (API v4, inoffiziell) und gibt sie kompakt zurück.
// Läuft im Browser und in Node (>=18), solange `fetch` vorhanden ist.
//
// Kickbase drosselt bei vielen Anfragen kurz hintereinander. Deshalb:
//  - wenige parallele Anfragen + kleine Pause
//  - inkrementell: Punkte abgeschlossener Spieltage werden aus dem letzten Stand übernommen

const API = 'https://api.kickbase.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function login(email, password) {
  const r = await fetch(`${API}/v4/user/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ em: email, pass: password, loy: false, rep: {} }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.tkn) throw new Error(`Kickbase-Login fehlgeschlagen (${r.status})`);
  return { token: j.tkn, userId: j.u?.id ?? j.u?.i ?? null, leagues: (j.srvl || []).map((l) => ({ id: l.id, name: l.n })) };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchLeague(token, leagueId, opts = {}) {
  const { competitionId = '1', concurrency = 2, delayMs = 150, previous = null, ownerId = null, log = () => {} } = opts;
  let requests = 0;

  const get = async (path, { tries = 6, soft = false } = {}) => {
    for (let t = 0; t < tries; t++) {
      try {
        await sleep(delayMs);
        requests++;
        const r = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
        if (r.ok) return await r.json();
        if (r.status === 404) return null;
        if (r.status === 401) throw new Error('Kickbase-Token ungültig');
      } catch (e) {
        if (String(e.message).includes('Token')) throw e;
      }
      await sleep(Math.min(30000, 1500 * 2 ** t)); // 1,5 s, 3 s, 6 s, 12 s ...
    }
    if (soft) return undefined;
    throw new Error(`Kickbase-Anfrage fehlgeschlagen: ${path}`);
  };
  const L = leagueId;

  const overview = await get(`/v4/leagues/${L}/overview?includeManagersAndBattles=false`);
  const rankNow = await get(`/v4/leagues/${L}/ranking`);
  const managers = rankNow.us.map((u) => ({ id: u.i, name: (u.n || '').trim(), img: u.uim || null, tv: u.tv, sp: u.sp, spl: u.spl }));

  // Aktueller Spieltag + ob er schon abgeschlossen ist
  const anyLineupPlayer = rankNow.us.flatMap((u) => u.lp || []).find(Boolean);
  const probe = await get(`/v4/competitions/${competitionId}/players/${anyLineupPlayer}?leagueId=${L}`);
  const curEntry = (probe?.mdsum || []).find((m) => m.cur);
  const currentDay = curEntry ? curEntry.day : probe?.day || 1;
  const currentDayFinished = curEntry ? curEntry.mdst === 2 : false;
  log(`Spieltag ${currentDay} (${currentDayFinished ? 'abgeschlossen' : 'läuft/offen'})`);

  // Bereits abgeschlossene Spieltage aus dem letzten Stand übernehmen
  const prevOk = previous && String(previous.league?.id) === String(L);
  const prevFinal = prevOk ? previous.finalDays || 0 : 0; // bis zu diesem Spieltag ist alles endgültig
  const finalDays = currentDayFinished ? currentDay : currentDay - 1;

  const days = [];
  for (let d = 1; d <= currentDay; d++) {
    const old = prevOk && d <= prevFinal ? previous.days.find((x) => x.day === d) : null;
    if (old) {
      days.push(old);
      continue;
    }
    const rk = await get(`/v4/leagues/${L}/ranking?dayNumber=${d}`);
    days.push({
      day: d,
      rows: (rk?.us || []).map((u) => ({ u: u.i, mdp: u.mdp, mdpl: u.mdpl, sp: u.sp, spl: u.spl, tv: u.tv, lp: (u.lp || []).filter(Boolean).map(String) })),
    });
  }
  log(`Spieltage geladen (${requests} Anfragen)`);

  // Transfers (25 pro Seite) und Kader je Manager – ändern sich laufend, daher immer neu
  // Nur Transfers der aktuellen Saison: Kickbase setzt die Liga zum Saisonstart zurück (overview.dt)
  const seasonStart = overview?.dt || null;
  const transfers = {};
  const squads = {};
  await pool(managers, concurrency, async (m) => {
    const list = [];
    for (let start = 0; start < 5000; start += 25) {
      const j = await get(`/v4/leagues/${L}/managers/${m.id}/transfer${start ? `?start=${start}` : ''}`);
      const it = j?.it || [];
      list.push(...it.map((t) => ({ pi: t.pi, pn: t.pn, tid: t.tid, tty: t.tty, trp: t.trp, dt: t.dt, pim: t.pim })));
      if (it.length < 25) break;
      if (seasonStart && it[it.length - 1].dt < seasonStart) break; // neueste zuerst -> Rest ist alte Saison
    }
    transfers[m.id] = seasonStart ? list.filter((t) => t.dt >= seasonStart) : list;
    const sq = await get(`/v4/leagues/${L}/managers/${m.id}/squad`);
    squads[m.id] = (sq?.it || []).map((p) => ({ pi: p.pi, pn: p.pn, tid: p.tid, pos: p.pos, mv: p.mv, prc: p.prc ?? null, p: p.p ?? 0, ap: p.ap ?? 0, pim: p.pim, mvt: p.mvt, tfhmvt: p.tfhmvt }));
  });
  log(`Transfers & Kader geladen (${requests} Anfragen)`);

  // Spielerpunkte: nur Spieler neu laden, die an noch nicht endgültigen Spieltagen aufgestellt waren
  const players = {};
  const allPids = [...new Set(days.flatMap((d) => d.rows.flatMap((r) => r.lp)))];
  const needFresh = new Set(days.filter((d) => d.day > prevFinal).flatMap((d) => d.rows.flatMap((r) => r.lp)));
  const known = {};
  for (const list of Object.values(squads)) for (const p of list) known[p.pi] = { ln: p.pn, tid: p.tid, pos: p.pos, pim: p.pim, mv: p.mv };

  const toLoad = [];
  for (const pid of allPids) {
    const old = prevOk ? previous.players?.[pid] : null;
    if (old && !needFresh.has(pid)) {
      players[pid] = { ...old, ...(known[pid] ? { mv: known[pid].mv } : {}) };
    } else toLoad.push(pid);
  }
  log(`${toLoad.length} von ${allPids.length} Spielern werden geladen`);

  await pool(toLoad, concurrency, async (pid) => {
    const perf = await get(`/v4/competitions/${competitionId}/players/${pid}/performance`, { soft: true });
    const info = known[pid] || (await get(`/v4/competitions/${competitionId}/players/${pid}?leagueId=${L}`, { soft: true }));
    const old = prevOk ? previous.players?.[pid] : null;
    const seasons = perf?.it || [];
    const season = seasons[seasons.length - 1];
    const pts = { ...(old?.pts || {}) };
    for (const ph of season?.ph || []) if (ph.day <= currentDay && ph.p != null) pts[ph.day] = ph.p;
    players[pid] = {
      n: info?.ln || old?.n || `#${pid}`,
      fn: info?.fn || old?.fn || '',
      tid: info?.tid || old?.tid || null,
      pos: info?.pos || old?.pos || null,
      img: info?.pim || old?.img || null,
      mv: info?.mv ?? old?.mv ?? null,
      pts,
    };
  });
  log(`Fertig (${requests} Anfragen)`);

  return {
    league: { id: L, name: overview?.lnm || rankNow.ti, img: overview?.lim || null },
    updated: new Date().toISOString(),
    seasonStart,
    currentDay,
    currentDayFinished,
    finalDays,
    managers,
    days,
    players,
    transfers,
    squads,
  };
}
