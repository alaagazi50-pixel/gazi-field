# GAZI FIELD — v0.1.0

One simple daily report. The whole project updated.

This first version is an installable, offline-first web app (PWA). It has no build step and no dependencies.

## Run it

```
serve.bat            (or: python -m http.server 8080)
```

Open http://localhost:8080. To use it on a phone it has to be served over **https** (for example GitHub Pages, Netlify, or any static host). Camera, GPS and "Install app" all need https. Once it's loaded, the app works offline.

## What's in v1

| Who | Screens |
|---|---|
| **Field team** (Jamal) | Home → Start daily update → one stage, one question (No change / Update progress) → pick new % in one tap → **photo required** → confirm. After the 7 stages: anything blocking? (category, stage, optional photo, note in any language) → summary (tap a row to fix it) → Submit day. |
| **Farm hub** | Location (GPS + open in maps), project drawing (management uploads), BOQ (management edits), photo history per stage, report history, issues. |
| **Management** | Dashboard: teams reported, farms updated, needs attention (open issues and missing reports with Follow up), reports from today, each team's phone connectivity. Report review: approve photos for the client, resolve issues, translate notes. Farm list with CSV export. |
| **Client portal** | Project %, completed and in-progress farms. Only photos management has approved are shown. No names, notes or issues. |

- **Photos are organized automatically.** Each photo is resized, stamped with `HM16 · ROOM · 080 · 25SEP26 · 17:32 · Jamal`, and linked to its farm, stage, %, time, user and GPS.
- **Location check:** when the day is submitted, the phone's GPS is compared with the farm (within 3 km means verified).
- **Languages:** English, Português, العربية (right-to-left). Each note keeps the language it was written in.

## Phone connectivity (did the phone actually have internet?)

- While the app is open, it tests for **real internet** every 3 minutes. It also tests when the network changes and when the app is reopened. Each test is an actual request to `gstatic.com/generate_204`, because the phone's "online" flag says yes even on Wi-Fi or mobile data that has no internet.
- Every daily report includes a **12-hour timeline** of those results: had internet, no internet, and not observed. Management sees it on the report and on each team's card.
- **Limit:** a web app can't run while it's closed. Time when the app wasn't open shows as *not observed*, never as offline. On Android Chrome with the app installed, the service worker also tests in the background through Periodic Background Sync, but the browser decides how often, usually every few hours at best. A native Android app would be needed to log connectivity all day.

## Known limits of v1

- **No server yet.** Everything is saved on the device (IndexedDB), so management only sees reports sent from the same device, which is enough for the demo. The next step is a backend (API, database and photo storage) with an outbox sync. Reports already carry a `synced: false` flag for this.
- Translation opens Google Translate. It isn't built in yet.
- Demo data (60 farms, 5 teams, sample BOQ quantities) is generated. Reset it in Settings with "Reset demo data".
- There are no passwords yet. You pick who is using the phone.

## Files

```
index.html  manifest.webmanifest  sw.js       app shell, PWA manifest, offline cache and background checks
css/app.css                                   styles
js/app.js          router, login, settings    js/field.js    home and daily update flow
js/farm.js         farm hub and report view   js/manage.js   dashboard and farm list
js/client.js       client portal              js/connectivity.js  internet tests and timeline
js/store.js js/db.js  storage and photos      js/data.js     stages, demo data, helpers
js/i18n.js         EN / PT / AR strings
```
