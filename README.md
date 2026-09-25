# GAZI FIELD — v0.2.0

One simple daily report. The whole project updated.

An installable, offline-first web app (PWA) for field teams, with Supabase as the server for accounts, the database and photo storage. There's no build step.

**First time? Follow [SETUP.md](SETUP.md)** to connect the server and create your manager account.

## Three kinds of account

| Role | What they get |
|---|---|
| **Field worker** | Signs in with a username. Sees their team's farm and does the daily report: one stage, one question, and a photo for any progress change. Also reports blocking issues. Works without signal: reports wait on the phone and upload by themselves. |
| **Management** | Dashboard (teams reported, farms updated, needs attention), report review, photo approval for the client, issue resolution, farm list and CSV export. The **People** page creates accounts, sets role, team and language, resets passwords and switches people off. Picks each team's farm for the day and can correct progress. |
| **Client** | Project progress, completed and in-progress farms, and approved photos only. No names, notes or issues. |

Access is enforced by row-level security in the database (`supabase/schema.sql`), not only hidden in the screens. Progress from the field can only change through `submit_report()`, which checks the worker's team and requires a photo for every change.

## Phone connectivity

While the app is open, it tests for real internet every 3 minutes, on network changes, and when the app is reopened. Each test makes an actual request to the app's own server, because the phone's "online" flag isn't reliable. Every daily report carries a 12-hour timeline showing when the phone had internet, had none, or wasn't observed. Management sees it on the report and on each team's card. Time when the app was closed shows as "not observed". Logging all day would need a native Android app.

## Hosting and tests

- **Website:** GitHub Pages (`alaagazi50-pixel.github.io/gazi-field`), or Render as a static site through `render.yaml`. Both are free, and you can run either or both.
- **Server:** Supabase (Postgres, logins, photo storage, the `admin-users` function).
- **Tests:** `.github/workflows/tests.yml` runs on every push. It runs the database access rules (`tests/db_test.py`, against a real Postgres) and checks that every app file parses. To run locally: `pip install "psycopg[binary]" pgserver`, then `python tests/db_test.py`.

## Run locally

```
serve.bat            (or: python -m http.server 8080)
```
Open http://localhost:8080. It uses the same Supabase project as `js/config.js`.

## Files

```
index.html  manifest.webmanifest  sw.js      app shell, install, offline cache
js/config.js        server address and public key (fill in once)
js/store.js         sign-in, data loading, offline copy, upload queue, management actions
js/app.js           router, sign-in, settings    js/people.js   accounts and teams (management)
js/field.js         home and daily update flow   js/farm.js     farm pages and report view
js/manage.js        dashboard and farm list      js/client.js   client portal
js/connectivity.js  internet tests and timeline  js/i18n.js     English / Português / العربية
js/vendor/supabase.js   Supabase client library (v2.117.1, bundled so it works offline)
supabase/schema.sql     tables, access rules, submit_report()
supabase/seed.sql       starter teams and 60 farms
supabase/functions/admin-users/index.ts   creates accounts and resets passwords (management only)
tests/db_test.py        who-can-see-what checks (run by GitHub Actions)
render.yaml             optional Render static-site hosting
```
