// Notesino Timetable widget (Scriptable)
// -----------------------------------------------------------------
// Shows today's current/next lesson on an iOS 16+ Lock Screen (or a
// Home Screen widget) by calling the same EduPage relay the Notesino
// app itself uses -- no native app, no Xcode, no App Store build.
//
// SETUP (do this once):
//   1. Install the free "Scriptable" app from the App Store.
//   2. Open it, tap "+", paste this whole file in, and rename the
//      script to "Notesino Timetable" (top of the editor).
//   3. Tap the play button (▶) to run it manually once -- it will ask
//      for your relay URL, school subdomain, username and password,
//      and save them in this device's Keychain (not iCloud, not the
//      script itself).
//   4. Long-press your Lock Screen -> Customize -> tap a widget slot
//      -> Add Widget -> Scriptable -> pick the rectangular widget ->
//      in its widget settings choose this script as the "Script" and
//      "When Interacting" as "Run Script".
//
// Your password never touches Notesino's own servers (there are none)
// -- it goes straight from this device's Keychain to the relay you
// deployed yourself, exactly like the web app.
// -----------------------------------------------------------------

const KEY_RELAY = "notesino_edupage_relay_url";
const KEY_SUBDOMAIN = "notesino_edupage_subdomain";
const KEY_USERNAME = "notesino_edupage_username";
const KEY_PASSWORD = "notesino_edupage_password";

function hasSavedCredentials() {
  return Keychain.contains(KEY_RELAY) && Keychain.contains(KEY_SUBDOMAIN) &&
    Keychain.contains(KEY_USERNAME) && Keychain.contains(KEY_PASSWORD);
}

async function promptText(title, message, placeholder, secure) {
  const alert = new Alert();
  alert.title = title;
  if (message) alert.message = message;
  if (secure) alert.addSecureTextField(placeholder || "");
  else alert.addTextField(placeholder || "");
  alert.addAction("Save");
  alert.addCancelAction("Cancel");
  const idx = await alert.presentAlert();
  if (idx === -1) throw new Error("Setup cancelled.");
  return alert.textFieldValue(0);
}

async function runSetup() {
  const relay = await promptText("Relay URL", "From deploying edupage-relay/ (see its README).", "https://your-relay.workers.dev");
  const subdomain = await promptText("School subdomain", "The part before .edupage.org", "e.g. gymxyz");
  const username = await promptText("EduPage username", null, "Same as the Notesino app");
  const password = await promptText("EduPage password", null, "Same as the Notesino app", true);
  Keychain.set(KEY_RELAY, relay.trim().replace(/\/+$/, ""));
  Keychain.set(KEY_SUBDOMAIN, subdomain.trim());
  Keychain.set(KEY_USERNAME, username.trim());
  Keychain.set(KEY_PASSWORD, password);
}

async function ensureSetup() {
  if (hasSavedCredentials()) {
    if (config.runsInWidget) return;
    const again = new Alert();
    again.title = "Already set up";
    again.message = "Reconfigure your EduPage login?";
    again.addAction("Reconfigure");
    again.addCancelAction("Keep current");
    const idx = await again.presentAlert();
    if (idx === 0) await runSetup();
    return;
  }
  if (config.runsInWidget) {
    throw new Error("Open this script in Scriptable and run it once to set up your EduPage login.");
  }
  await runSetup();
}

function isoDate(d) {
  const p = n => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function parseHHMM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

async function fetchTodaysLessons() {
  const relay = Keychain.get(KEY_RELAY);
  const subdomain = Keychain.get(KEY_SUBDOMAIN);
  const username = Keychain.get(KEY_USERNAME);
  const password = Keychain.get(KEY_PASSWORD);
  const today = isoDate(new Date());

  const req = new Request(relay);
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ subdomain, username, password, dateFrom: today, dateTo: today });
  req.timeoutInterval = 25;
  const json = await req.loadJSON();
  if (!json || json.ok === false) {
    const step = json && json.step ? json.step + ": " : "";
    throw new Error(step + ((json && json.error) || "sync failed"));
  }
  return (json.days && json.days[today]) || [];
}

function pickLesson(lessons) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let current = null;
  let next = null;
  for (const l of lessons) {
    const s = parseHHMM(l.start);
    const e = parseHHMM(l.end);
    if (s === null || e === null || l.free) continue;
    if (nowMin >= s && nowMin < e) { current = l; }
    if (s > nowMin && (!next || s < parseHHMM(next.start))) next = l;
  }
  return { current, next };
}

async function buildWidget() {
  const widget = new ListWidget();
  widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const isInline = config.widgetFamily === "accessoryInline";

  try {
    await ensureSetup();
    const lessons = await fetchTodaysLessons();
    const { current, next } = pickLesson(lessons);
    const shown = current || next;

    if (isInline) {
      widget.addText(
        current ? ("Now: " + (current.subject || "Lesson"))
        : next ? ("Next: " + (next.subject || "Lesson") + " " + next.start)
        : "No more lessons today"
      );
    } else if (shown) {
      const label = widget.addText(current ? "NOW" : "NEXT");
      label.font = Font.boldSystemFont(11);
      label.textColor = Color.gray();

      const subj = widget.addText(shown.subject || "Lesson");
      subj.font = Font.semiboldSystemFont(16);
      subj.minimumScaleFactor = 0.6;
      subj.lineLimit = 1;

      const bits = [];
      bits.push(current ? ("until " + current.end) : ("at " + next.start));
      if (shown.room) bits.push("Room " + shown.room);
      const detail = widget.addText(bits.join(" · "));
      detail.font = Font.systemFont(12);
      detail.textColor = Color.gray();
      detail.lineLimit = 1;
    } else {
      const done = widget.addText("No more lessons today");
      done.font = Font.systemFont(13);
    }
  } catch (err) {
    const errText = widget.addText("⚠️ " + err.message);
    errText.font = Font.systemFont(11);
    errText.textColor = Color.red();
    errText.lineLimit = 3;
  }

  return widget;
}

const widget = await buildWidget();
if (config.runsInWidget || config.widgetFamily) {
  Script.setWidget(widget);
} else if (typeof widget.presentAccessoryRectangular === "function") {
  await widget.presentAccessoryRectangular();
} else {
  await widget.presentMedium();
}
Script.complete();
