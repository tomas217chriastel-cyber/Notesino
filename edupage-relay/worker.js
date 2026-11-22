/*
 * Notesino relay (Cloudflare Worker)
 * ---------------------------------------------------------------
 * Two unrelated jobs living in one deployed Worker so there's only
 * one thing to set up:
 *
 * 1. EduPage sync (unchanged from before): edupage.org has no public
 *    API and no CORS, and its login is a multi-step cookie-bound
 *    flow, so this performs that flow server-side, on each request,
 *    and stores nothing. POST to "/" (or any path other than the
 *    ones below).
 *    Request:  POST { subdomain, username, password, dateFrom, dateTo }
 *    Response: { ok: true, days: { "YYYY-MM-DD": [ {start,end,subject,room,teacher,free,cancelled,raw} ] } }
 *           or { ok: false, step: "...", error: "..." }
 *    `cancelled` is true when EduPage itself marked the lesson removed or
 *    teacher-absent. `raw` is the untouched EduPage plan item for that
 *    lesson -- kept only so a substitution/room-change field can be found
 *    later from a real example (none is confirmed yet; see README).
 *
 * 2. Push notifications: browsers can't push to a closed app/device
 *    by themselves -- that needs a server holding the device's push
 *    subscription and sending to it at the right time. This Worker
 *    stores (in KV) a small per-"sync code" group of push
 *    subscriptions and upcoming {title, body, fireAt} items the
 *    client computed locally (from reminders/subject notes/
 *    timetable), and a Cron Trigger sweeps every few minutes for
 *    items whose time has come and sends a real Web Push (RFC 8291 +
 *    VAPID) to every device in that group.
 *      POST /push/subscribe  { syncCode, subscription }
 *      POST /push/sync       { syncCode, items: [{id,title,body,fireAt}] }
 *      POST /push/test       { syncCode }   -- sends an immediate test push
 *
 * 3. EduPage auto-refresh (opt-in, needs an extra secret -- see README.md):
 *    stores an encrypted copy of your EduPage login in this group's KV
 *    entry so the same Cron Trigger can log in periodically on its own,
 *    re-check the timetable, cache it, and push a notification when
 *    something actually changed -- without you reopening the app or
 *    re-entering your password. This is the one case where EduPage
 *    credentials are stored anywhere, and only because you explicitly
 *    turned this feature on.
 *      POST /edupage/auto    { syncCode, subdomain, username, password }
 *                          or { syncCode, enabled: false }  -- turns it off
 *      GET  /edupage/cached?syncCode=...  -- last cached snapshot, if any
 *
 * Reverse-engineered from the reference implementation at
 * https://github.com/EdupageAPI/edupage-api (GPL-3.0, Python) --
 * this is an UNOFFICIAL integration against undocumented endpoints.
 * EduPage can change its site at any time and break this; if a step
 * fails, the error response names which step failed so it can be
 * fixed without guessing.
 *
 * Deploy: `wrangler deploy` from this directory (see README.md) --
 * needs a KV namespace bound as PUSH_KV and a VAPID_PRIVATE_KEY_JWK
 * secret; see README.md for exact commands.
 */

const ALLOWED_ORIGIN = '*'; // tighten to your Notesino origin if you want to lock this down

/* Public half of your VAPID key pair -- safe to be public (it's also
   embedded in the client's subscribe call, where it MUST match exactly).
   The private half lives only in the VAPID_PRIVATE_KEY_JWK secret. Generate
   your own pair; see README.md for the exact command and where each half
   goes. Do not reuse any example key pair. */
const VAPID_PUBLIC_KEY = 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY';

function withCors(res) {
  res.headers.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

class StepError extends Error {
  constructor(step, detail) {
    super(step + ': ' + detail);
    this.step = step;
    this.detail = detail;
  }
}

/* ---------- Cookie jar (Workers' fetch doesn't keep one for you) ---------- */
class CookieJar {
  constructor() { this.cookies = new Map(); }
  updateFrom(response) {
    const list = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const sc of list) {
      const first = sc.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) this.cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
    }
  }
  header() {
    return Array.from(this.cookies.entries()).map(([k, v]) => k + '=' + v).join('; ');
  }
}

async function jarFetch(jar, url, options = {}) {
  const headers = new Headers(options.headers || {});
  const cookieHeader = jar.header();
  if (cookieHeader) headers.set('Cookie', cookieHeader);
  headers.set('User-Agent', 'Mozilla/5.0 (compatible; NotesinoEduPageRelay/1.0)');
  const res = await fetch(url, { ...options, headers, redirect: 'manual' });
  jar.updateFrom(res);
  return res;
}

async function followRedirects(jar, res, baseUrl, maxHops = 6) {
  let current = res;
  let from = baseUrl;
  let hops = 0;
  while ([301, 302, 303, 307, 308].includes(current.status) && hops < maxHops) {
    const loc = current.headers.get('location');
    if (!loc) break;
    const nextUrl = new URL(loc, from).toString();
    current = await jarFetch(jar, nextUrl, { method: 'GET' });
    from = nextUrl;
    hops++;
  }
  return current;
}

/* ---------- form encoding ---------- */
function toFormUrlEncoded(obj) {
  return Object.entries(obj)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v === null || v === undefined ? '' : v))
    .join('&');
}

/* ---------- login RPC wire format (zlib raw-deflate + base64 + sha1), mirrors
   edupage_api/compression.py's RequestData.encode_request_body ---------- */
async function sha1Hex(str) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function rawDeflateBase64(str) {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  return bytesToBase64(compressed);
}

async function encodeRpcBody(paramsObj) {
  const formData = toFormUrlEncoded({ rpcparams: JSON.stringify(paramsObj) });
  const dz = await rawDeflateBase64(formData);
  const eqap = 'dz:' + dz;
  const eqacs = await sha1Hex(eqap);
  return toFormUrlEncoded({ eqap, eqacs, eqaz: '1' });
}

/* The reference implementation's "eqz:"/"eqwd:" responses are base64 only --
   despite the "z" in the name, decode_response never calls zlib.decompress;
   __decode_data is just chromium_base64_decode. Only requests are compressed. */
function decodeRpcResponse(text) {
  if (text.startsWith('eqwd:')) return atob(text.slice(5).replace(/[\t\n\f\r]/g, ''));
  if (text.startsWith('eqz:')) return atob(text.slice(4).replace(/[\t\n\f\r]/g, ''));
  return text;
}

/* rsplit(sep, n)[0] equivalent: strip at most the last n occurrences of sep
   and everything after the first of those. */
function rsplitKeepHead(str, sep, n) {
  const parts = str.split(sep);
  if (parts.length <= n) return parts[0];
  return parts.slice(0, parts.length - n).join(sep);
}

/* Balanced-brace scan: find the JSON object starting at the first "{" at or
   after `from`, matching up the braces so trailing non-JSON text (if any) is
   ignored instead of guessed at with a fixed-offset slice. */
function extractBalancedJsonObject(text, from) {
  const start = text.indexOf('{', from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/* ---------- main flow ---------- */
/* Split into login + fetch so the auto-refresh cron can log in once and
   fetch both weeks, instead of logging in twice per group per sweep. */
async function loginToEdupage({ subdomain, username, password }) {
  const jar = new CookieJar();
  const base = 'https://' + subdomain + '.edupage.org';

  let res = await jarFetch(jar, base + '/login/?cmd=MainLogin');
  if (!res.ok) throw new StepError('login-page', 'HTTP ' + res.status + ' loading the login page');

  const tokenBody = await encodeRpcBody({ username, edupage: '' });
  res = await jarFetch(jar, base + '/login/?cmd=MainLogin&akcia=getToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  });
  let decoded = await decodeRpcResponse(await res.text());
  let tokenJson;
  try { tokenJson = JSON.parse(decoded); } catch (e) {
    throw new StepError('get-token-parse', 'EduPage did not return JSON for getToken: ' + decoded.slice(0, 200));
  }
  const userToken = tokenJson && tokenJson.token;
  if (!userToken) throw new StepError('get-token-missing', JSON.stringify(tokenJson).slice(0, 200));

  const loginBody = await encodeRpcBody({
    username, password, userToken, edupage: '', ctxt: '', tu: null, gu: null, au: null
  });
  res = await jarFetch(jar, base + '/login/?cmd=MainLogin&akcia=login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: loginBody
  });
  decoded = await decodeRpcResponse(await res.text());
  let loginJson;
  try { loginJson = JSON.parse(decoded); } catch (e) {
    throw new StepError('login-parse', 'EduPage did not return JSON for login: ' + decoded.slice(0, 200));
  }
  if (loginJson && loginJson.err && loginJson.err.error_id) {
    throw new StepError('login-rejected', 'EduPage error: ' + loginJson.err.error_id);
  }
  const redirectUrl = loginJson && loginJson.redirectUrl;
  if (!redirectUrl) throw new StepError('login-no-redirect', JSON.stringify(loginJson).slice(0, 200));

  const redirectAbs = new URL(redirectUrl, base).toString();
  res = await jarFetch(jar, redirectAbs);
  res = await followRedirects(jar, res, redirectAbs);
  const homeHtml = await res.text();
  if (/[?&]bad=1(&|$)/.test(res.url || '') || homeHtml.includes('bad=1')) {
    throw new StepError('bad-credentials', 'EduPage rejected the username/password.');
  }
  if (/[?&](cap=1|lerr=b43b43)/.test(res.url || '')) {
    throw new StepError('captcha-required', 'EduPage is asking for a captcha -- log in once in a real browser, then try again.');
  }
  if (res.url && /\/login\/twofactor/.test(res.url)) {
    throw new StepError('two-factor-required', 'This account has two-factor login enabled, which this relay cannot complete.');
  }

  const uhMarker = 'userhome(';
  const uhIdx = homeHtml.indexOf(uhMarker);
  if (uhIdx === -1) throw new StepError('userhome-missing', 'Could not find the post-login data block. EduPage may have changed its page.');
  const afterMarker = homeHtml.slice(uhIdx + uhMarker.length);
  const jsonStr = rsplitKeepHead(afterMarker, ');', 2).replace(/[\t\n\r]/g, '');
  let data;
  try { data = JSON.parse(jsonStr); } catch (e) {
    throw new StepError('userhome-parse', 'Could not parse the post-login data block as JSON.');
  }
  const userId = data && data.userid;
  const dbi = (data && data.dbi) || {};
  if (!userId) throw new StepError('userid-missing', 'Logged in, but could not find the account id.');

  return { jar, base, userId, dbi };
}

async function fetchTimetableRange({ jar, base, userId, dbi, dateFrom, dateTo }) {
  let res = await jarFetch(jar, base + '/dashboard/eb.php?mode=ttday');
  const ebHtml = await res.text();
  let gpidRaw, gsh;
  try {
    gpidRaw = ebHtml.split('gpid=')[1].split('&')[0];
    gsh = ebHtml.split('gsh=')[1].split('"')[0];
  } catch (e) {
    throw new StepError('gpid-gsh-missing', 'Could not find the timetable security token on the dashboard page.');
  }
  if (!gpidRaw || !gsh) throw new StepError('gpid-gsh-empty', 'Timetable security token was empty.');
  const gpid = String((parseInt(gpidRaw, 10) || 0) + 1);

  const gcallBody = toFormUrlEncoded({
    action: 'loadData',
    gpid,
    gsh,
    user: userId,
    date: dateFrom,
    dateto: dateTo
  });
  res = await jarFetch(jar, base + '/gcall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: gcallBody
  });
  const gcallText = await res.text();
  const marker = userId + '",';
  const markerIdx = gcallText.indexOf(marker);
  const searchFrom = markerIdx === -1 ? 0 : markerIdx + marker.length;
  const objText = extractBalancedJsonObject(gcallText, searchFrom) || extractBalancedJsonObject(gcallText, 0);
  if (!objText) throw new StepError('timetable-parse', 'Could not find timetable data in EduPage\'s response.');
  let planData;
  try { planData = JSON.parse(objText); } catch (e) {
    throw new StepError('timetable-json', 'Timetable data did not parse as JSON.');
  }
  const dates = planData.dates || planData;
  if (!dates || typeof dates !== 'object') throw new StepError('timetable-empty', 'EduPage returned no per-day schedule.');

  function subjectName(id) {
    const s = dbi.subjects && dbi.subjects[String(id)];
    return s ? (s.name || s.short || '') : '';
  }
  function classroomName(id) {
    const c = dbi.classrooms && dbi.classrooms[String(id)];
    return c ? (c.short || c.name || '') : '';
  }
  function teacherName(id) {
    const t = dbi.teachers && dbi.teachers[String(id)];
    if (!t) return '';
    if (t.firstname || t.lastname) return [t.firstname, t.lastname].filter(Boolean).join(' ');
    return t.name || t.short || '';
  }
  function fixTime(t) { return t === '24:00' ? '23:59' : t; }

  const days = {};
  // Tracks, per day, how many raw EduPage plan items existed before any
  // filtering -- lets the client's diagnostic tell apart "EduPage genuinely
  // sent nothing for this day" from "EduPage sent items but every one got
  // filtered out here" (calendar 'event' entries, or the blank-filler skip)
  // instead of both looking identically like a plain 0.
  const rawCounts = {};
  for (const dateKey of Object.keys(dates)) {
    const dayObj = dates[dateKey];
    const plan = (dayObj && dayObj.plan) || [];
    rawCounts[dateKey] = plan.length;
    const lessons = [];
    for (const item of plan) {
      // "event" items are calendar entries, not real lessons -- skip those,
      // but keep removed/absent lessons (marked cancelled) instead of
      // dropping them, so the client can show them struck through.
      if (!item || item.type === 'event') continue;
      const subjIds = item.subjectid !== undefined ? [item.subjectid] : [];
      const classroomIds = Array.isArray(item.classroomids) ? item.classroomids : [];
      const teacherIds = Array.isArray(item.teacherids) ? item.teacherids : [];
      const subject = subjIds.map(subjectName).filter(Boolean).join(', ');
      const room = classroomIds.map(classroomName).filter(Boolean).join(', ');
      const teacher = teacherIds.map(teacherName).filter(Boolean).join(', ');
      // `item.type === ''` turned out to also match ordinary blank schedule
      // slots (confirmed against a real account), not just real cancelled
      // lessons -- only `removed`/`absent` are confirmed-reliable signals.
      const cancelled = !!(item.removed || item.type === 'absent');
      // A blank filler slot (no subject/room/teacher at all, and not an
      // actual cancellation of a named lesson) isn't a real lesson -- skip
      // it so it reads as an ordinary empty period, not a phantom cancelled one.
      if (!subject && !room && !teacher && !cancelled) continue;
      lessons.push({
        start: fixTime(item.starttime || ''),
        end: fixTime(item.endtime || ''),
        subject,
        room,
        teacher,
        free: false,
        cancelled,
        raw: item
      });
    }
    lessons.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    days[dateKey] = lessons;
  }

  return { ok: true, days, rawCounts };
}

/* EduPage's day-plan endpoint has been confirmed (against a real account) to
   silently return entries for only the first couple of days of a multi-day
   date-range request, no matter how wide a range is actually asked for --
   not just empty, genuinely absent from the response. Fetching one day at a
   time sidesteps that, whatever its exact cause: each request's own range
   is a single day, so there's nothing left for EduPage to truncate. */
function enumerateDates(dateFromStr, dateToStr) {
  const parse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const fmt = ms => {
    const d = new Date(ms);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  };
  const out = [];
  for (let t = parse(dateFromStr); t <= parse(dateToStr); t += 86400000) out.push(fmt(t));
  return out;
}

/* A day coming back with zero lessons has been seen even for a day the
   user confirms has real classes -- with each day now its own isolated
   request, that doesn't match the "EduPage truncates wide ranges" cause
   this function was built for, and looks instead like an occasional bad
   gpid/gsh handshake for that one request (14 rapid logins-worth of
   token churn against the same session), which can also throw outright
   (e.g. a malformed gcall response) rather than just come back empty.
   Both attempts are caught here -- a day that keeps failing is reported
   as a per-day error, not thrown, so it can't abort every other day's
   already-fetched data (see fetchTimetableRangeByDay). */
async function fetchDayWithRetry(session, dateKey) {
  try {
    var result = await fetchTimetableRange({ ...session, dateFrom: dateKey, dateTo: dateKey });
    if (result.days[dateKey] && result.days[dateKey].length) return result;
  } catch (e) {
    result = null;
  }
  try {
    var retry = await fetchTimetableRange({ ...session, dateFrom: dateKey, dateTo: dateKey });
    return retry;
  } catch (e) {
    if (result) return result; // first attempt at least resolved (even if empty) -- use that over a hard error
    return { days: {}, error: { step: (e && e.step) || 'unknown', message: (e && e.message) || String(e) } };
  }
}

/* One bad day (a transient parse/token failure on that single request)
   used to throw and abort the entire multi-day sync, discarding every
   other day that had already succeeded -- confirmed in practice: a
   failure on one day wiped out a sync that otherwise had real data for
   the rest of the week. Each day is now isolated: a day that still fails
   after its retry is simply left out of `days` (and named in
   `failedDays`) instead of failing the whole request. */
async function fetchTimetableRangeByDay(session, dateFrom, dateTo) {
  const days = {};
  const failedDays = {};
  const rawCounts = {};
  for (const dateKey of enumerateDates(dateFrom, dateTo)) {
    const result = await fetchDayWithRetry(session, dateKey);
    if (result.error) failedDays[dateKey] = result.error;
    else {
      Object.assign(days, result.days);
      Object.assign(rawCounts, result.rawCounts);
    }
  }
  return { ok: true, days, failedDays, rawCounts };
}

async function loginAndFetchTimetable({ subdomain, username, password, dateFrom, dateTo }) {
  const session = await loginToEdupage({ subdomain, username, password });
  return fetchTimetableRangeByDay(session, dateFrom, dateTo);
}

/* Used by the auto-refresh cron: one login, two separate week-long fetches
   (see index.html's client-side sync for why two weeks must be fetched
   separately rather than as one combined range), each itself done day by
   day, merged into one days map. */
async function fetchTwoWeekSnapshot({ subdomain, username, password, week1From, week1To, week2From, week2To }) {
  const session = await loginToEdupage({ subdomain, username, password });
  const week1 = await fetchTimetableRangeByDay(session, week1From, week1To);
  const week2 = await fetchTimetableRangeByDay(session, week2From, week2To);
  return { ok: true, days: Object.assign({}, week1.days, week2.days) };
}

async function handleEdupageSync(request) {
  if (request.method !== 'POST') return withCors(json({ ok: false, step: 'method', error: 'Use POST' }, 405));

  let body;
  try { body = await request.json(); } catch (e) {
    return withCors(json({ ok: false, step: 'request-body', error: 'Invalid JSON body' }, 400));
  }

  const { subdomain, username, password, dateFrom, dateTo } = body || {};
  if (!subdomain || !username || !password || !dateFrom || !dateTo) {
    return withCors(json({
      ok: false,
      step: 'request-fields',
      error: 'Missing one of: subdomain, username, password, dateFrom, dateTo'
    }, 400));
  }

  try {
    const result = await loginAndFetchTimetable({ subdomain, username, password, dateFrom, dateTo });
    return withCors(json(result, 200));
  } catch (err) {
    const step = err && err.step ? err.step : 'unknown';
    const message = err && err.message ? err.message : String(err);
    return withCors(json({ ok: false, step, error: message }, 502));
  }
}

/* ---------- Push notifications (Web Push: RFC 8291 encryption + RFC 8292 VAPID) ----------
   No npm dependency -- implemented directly against WebCrypto so it runs in the
   Workers runtime with nothing extra to bundle. */

const VAPID_SUBJECT = 'mailto:notesino-push@example.com';

function groupKvKey(syncCode) { return 'group:' + syncCode; }

async function loadGroup(env, syncCode) {
  const raw = await env.PUSH_KV.get(groupKvKey(syncCode));
  if (!raw) return { subscriptions: [], items: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      subscriptions: parsed.subscriptions || [],
      items: parsed.items || [],
      eduAuto: parsed.eduAuto,
      eduCache: parsed.eduCache
    };
  } catch (e) {
    return { subscriptions: [], items: [] };
  }
}

async function saveGroup(env, syncCode, group) {
  await env.PUSH_KV.put(groupKvKey(syncCode), JSON.stringify(group));
}

async function handlePushSubscribe(request, env) {
  if (request.method !== 'POST') return withCors(json({ ok: false, error: 'Use POST' }, 405));
  let body;
  try { body = await request.json(); } catch (e) { return withCors(json({ ok: false, error: 'Invalid JSON body' }, 400)); }
  const { syncCode, subscription } = body || {};
  if (!syncCode || !subscription || !subscription.endpoint || !subscription.keys) {
    return withCors(json({ ok: false, error: 'Missing syncCode or subscription' }, 400));
  }
  const group = await loadGroup(env, syncCode);
  group.subscriptions = group.subscriptions.filter(s => s.endpoint !== subscription.endpoint);
  group.subscriptions.push({ endpoint: subscription.endpoint, keys: subscription.keys, addedAt: Date.now() });
  await saveGroup(env, syncCode, group);
  return withCors(json({ ok: true, deviceCount: group.subscriptions.length }, 200));
}

async function handlePushSync(request, env) {
  if (request.method !== 'POST') return withCors(json({ ok: false, error: 'Use POST' }, 405));
  let body;
  try { body = await request.json(); } catch (e) { return withCors(json({ ok: false, error: 'Invalid JSON body' }, 400)); }
  const { syncCode, items } = body || {};
  if (!syncCode || !Array.isArray(items)) {
    return withCors(json({ ok: false, error: 'Missing syncCode or items' }, 400));
  }
  const group = await loadGroup(env, syncCode);
  const prevById = new Map(group.items.map(it => [it.id, it]));
  group.items = items
    .filter(it => it && it.id && it.fireAt)
    .map(it => {
      const prev = prevById.get(it.id);
      const sent = prev && prev.fireAt === it.fireAt ? !!prev.sent : false;
      return { id: it.id, title: String(it.title || 'Reminder').slice(0, 120), body: String(it.body || '').slice(0, 200), fireAt: it.fireAt, sent };
    });
  await saveGroup(env, syncCode, group);
  return withCors(json({ ok: true, itemCount: group.items.length, deviceCount: group.subscriptions.length }, 200));
}

async function handlePushTest(request, env) {
  if (request.method !== 'POST') return withCors(json({ ok: false, error: 'Use POST' }, 405));
  if (VAPID_PUBLIC_KEY === 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY' || !env.VAPID_PRIVATE_KEY_JWK) {
    return withCors(json({ ok: false, error: 'This Worker has no VAPID key pair set up yet -- see README.md.' }, 500));
  }
  let body;
  try { body = await request.json(); } catch (e) { return withCors(json({ ok: false, error: 'Invalid JSON body' }, 400)); }
  const { syncCode } = body || {};
  if (!syncCode) return withCors(json({ ok: false, error: 'Missing syncCode' }, 400));
  const group = await loadGroup(env, syncCode);
  if (!group.subscriptions.length) {
    return withCors(json({ ok: false, error: 'No devices registered for this sync code yet.' }, 400));
  }
  const results = await sendToAll(env, group.subscriptions, { title: 'Notesino', body: 'Test notification — push is working.' });
  const stillValid = group.subscriptions.filter((s, i) => results[i] !== 'gone');
  if (stillValid.length !== group.subscriptions.length) {
    group.subscriptions = stillValid;
    await saveGroup(env, syncCode, group);
  }
  return withCors(json({ ok: true, sentTo: results.filter(r => r === 'sent').length, devices: group.subscriptions.length }, 200));
}

function b64urlEncode(bytes) {
  let binary = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  // Strips anything that isn't valid base64url first -- a secret pasted in
  // via `wrangler secret put` has been seen to pick up a trailing newline
  // (from copying a console.log'd value), which made atob() throw outright
  // ("invalid base64-encoded data") instead of just decoding the real key.
  str = (str || '').replace(/[^A-Za-z0-9_-]/g, '');
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}
async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes));
}
async function hkdfExpandOneBlock(prk, info, length) {
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

/* ---------- EduPage auto-refresh: encrypted-at-rest credential storage ----------
   Opt-in only (see handleEdupageAutoSave) -- stores subdomain/username/password
   in this group's KV entry so the Cron trigger can re-check the timetable
   periodically and push a notification when it changes, without the user
   re-entering their login every time. Password is AES-GCM encrypted with a
   key only this Worker holds (CRED_ENCRYPTION_KEY secret); nobody else
   (including Notesino's authors) can read it. */
async function importCredKey(env) {
  const raw = b64urlDecode(env.CRED_ENCRYPTION_KEY);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptCredential(env, plaintext) {
  const key = await importCredKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)));
  return { iv: b64urlEncode(iv), ciphertext: b64urlEncode(ciphertext) };
}

async function decryptCredential(env, enc) {
  const key = await importCredKey(env);
  const iv = b64urlDecode(enc.iv);
  const ciphertext = b64urlDecode(enc.ciphertext);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

async function handleEdupageAutoSave(request, env) {
  if (request.method !== 'POST') return withCors(json({ ok: false, error: 'Use POST' }, 405));
  let body;
  try { body = await request.json(); } catch (e) { return withCors(json({ ok: false, error: 'Invalid JSON body' }, 400)); }
  const { syncCode, subdomain, username, password, enabled } = body || {};
  if (!syncCode) return withCors(json({ ok: false, error: 'Missing syncCode' }, 400));

  if (enabled === false) {
    const group = await loadGroup(env, syncCode);
    delete group.eduAuto;
    delete group.eduCache;
    await saveGroup(env, syncCode, group);
    return withCors(json({ ok: true, enabled: false }, 200));
  }

  if (!env.CRED_ENCRYPTION_KEY) {
    return withCors(json({ ok: false, error: 'This Worker has no CRED_ENCRYPTION_KEY set up yet -- see README.md.' }, 500));
  }
  if (!subdomain || !username || !password) {
    return withCors(json({ ok: false, error: 'Missing subdomain, username or password' }, 400));
  }
  const group = await loadGroup(env, syncCode);
  group.eduAuto = { subdomain, username, encPassword: await encryptCredential(env, password), updatedAt: Date.now() };
  await saveGroup(env, syncCode, group);
  return withCors(json({ ok: true, enabled: true }, 200));
}

async function handleEdupageCached(request, env) {
  const url = new URL(request.url);
  const syncCode = url.searchParams.get('syncCode');
  if (!syncCode) return withCors(json({ ok: false, error: 'Missing syncCode' }, 400));
  const group = await loadGroup(env, syncCode);
  if (!group.eduCache) return withCors(json({ ok: true, days: null, updatedAt: null }, 200));
  return withCors(json({ ok: true, days: group.eduCache.days, updatedAt: group.eduCache.updatedAt }, 200));
}

function isoDateUTC(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function addDaysUTC(d, days) { return new Date(d.getTime() + days * 86400000); }
function mondayOfWeekUTC(d) {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() + offset);
  return monday;
}

/* Builds a comparable snapshot of a days map -- excludes the `raw` passthrough
   field (not meant for change-detection, only for finding a substitution
   field later) so unrelated noise there can never trigger a false "changed". */
function snapshotForCompare(days) {
  const out = {};
  Object.keys(days).sort().forEach(function(k) {
    out[k] = (days[k] || []).map(function(l) {
      return [l.start, l.end, l.subject, l.room, l.teacher, l.cancelled ? 1 : 0].join('|');
    });
  });
  return JSON.stringify(out);
}

/* Cron entry point: for every group that opted into auto-refresh, re-fetch
   this week + next week (one login, two fetches) and compare against the
   last known snapshot. First run after enabling just establishes a
   baseline (nothing to push yet); later runs push a change notification
   and refresh the cached snapshot the client can read without logging in
   itself. A transient EduPage/login failure for one group is swallowed so
   it doesn't wipe out that group's last-known-good cache, and doesn't stop
   the sweep from reaching the remaining groups. */
async function refreshAutoGroups(env) {
  if (!env.CRED_ENCRYPTION_KEY) return;
  const now = new Date();
  const thisMonday = mondayOfWeekUTC(now);
  const week1From = isoDateUTC(thisMonday), week1To = isoDateUTC(addDaysUTC(thisMonday, 6));
  const nextMonday = addDaysUTC(thisMonday, 7);
  const week2From = isoDateUTC(nextMonday), week2To = isoDateUTC(addDaysUTC(nextMonday, 6));

  let cursor;
  do {
    const listed = await env.PUSH_KV.list({ prefix: 'group:', cursor });
    for (const key of listed.keys) {
      const syncCode = key.name.slice('group:'.length);
      const group = await loadGroup(env, syncCode);
      if (!group.eduAuto) continue;
      try {
        const password = await decryptCredential(env, group.eduAuto.encPassword);
        const result = await fetchTwoWeekSnapshot({
          subdomain: group.eduAuto.subdomain,
          username: group.eduAuto.username,
          password,
          week1From, week1To, week2From, week2To
        });
        const snap = snapshotForCompare(result.days);
        const isFirstRun = !group.eduCache;
        const changed = !isFirstRun && group.eduCache.snapshot !== snap;
        group.eduCache = { days: result.days, snapshot: snap, updatedAt: Date.now() };
        await saveGroup(env, syncCode, group);
        if (changed && group.subscriptions.length) {
          await sendToAll(env, group.subscriptions, { title: 'Notesino', body: "Your EduPage timetable changed — open the app to see what's new." });
        }
      } catch (e) {
        // leave group.eduAuto/eduCache untouched; try again next sweep
      }
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

async function importVapidPrivateKey(env) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_KEY_JWK);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function signVapidJwt(privateKey, endpointUrl) {
  const aud = new URL(endpointUrl).origin;
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT };
  const unsigned = b64urlEncode(new TextEncoder().encode(JSON.stringify(header))) + '.' +
    b64urlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(unsigned));
  return unsigned + '.' + b64urlEncode(new Uint8Array(sig));
}

/* RFC 8291 "aes128gcm" encryption of a Web Push message body. */
async function encryptWebPush(uaPublicB64url, authB64url, plaintextBytes) {
  const uaPublic = b64urlDecode(uaPublicB64url);
  const authSecret = b64urlDecode(authB64url);

  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const senderKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, senderKeyPair.privateKey, 256));
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeyPair.publicKey));

  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(new TextEncoder().encode('WebPush: info'), new Uint8Array([0]), uaPublic, asPublicRaw);
  const ikm = await hkdfExpandOneBlock(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpandOneBlock(prk, concatBytes(new TextEncoder().encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdfExpandOneBlock(prk, concatBytes(new TextEncoder().encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const padded = concatBytes(plaintextBytes, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded));

  const rsBuf = new Uint8Array(4);
  new DataView(rsBuf.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, rsBuf, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concatBytes(header, ciphertext);
}

/* Sends one Web Push message; returns 'sent', 'gone' (404/410 -- caller should
   drop this subscription), or 'failed'. */
async function sendWebPush(env, subscription, payloadObj) {
  try {
    const vapidKey = await importVapidPrivateKey(env);
    const jwt = await signVapidJwt(vapidKey, subscription.endpoint);
    const plaintext = new TextEncoder().encode(JSON.stringify(payloadObj));
    const body = await encryptWebPush(subscription.keys.p256dh, subscription.keys.auth, plaintext);

    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'TTL': '86400',
        'Authorization': 'vapid t=' + jwt + ', k=' + VAPID_PUBLIC_KEY
      },
      body
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'sent' : 'failed';
  } catch (e) {
    return 'failed';
  }
}

async function sendToAll(env, subscriptions, payloadObj) {
  return Promise.all(subscriptions.map(s => sendWebPush(env, s, payloadObj)));
}

/* Cron entry point: find due, unsent items across every sync-code group and push them. */
async function sweepAndSendPushes(env) {
  const now = Date.now();
  let cursor;
  do {
    const listed = await env.PUSH_KV.list({ prefix: 'group:', cursor });
    for (const key of listed.keys) {
      const syncCode = key.name.slice('group:'.length);
      const group = await loadGroup(env, syncCode);
      const due = group.items.filter(it => !it.sent && it.fireAt <= now);
      if (!due.length || !group.subscriptions.length) continue;

      let subscriptionsChanged = false;
      for (const item of due) {
        const results = await sendToAll(env, group.subscriptions, { title: item.title, body: item.body });
        const stillValid = group.subscriptions.filter((s, i) => results[i] !== 'gone');
        if (stillValid.length !== group.subscriptions.length) {
          group.subscriptions = stillValid;
          subscriptionsChanged = true;
        }
        item.sent = true;
      }
      if (due.length || subscriptionsChanged) await saveGroup(env, syncCode, group);
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    const path = new URL(request.url).pathname.replace(/\/+$/, '');

    // Any exception that escapes here (a platform-level error like "Too many
    // subrequests", or a bug in a handler) used to fall through to
    // Cloudflare's own plain-text/HTML error page -- which isn't JSON, so
    // the client's res.json() failed and showed a content-free "The relay
    // did not respond as expected." Catching it here means the client
    // always gets back real JSON with the actual error message instead.
    try {
      if (path === '/push/subscribe') return await handlePushSubscribe(request, env);
      if (path === '/push/sync') return await handlePushSync(request, env);
      if (path === '/push/test') return await handlePushTest(request, env);
      if (path === '/edupage/auto') return await handleEdupageAutoSave(request, env);
      if (path === '/edupage/cached') return await handleEdupageCached(request, env);

      return await handleEdupageSync(request);
    } catch (err) {
      const message = (err && err.message) || String(err);
      return withCors(json({ ok: false, step: 'worker-exception', error: message }, 500));
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sweepAndSendPushes(env));
    ctx.waitUntil(refreshAutoGroups(env));
  }
};
