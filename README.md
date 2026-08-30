# Notesino

`index.html` at the repo root now serves **SchoolBoard**, a newer
cross-platform (web/Android/iOS) rebuild that carries over Notesino's
canvas, sticky-note, and formatting code — see
[school-app-widget](https://github.com/tomas217chriastel-cyber/school-app-widget)
for that project's full source and docs.

The original Notesino web app described below still exists, unchanged,
at [`legacy/notesino-classic.html`](legacy/notesino-classic.html) — open
that file directly for the classic sticky-notes/calendar/timetable
experience. (Note: the Android build in `android/` still bundles
whatever is at the repo-root `index.html`, i.e. SchoolBoard now, not the
classic app — see `android/build.sh`.)

---

A sticky-notes, calendar, subjects, and weekly-timetable workspace that runs
as a single web page — and as an installable Android app with a home-screen
timetable widget.

## 📱 Get the Android app

[![Download Notesino.apk](https://img.shields.io/badge/Download-Notesino.apk-6a7cff?style=for-the-badge&logo=android&logoColor=white)](https://github.com/tomas217chriastel-cyber/Notesino/raw/main/android/releases/notesino-debug-signed.apk)

On your phone: tap the button above — it downloads the `.apk` file
directly. Open it from your downloads/notifications, allow installs from
whatever app you used to download it (Chrome, Files, etc.) the first time
you're asked, then continue the install.

This is a debug-signed build meant for installing directly on your own
phone (sideloading), not a Play Store release. See
[`android/README.md`](android/README.md) for how it's built, what the
Timetable home-screen widget does, and known limitations.

## 💻 Use it in a browser

Just open [`index.html`](index.html) — no build step needed. Notes,
calendar, subjects, and the Timetable tab all work the same as in the app,
and (optionally) sync live with anyone else who opens the same shared
room via the 🔗 button.
