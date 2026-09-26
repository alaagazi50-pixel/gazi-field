# GAZI FIELD — v0.4.0

One simple daily report. The whole project updated.

An installable, offline-first web app (PWA) for field teams, with Supabase as the server for accounts, the database and photo storage. There's no build step.

**First time? Follow [SETUP.md](SETUP.md)** to connect the server and create your manager account.

## Accounts

| Role | What they get |
|---|---|
| **Field worker** | Signs in with a username. Picks the farm they are at today: any farm, with search, recent farms, the team's planned farm as a suggestion, and **Near me** by GPS. Does the daily report: one stage, one question, and a photo for every progress change. Can add **several problems** per report. **Farm information** (map, drawing, BOQ, photos, history, problems) is under one button and works without signal. Reports made offline **upload by themselves** when signal returns, and on Android even when the app is closed. Optional push **reminders** if the day's report hasn't been sent. |
| **Manager** | Dashboard, report review, photo approval, problem resolution, farms (add, names, GPS, BOQ, drawings, progress correction), People (accounts and teams). **Follow up** also pushes a reminder to that team's phones. |
| **Supervisor** | Everything a manager has, plus **Analysis**: teams and workers compared over 7, 30 or 90 days (days reported, progress added, photos, problems and resolution time, usual report time, location verified, phone internet), problems by type, and farms without progress. |
| **Client** | Project progress and approved photos only. No names, notes or problems. |

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
supabase/functions/admin-users/index.ts   creates accounts and resets passwords (deployed as super-handler)
supabase/functions/reminders/index.ts      push reminders (daily schedule + Follow up button)
supabase/migrations/     database updates, run in order in the SQL Editor
js/analysis.js          supervisor analysis
tests/db_test.py        who-can-see-what checks (run by GitHub Actions)
render.yaml             optional Render static-site hosting
```
