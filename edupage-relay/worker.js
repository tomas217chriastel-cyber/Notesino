/*
 * Notesino EduPage relay (Cloudflare Worker)
 * ---------------------------------------------------------------
 * EduPage (edupage.org) has no official public API and no CORS
 * headers that would let a browser call it directly, and its login
 * is a multi-step, cookie-bound flow. This Worker performs that
 * flow server-side, on each request, and never stores anything --
 * no KV, no database, no logging of credentials. It exists purely
 * to let the Notesino app ask "what's my timetable between these
 * two dates" without the user's password or school account ever
 * touching Notesino's own code.
 *
 * Reverse-engineered from the reference implementation at
 * https://github.com/EdupageAPI/edupage-api (GPL-3.0, Python) --
 * this is an UNOFFICIAL integration against undocumented endpoints.
 * EduPage can change its site at any time and break this; if a step
 * fails, the error response names which step failed so it can be
 * fixed without guessing.
 *
 * Deploy: `wrangler deploy` from this directory (see README.md).
 * Request:  POST { subdomain, username, password, dateFrom, dateTo }
 *           dateFrom/dateTo are "YYYY-MM-DD".
 * Response: { ok: true, days: { "YYYY-MM-DD": [ {start,end,subject,room,teacher,free} ] } }
 *        or { ok: false, step: "...", error: "..." }
 */

const ALLOWED_ORIGIN = '*'; // tighten to your Notesino origin if you want to lock this down

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
async function loginAndFetchTimetable({ subdomain, username, password, dateFrom, dateTo }) {
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

  res = await jarFetch(jar, base + '/dashboard/eb.php?mode=ttday');
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
  for (const dateKey of Object.keys(dates)) {
    const dayObj = dates[dateKey];
    const plan = (dayObj && dayObj.plan) || [];
    const lessons = [];
    for (const item of plan) {
      if (!item || item.type === 'event' || item.removed) continue;
      const subjIds = item.subjectid !== undefined ? [item.subjectid] : [];
      const classroomIds = Array.isArray(item.classroomids) ? item.classroomids : [];
      const teacherIds = Array.isArray(item.teacherids) ? item.teacherids : [];
      lessons.push({
        start: fixTime(item.starttime || ''),
        end: fixTime(item.endtime || ''),
        subject: subjIds.map(subjectName).filter(Boolean).join(', '),
        room: classroomIds.map(classroomName).filter(Boolean).join(', '),
        teacher: teacherIds.map(teacherName).filter(Boolean).join(', '),
        free: false
      });
    }
    lessons.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    days[dateKey] = lessons;
  }

  return { ok: true, days };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
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
};
