# Preview environment

A second copy of the app on its own URL, running against its own database
filled with made-up data. Nothing here touches the real database, real
families, or the real Wix donation sync.

The pieces: a `preview` git branch, a Vercel preview deployment of that
branch, a separate Neon database branch, and `scripts/seed-preview.ts` to
fill it with fake families, classrooms, donations, and fundraising partners.

## 1. Create the preview database (Neon)

1. In the Neon console, create a branch from `main` and name it `preview`.
2. Copy that branch's connection string.
3. Heads up: a branch starts as a copy of your real data, including saved
   sign-in sessions. Step 2 below wipes all of it. Don't point anything at the
   branch until that's done.
4. Neon's Vercel integration can create a database branch for every preview
   deployment automatically. Leave that off for this project, or every preview
   would get a fresh copy of real data.

## 2. Seed it

```bash
cp .env.preview.local.example .env.preview.local
# edit .env.preview.local: paste the preview branch's DATABASE_URL.
# Optional: set SEED_TEST_PARENT_EMAIL to your own email to sign in as a parent.

npm run seed:preview                      # dry run: shows what it would create
npm run seed:preview -- --wipe --confirm-host=<host it printed> --commit
```

The script reads only `.env.preview.local` (never `.env.local`) and refuses to
run if that URL points at the same database host as `.env.local`. On a
non-empty database it stops unless you pass `--wipe` and the matching
`--confirm-host`. Re-running with `--wipe` resets the preview to a fresh seed.

All the ratios (grade mix, kids per family, parents per family, donation rate
by grade, classrooms per grade, and so on) are in the `CONFIG` block at the
top of `scripts/seed-preview.ts`. Change a number and re-seed. `--seed=123`
gives a different random dataset; the same seed always gives the same one.

## 3. Push the preview branch

```bash
git push origin main:preview
```

Vercel deploys any non-production branch as a preview, at a stable URL like
`pto-app-git-preview-<team>.vercel.app` (see the project's Domains tab).

## 4. Vercel environment variables

Project, Settings, Environment Variables. For each one, tick **Preview only**
and choose the **`preview`** branch, so other branches' previews don't pick
them up.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the preview Neon branch's connection string |
| `AUTH_SECRET` | a new random value (`npx auth secret`), not the production one |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | the same Google OAuth client as production is fine |
| `ADMIN_EMAILS` | your email |
| `CURRENT_SCHOOL_YEAR_LABEL` | `2026-2027` (what the seed prints) |
| `WIX_DONATION_CAMPAIGN_ID` | `seed-campaign-2026` (what the seed prints) |
| `CRON_SECRET` | any random value, or leave it unset (the sync route then refuses every request) |

Leave `WIX_API_KEY` and `WIX_SITE_ID` unset so the preview can never call Wix.
The GitHub Action that syncs donations only calls the production URL.

Email sign-in links won't reach seeded addresses, so sign in with Google.

## 5. Google sign-in

In Google Cloud Console, open the OAuth client and add this to **Authorized
redirect URIs**:

```
https://<your preview URL>/api/auth/callback/google
```

Keep Vercel's **Deployment Protection** (Vercel Authentication) on for
previews, so only people signed in to your Vercel team can open the URL.

## 6. Day to day

- New code: commit to `main` as usual, then `git push origin main:preview`.
- Schema changes: apply them to the preview database too. `drizzle.config.ts`
  reads `.env.local`, but dotenv won't override a variable already in your
  shell, so export the preview URL first (and close that shell afterwards):
  `export DATABASE_URL='<preview url>'` then run `npx drizzle-kit migrate`.
- Signing in as a parent: set `SEED_TEST_PARENT_EMAIL` before seeding, then
  open `/parent/dashboard` directly (admins are sent to `/admin` after login).
