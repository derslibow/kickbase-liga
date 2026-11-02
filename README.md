# Kickbase Liga – Statistikseite

Mobile-first Statistikseite für eine Kickbase-Liga:
Gesamttabelle, Spieltagssiege/Podest/Letzter/0-Punkte, Rekorde, Platzierungsverlauf (an-/abwählbar),
Punkte pro Spieler je Manager, beste Transfers und Flops sowie ein Kader-Rechner.

## So funktioniert's

- `scripts/update.mjs` loggt sich bei Kickbase ein und speichert alle Daten in `public/data/league.json`.
- GitHub Actions führt das alle 3 Stunden aus (am Wochenende stündlich am Nachmittag/Abend)
  und veröffentlicht `public/` auf GitHub Pages.
- Abgeschlossene Spieltage werden nur einmal geladen; danach kommt nur Neues dazu.
- Die Zugangsdaten liegen ausschließlich als **GitHub Secrets** vor – nie im Code.

## Einrichtung

1. Neues Repository auf GitHub anlegen (kann privat sein, GitHub Pages geht bei privaten Repos aber nur mit GitHub Pro – sonst öffentlich lassen; es stehen keine Zugangsdaten drin).
2. Diese Dateien hochladen.
3. **Settings → Secrets and variables → Actions → New repository secret**:
   - `KICKBASE_EMAIL` – Kickbase-E-Mail
   - `KICKBASE_PASSWORD` – Kickbase-Passwort
   - optional `KICKBASE_LEAGUE_ID` – nur nötig, wenn der Account in mehreren Ligen ist
4. **Settings → Pages → Source: GitHub Actions**.
5. **Actions → „Kickbase-Daten aktualisieren & Seite veröffentlichen“ → Run workflow**.
   Der erste Lauf dauert ein paar Minuten, weil Kickbase sonst blockt.
6. Die Adresse steht danach unter Settings → Pages (z. B. `https://<name>.github.io/<repo>/`).

## Lokal testen

```bash
KICKBASE_EMAIL=... KICKBASE_PASSWORD=... node scripts/update.mjs
npx serve public
```

Hinweis: Die Kickbase-API ist inoffiziell und kann sich ändern.
