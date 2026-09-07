# Notesino — iOS app (scaffold)

A thin native iOS wrapper around the existing `index.html` web app, the
same idea as `android/`: one `WKWebView` loading a bundled copy of the
site, plus a small JS bridge so the Timetable feature can eventually feed
a native widget the way it already does on Android.

**This was built without a Mac or Xcode** — there is no machine available
in this environment to compile, run, or open an Xcode project on. Every
file here was written by hand to the format Xcode expects, but none of it
has been opened in Xcode or built. Treat this as a complete, ready-to-open
starting point rather than a verified build. If anything about the project
file doesn't open cleanly, the fallback is quick: create a new Xcode
project (**File → New → Project → iOS → App**, interface: SwiftUI,
language: Swift), then copy in `NotesinoApp.swift`, `ContentView.swift`,
`Info.plist`, `Assets.xcassets`, and the `www/` folder from here.

## What's in here

- **NotesinoApp.swift** — the SwiftUI app entry point (`@main`), just
  hosting `ContentView` full-screen.
- **ContentView.swift** — a `WKWebView` wrapped for SwiftUI
  (`UIViewRepresentable`) that loads `www/index.html` from the app bundle
  via `loadFileURL`, plus a `WKScriptMessageHandler` that shims
  `window.NotesinoNative.saveTimetable(json)` (the same call the web app
  already makes on every Timetable change, guarded by a feature check) so
  it doesn't error out — currently just stores the JSON in
  `UserDefaults.standard`. A future WidgetKit extension (a separate Xcode
  target, sharing an App Group with this app) could read that to show
  today's schedule the way the Android home-screen widget does; that
  widget extension isn't implemented here.
- **www/** — a bundled copy of `index.html`, `manifest.json`,
  `service-worker.js`, and `icons/*.png` from the repo root. This is what
  actually ships inside the app; it does not read from the parent
  repo at runtime. Run `./sync-web-assets.sh` after changing any of those
  files at the repo root and before rebuilding in Xcode.
- **Assets.xcassets** — the app icon (a single 1024×1024 image, the
  simplified format Xcode 14+ accepts) generated from the same source
  icon as the Android app, plus an accent color matching the web app's
  default dark theme.
- **Info.plist** — display name, orientations (all four on iPad, portrait
  + landscape on iPhone), light status bar content, and a launch screen
  that's just a solid fill in the accent color (no separate storyboard).

Why the web app doesn't need its own service worker here: everything is
already bundled directly into the app package, so it's offline by
construction. `service-worker.js` still registers when the page loads
(same code path as the web build) but finds no usable Service Worker
scope under a `file://` origin in `WKWebView` and fails silently — already
handled by the `.catch()` around that registration call.

## Opening and building (on a Mac, with Xcode installed)

```
open ios/Notesino.xcodeproj
```

Then **Product → Run** with an iOS Simulator or a connected device
selected. First build will ask you to pick a Team under **Signing &
Capabilities** for the `Notesino` target (any free personal team works
for Simulator/local device testing).

- **Bundle identifier**: `com.notesino.app`, matching the Android
  package name (`com.notesino.app`) — change it in the target's General
  tab if you need a different one (e.g. to submit under your own Apple
  Developer account).
- **Deployment target**: iOS 15.0.
- **Signing**: set to Automatic; no entitlements or capabilities are
  required for the app itself (no network permissions needed — the app
  never calls out anywhere on its own, same as the Android build; Firebase
  live-room sync is optional and already handles being unreachable).

## Known limitations / things worth knowing

- **Unverified project file.** As above — hand-written, never opened in
  Xcode. The structure follows Apple's standard single-view SwiftUI app
  template as closely as possible to minimize the chance of something
  being subtly wrong.
- **No WidgetKit extension yet.** The native bridge saves the timetable
  JSON to `UserDefaults.standard`, which isn't shared with a widget
  extension process — that needs an App Group entitlement and
  `UserDefaults(suiteName:)` on both sides. Wiring that up, plus the
  actual widget extension target (Swift + WidgetKit + a timeline
  provider), is a reasonably large follow-up, not attempted here.
- **No push notifications / native calendar integration.** Same as the
  web app: real Google/Apple Calendar notifications need OAuth
  credentials this project doesn't have. Use the Timetable tab's
  **Calendar…** panel to export an `.ics` file and import it into the
  iOS Calendar app for native reminders instead.
- **The shared-by-default live room** carries over unchanged from the web
  app (see the Android README's note on this) — nothing iOS-specific
  changes that behavior.
- **App Store distribution** needs your own paid Apple Developer account,
  a real bundle identifier under it, and the usual App Store Connect
  listing work — none of that is set up here.
