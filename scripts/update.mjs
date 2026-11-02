// Holt die Liga-Daten von Kickbase und speichert sie in public/data/league.json.
// Wird von GitHub Actions automatisch ausgeführt (siehe .github/workflows/update.yml).
// Lokal: KICKBASE_EMAIL=... KICKBASE_PASSWORD=... node scripts/update.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { login, fetchLeague } from '../lib/kickbase.js';

const OUT = new URL('../public/data/league.json', import.meta.url);
const { KICKBASE_EMAIL, KICKBASE_PASSWORD, KICKBASE_LEAGUE_ID, FULL_REFRESH } = process.env;
if (!KICKBASE_EMAIL || !KICKBASE_PASSWORD) {
  console.error('KICKBASE_EMAIL und KICKBASE_PASSWORD müssen gesetzt sein.');
  process.exit(1);
}

let previous = null;
if (FULL_REFRESH !== 'true') {
  try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* erster Lauf */ }
}

const { token, userId, leagues } = await login(KICKBASE_EMAIL, KICKBASE_PASSWORD);
const leagueId = KICKBASE_LEAGUE_ID || leagues[0]?.id;
if (!leagueId) throw new Error('Keine Liga im Account gefunden.');
console.log(`Liga ${leagueId} – Ligen im Account: ${leagues.map((l) => `${l.id} ${l.name ?? ''}`).join(', ')}`);

const data = await fetchLeague(token, leagueId, { previous, ownerId: userId, log: (m) => console.log(m) });
await mkdir(new URL('.', OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(data));
console.log(`Gespeichert: ${Object.keys(data.players).length} Spieler, Spieltag ${data.currentDay}`);
