# Notesino

A single-page workspace: draggable/resizable sticky notes, a sticky
"canvas" drawing card, tables, free-floating text lines and images, a
mind-map-style "+" connector between any two instances, and an editable
weekly Timetable (subject / room / teacher / free-period marking, with a
live "next lesson" banner) — all in one `index.html`, plus an installable
Android app with a home-screen timetable widget.

Everything lives in this one repo, in this one file, on purpose — no
separate project, no external repo.

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
subjects, the Timetable tab, and the mind-map connections all work the
same as in the app, and (optionally) sync live with anyone else who opens
the same shared room via the 🔗 button.

## Accounts, friends, and live presence

In progress — being added directly into this same `index.html`, using
Firebase Authentication (email/password to start) plus the existing
Firebase Realtime Database for friend lists, private rooms, and live
presence circles. Those features need a real Firebase project with
Authentication enabled; until that's wired up and enabled in the
Firebase console, the app runs fully functional as a local/shared-room
workspace with accounts simply turned off.
