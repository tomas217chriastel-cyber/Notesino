# Notesino EduPage relay

A small Cloudflare Worker that lets the Timetable's "Sync with EduPage"
button fetch your real school schedule. It exists only because EduPage
has no public API and its login can't be done directly from a browser
(no CORS, and a multi-step cookie-based flow) — this Worker does that
login dance server-side, on each request, and forwards back just your
parsed timetable. It keeps no database, no KV, no logs of your
credentials: your username/password are used in memory for the one
request and then gone.

This is an **unofficial** integration, reverse-engineered from the
community project [EdupageAPI/edupage-api](https://github.com/EdupageAPI/edupage-api)
(GPL-3.0). EduPage can change its site at any time and break this —
if that happens, Notesino's sync button will show an error naming
which step failed (e.g. `gpid-gsh-missing`, `bad-credentials`), which
is the thing to report back so the Worker can be fixed.

**It has not been tested against a real EduPage account** — this
Claude session has no network access to edupage.org to test with.
The first real sync you run is effectively the first real test of
this code; if it fails, copy the exact error message/step name shown
in the app back to me (or into this conversation) and I'll fix it
from there.

## Deploy it (free, ~5 minutes)

1. Create a free account at https://dash.cloudflare.com/sign-up if
   you don't have one.
2. Install Wrangler (Cloudflare's CLI) if you don't have it:
   `npm install -g wrangler`
3. From this folder, log in and deploy:
   ```
   cd edupage-relay
   wrangler login
   wrangler deploy
   ```
4. Wrangler prints a URL like
   `https://notesino-edupage-relay.<your-subdomain>.workers.dev` —
   that's the "Relay URL" to paste into Notesino's EduPage sync panel
   (Timetable → EduPage Sync…). It only needs to be entered once; the
   app remembers it on this device.

## What it needs from you each sync

- **School subdomain** — the part before `.edupage.org` in your
  school's EduPage address (e.g. if your school's address is
  `https://gymxyz.edupage.org`, the subdomain is `gymxyz`).
- **Username** and **password** — your own EduPage login. The
  password is sent once per sync directly to your own deployed
  Worker over HTTPS and is never written to disk anywhere in
  Notesino.

## Privacy / trust notes

- You are deploying and running this Worker yourself, under your own
  Cloudflare account — Notesino's authors (including this Claude
  session) never see your credentials or your timetable data; it goes
  browser → your Worker → EduPage → your Worker → your browser.
- The Worker's CORS header currently allows any origin
  (`Access-Control-Allow-Origin: *`) so Notesino (wherever you're
  running it from) can call it. If you want to lock it down, change
  `ALLOWED_ORIGIN` at the top of `worker.js` to your app's exact
  origin and redeploy.
