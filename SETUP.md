# Connecting GAZI FIELD to its server (Supabase)

You do this once, in about 20 minutes, in the browser. You need the files in this folder and GitHub Desktop.

## 1. Create the Supabase project
1. Go to **supabase.com**, click **Start your project**, and sign up (you can sign in with GitHub).
2. Click **New project**.
   - Name: `gazi-field`
   - Database password: click **Generate** and save it somewhere safe. The app doesn't need it.
   - Region: pick the one closest to Angola, for example a region in Europe.
3. Click **Create new project** and wait about 2 minutes.

## 2. Create the database (one paste)
1. In the left menu, open **SQL Editor** and click **+ New query**.
2. Open `supabase/setup.sql` from this folder in Notepad. Press **Ctrl+A**, then **Ctrl+C**.
3. Paste it into the editor and click **Run**. You should see *Success*. This creates the tables and access rules, plus 5 teams and 60 farms.

## 3. Create your manager login
1. Open **Authentication → Users → Add user → Create new user**.
2. Enter your email and a password, tick **Auto Confirm User**, and click **Create user**.

The **first** login created here automatically becomes the manager. Create everyone else from the app's **People** page.

## 4. Turn off public sign-up
1. Open **Authentication → Sign In / Providers** (on some versions it's **Settings**).
2. Turn **Allow new users to sign up** **off**, then click **Save**.

## 5. Add the account-management function
This is what lets you create worker and client logins from inside the app.
1. Open **Edge Functions → Deploy a new function → Via Editor**.
2. Name it exactly `admin-users`.
3. Delete the example code. Open `supabase/functions/admin-users/index.ts` in Notepad, copy everything, and paste it in.
4. Click **Deploy function**.

## 6. Connect the app
1. Open **Project Settings → API Keys** (or **Settings → API**). Copy:
   - the **Project URL**, which looks like `https://abcdefgh.supabase.co`
     (it's on the **Settings → Data API** page, or on the project's home page under **Connect**)
   - the **anon / public** key (it may be called the **publishable** key)
2. Open `js/config.js` in Notepad and paste them between the quotes:
   ```js
   export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
   ```
   **Never use the `service_role` or `secret` key here.** That key can bypass every rule.
3. In **GitHub Desktop**, type the summary "Connect server", click **Commit to main**, then **Push origin**.

## 7. First sign-in
1. Open `https://alaagazi50-pixel.github.io/gazi-field/` and wait a minute after pushing. If you still see the old version, refresh twice.
2. Sign in with **your email** and password.
3. Go to **People → Add person** and create:
   - **Field workers:** username, password, team and language. Workers sign in with the **username** only, no email.
   - **Client:** role *Client*. Give them the username and password.
4. Under **Teams**, pick each team's farm for today. Open a farm page to correct its progress or move it to another team.

## Publishing a new version
Do this every time the app changes, for example after Claude has made changes on your computer.

1. **Open GitHub Desktop.** Check that the repository at the top left says `gazi-field`. The **Changes** tab lists every changed file.
2. **Check `js/config.js`.** If it's in the list, click it. The right side must still show your Supabase URL and key, not empty quotes `''`. If they're empty, paste them in again before committing, or the live app loses its connection.
3. **Commit.** At the bottom left, type a short summary, such as `v0.3 notifications`, then click **Commit to main**.
4. **Push.** Click **Push origin** at the top.
5. **Check the tests.** On github.com, open `gazi-field` → **Actions**. Wait 1–2 minutes for a green ✓. A red ✗ means something is broken, so send the screenshot to Claude before telling people to update.
6. **Check the website.** Open `https://alaagazi50-pixel.github.io/gazi-field/` and refresh twice. **Settings** (⋮) shows the version number at the bottom.
7. **Phones update by themselves.** The app loads the new version the next time it's opened with internet. If a phone still shows the old version, close the app completely and open it again.
8. **If the release notes say the database changed:** before step 7, open Supabase → **SQL Editor → + New query**, paste the new `.sql` file Claude names, and click **Run**.
9. **If the release notes say the `admin-users` function changed:** open Supabase → **Edge Functions → admin-users → Code**, replace everything with the new `supabase/functions/admin-users/index.ts`, and click **Deploy**.

If Render hosts the site too, it updates by itself after step 4.

## Own domain: field.gaziltd.com
gaziltd.com's DNS is managed at Cloudflare.
1. **Cloudflare:** open gaziltd.com → **DNS → Records → Add record**.
   - Type **CNAME**, Name **field**, Target **alaagazi50-pixel.github.io**
   - Proxy status: click the orange cloud so it turns **grey (DNS only)**. GitHub can't issue the security certificate otherwise.
   - Click **Save**.
2. **GitHub:** open gazi-field → **Settings → Pages → Custom domain**, type `field.gaziltd.com`, and click **Save**. Wait until the DNS check turns green (minutes to an hour), then tick **Enforce HTTPS**.
3. The app is now at **https://field.gaziltd.com**. The old github.io address redirects there automatically, and the data and logins stay the same.

## Optional: host the website on Render instead of GitHub Pages
Choose this if you want it in the same Render dashboard as delapp. It's also free, and a static site never sleeps.
1. In **render.com**, click **New → Blueprint** and pick the `gazi-field` repository. Render reads `render.yaml`.
2. Click **Apply**. After about a minute the site is live at `https://gazi-field.onrender.com` (or a similar name).
3. Every push from GitHub Desktop updates it automatically.

Both addresses can run at the same time, since they use the same Supabase database. For a custom domain, open **Settings → Custom Domains** in Render.

## Automatic tests
Every push runs the tests on GitHub (the **Actions** tab), the same way delapp does. They check the database access rules, 41 checks, and that every app file loads. A red ✗ means something broke. Open it to see which check failed.

## Who can see what (enforced by the database, not just the screens)

| | Field worker | Management | Client |
|---|---|---|---|
| Farms | their team's only | all | all (progress only) |
| Daily report | submit for their team's farm; photo required for any change | read all | — |
| Photos | their team's | all; chooses what the client sees | approved only |
| Issues and notes | their team's | all; resolves them | — |
| People and accounts | their teammates' names | create, edit, reset password, switch off | — |
| Change progress directly | no, only through a daily report | yes | no |

A switched-off account can't sign in and can't read anything.

## If something goes wrong
- **"Wrong username or password":** check the spelling. Workers type the username, and you type your email.
- **"This account has no access":** the login exists but has no profile. Repeat step 4.3 for that email, or create the person through **People** instead.
- **Creating a person fails:** check that the Edge Function is named exactly `admin-users` and that it deployed without errors (**Edge Functions → admin-users → Logs**).
- **Reports stay "waiting to upload":** the phone has no internet. They upload by themselves once it does, or you can tap the orange badge and choose **Upload now**.
