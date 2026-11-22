# Notesino relay

One small Cloudflare Worker doing two unrelated jobs, so there's only one
thing to deploy.

## 1. EduPage sync

Lets the Timetable's "EduPage Sync…" button fetch your real school
schedule. It exists only because EduPage has no public API and its login
can't be done directly from a browser (no CORS, and a multi-step
cookie-based flow) — this Worker does that login dance server-side, on
each request, and forwards back just your parsed timetable. No database,
no KV, no logs of your credentials: your username/password are used in
memory for the one request and then gone.

This part is an **unofficial** integration, reverse-engineered from the
community project [EdupageAPI/edupage-api](https://github.com/EdupageAPI/edupage-api)
(GPL-3.0). EduPage can change its site at any time and break this — if
that happens, Notesino's sync button will show an error naming which step
failed (e.g. `gpid-gsh-missing`, `bad-credentials`), which is the thing to
report back so the Worker can be fixed. (Confirmed working against a real
account.)

The sync button makes two separate week-long requests (this week, next
week) instead of one combined two-week request, because EduPage's day-plan
endpoint has been observed to silently drop the second week when asked for
a 14-day span in one call. The Worker itself goes further still: each of
those two "week" requests is actually fetched **one day at a time**
server-side and merged, because even a 7-day range has been observed (on a
real account) to come back with entries for only the first day or two --
genuinely missing from the response, not just empty. A sync therefore
makes around 14 requests to EduPage behind the scenes and takes noticeably
longer than it used to; that's the trade-off for actually getting every
day's data.

**Cancelled lessons**: EduPage flags a removed or teacher-absent lesson
with `removed`/`type` fields on the raw plan item; Notesino now keeps those
lessons instead of dropping them, and the Timetable shows them struck
through in red ("Cancelled").

**Substitution / room-change marking (not implemented yet)**: EduPage's
own UI highlights a substituted lesson in yellow, but no reference
implementation checked so far reads a specific field for this, so
Notesino isn't guessing at one. Each lesson in the relay's response now
carries a `raw` field with the untouched EduPage plan item for exactly
this purpose — if you have a day with a *real* known substitution, sync
it, open your browser's DevTools → Network tab, find the POST to this
Worker, and look at that lesson's `raw` object for anything that looks
like an "original teacher/room" field or a highlight flag. Once that
field is known, the yellow "Substitution?" treatment already wired into
the Timetable's CSS/JS just needs that one field hooked up.

## 2. Push notifications

Lets a reminder, or a Subject Note that mentions a date ("test tomorrow"),
send a real device notification — on your phone, your desktop, any device,
even if the app/browser isn't open at the time. Browsers can't push to a
closed app by themselves; that needs a server holding each device's push
subscription and sending to it at the right moment. This Worker stores (in
Cloudflare KV) a small per-"sync code" group of push subscriptions plus the
upcoming `{title, body, fireAt}` items the app computed locally, and a Cron
Trigger sweeps every 10 minutes for anything due and sends it as a real Web
Push (the same standard — RFC 8291 encryption + VAPID — that every browser
push implementation uses) to every device in that group.

**This half needs two extra one-time setup steps** beyond EduPage sync
(below) — a KV namespace and your own VAPID key pair. Its cryptography was
verified end-to-end against an independent decrypting test receiver before
shipping (not against a real device from this session, since it has no
network access to real push services) — if a real device doesn't receive a
push, start with "Send test notification" in the app's Notifications panel
and report back exactly what it says.

## Deploy it (free, ~10 minutes)

1. Create a free account at https://dash.cloudflare.com/sign-up if you
   don't have one.
2. Install Wrangler (Cloudflare's CLI) if you don't have it:
   `npm install -g wrangler`
3. From this folder, log in:
   ```
   cd edupage-relay
   wrangler login
   ```
4. Create the KV namespace push notifications store subscriptions/items in:
   ```
   wrangler kv namespace create PUSH_KV
   ```
   It prints an `id`. Open `wrangler.toml` and replace
   `YOUR_KV_NAMESPACE_ID` with that id.
5. Generate your own VAPID key pair (never reuse an example key pair from
   anywhere, including this conversation):
   ```
   node -e "
   const { webcrypto } = require('node:crypto');
   (async () => {
     const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
     const pub = await webcrypto.subtle.exportKey('raw', publicKey);
     const priv = await webcrypto.subtle.exportKey('jwk', privateKey);
     const b64url = b => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
     console.log('PUBLIC (paste into worker.js AND index.html):\n' + b64url(pub));
     console.log('\nPRIVATE JWK (paste when wrangler secret put asks):\n' + JSON.stringify(priv));
   })();
   "
   ```
6. Paste the **PUBLIC** key into two places, replacing the exact
   placeholder string `REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY`:
   - `edupage-relay/worker.js` — the `VAPID_PUBLIC_KEY` constant near the top.
   - `index.html` — the `VAPID_PUBLIC_KEY` variable (search for it; it's
     right before the Notifications settings code).
7. Set the **PRIVATE** key as a Worker secret (paste the whole JWK JSON as
   one line when it prompts; this is never committed to git):
   ```
   wrangler secret put VAPID_PRIVATE_KEY_JWK
   ```
8. Deploy:
   ```
   wrangler deploy
   ```
   Wrangler prints a URL like
   `https://notesino-edupage-relay.<your-subdomain>.workers.dev` — that's
   the one "Relay URL" used by both EduPage Sync and Notifications in the
   app. It only needs to be entered once per device; the app remembers it.
9. In the app: Timetable → EduPage Sync… for your school login, and the
   "More" (⋮) menu → Notifications… to turn notifications on. Enter the
   **same sync code** on every device you want notified together, then
   use "Send test notification" to confirm it actually reaches that
   device before relying on it for anything real.
10. **Optional** -- only if you want "Auto-refresh in background" (in the
    EduPage Sync panel) to work: generate and set a credential encryption
    key, so your EduPage password can be stored encrypted-at-rest for the
    Cron Trigger to use later. Skip this step entirely if you don't want
    that feature; everything else above works without it.
    ```
    node -e "
    const { webcrypto } = require('node:crypto');
    const raw = webcrypto.getRandomValues(new Uint8Array(32));
    let binary = ''; for (let i = 0; i < raw.length; i++) binary += String.fromCharCode(raw[i]);
    console.log(Buffer.from(binary, 'binary').toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+\$/,''));
    "
    ```
    Then set it as a secret (paste the printed key when it prompts):
    ```
    wrangler secret put CRED_ENCRYPTION_KEY
    ```
    Redeploy (`wrangler deploy`) after setting it.

Redeploying later (e.g. after an update to `worker.js`) is just
`wrangler deploy` again from this folder — the KV namespace and secrets
stay configured.

## Auto-deploy (skip the manual `wrangler deploy` step entirely)

A GitHub Actions workflow (`.github/workflows/deploy-relay.yml`) redeploys
this Worker automatically every time `edupage-relay/` changes on the repo's
main branch — the same way the website already auto-deploys. One-time
setup:

1. Create a Cloudflare API token at
   https://dash.cloudflare.com/profile/api-tokens → "Create Token" → use
   the **"Edit Cloudflare Workers"** template → create it and copy the
   token (shown only once).
2. In the GitHub repo: Settings → Secrets and variables → Actions → "New
   repository secret" → name it exactly `CLOUDFLARE_API_TOKEN` → paste the
   token → Save.

That's it — from then on, any push that touches this folder deploys itself
within about a minute, with nothing to run locally. The KV namespace and
any `wrangler secret put` secrets you already set stay exactly as they
are; this workflow only redeploys the Worker's code.

## What EduPage sync needs from you each time

- **School subdomain** — the part before `.edupage.org` in your school's
  EduPage address (e.g. if your school's address is
  `https://gymxyz.edupage.org`, the subdomain is `gymxyz`).
- **Username** and **password** — your own EduPage login. The password is
  sent once per sync directly to your own deployed Worker over HTTPS and is
  never written to disk anywhere in Notesino.

## Privacy / trust notes

- You are deploying and running this Worker yourself, under your own
  Cloudflare account — Notesino's authors (including this Claude session)
  never see your EduPage credentials, your timetable, your reminders, or
  your push subscriptions.
- Push notification content (reminder titles/bodies and upcoming times)
  does leave your device to be stored in your own KV namespace, since a
  server has to know what to push and when — but it's the same one Worker
  you already trust with your EduPage login, under your own account.
- The Worker's CORS header currently allows any origin
  (`Access-Control-Allow-Origin: *`) so Notesino (wherever you're running
  it from) can call it. If you want to lock it down, change
  `ALLOWED_ORIGIN` at the top of `worker.js` to your app's exact origin
  and redeploy.
- **The app remembers your EduPage login on your own device, by request.**
  The EduPage Sync panel's relay URL, subdomain, username and password are
  saved in this browser's local storage (not synced anywhere, never sent
  anywhere except to your own relay on each sync) purely so you don't have
  to retype them — clearing this site's browser data forgets them.
- **"Auto-refresh in background" additionally stores your EduPage
  password on the relay itself**, encrypted at rest (AES-GCM, with
  `CRED_ENCRYPTION_KEY` — a key only your deployment holds) in the same KV
  entry as your sync code, so its Cron Trigger can log in again on its own
  every ~10 minutes. Turning that toggle back off deletes it from KV
  immediately. Since you deploy and hold this Worker yourself, this is
  still only you (and EduPage) ever seeing your real password.
