# Notesino — Android app

A thin native Android wrapper around the existing `index.html` web app,
plus a home-screen widget for the new Timetable feature. No Gradle, no
Android Studio, no AndroidX — just `aapt`/`dx`/`apksigner` from the
Debian/Ubuntu-packaged Android SDK and plain `javac` against the API 23
`android.jar`. This was a deliberate choice for this build environment:
Google's own SDK manager (`dl.google.com`) is blocked here, so the usual
Gradle + Android Gradle Plugin route isn't available. If you build this on
a normal machine with Android Studio installed, you can safely ignore all
of that and just import `app/` as a Gradle project instead.

## What's in the app

- **MainActivity** — a single full-screen `WebView` loading
  `assets/index.html` (a bundled copy of the repo's `index.html`), with
  JavaScript, DOM storage, and a `NotesinoNative` JS bridge enabled.
- **Timetable tab** — added directly to `index.html` (so it also works in
  a normal browser): a weekly grid of periods × days, each cell holding a
  subject/room/color, persisted the same way as the rest of the workspace
  (`localStorage`, and synced through the existing "live room" Firebase
  feature if one is active).
- **TimetableBridge** — every time the Timetable tab changes, the page
  calls `window.NotesinoNative.saveTimetable(json)`, which writes the data
  to `SharedPreferences` and refreshes the widget. No-op outside the app.
- **TimetableWidgetProvider** / **TimetableRemoteViewsService** — a native
  home-screen widget (`AppWidgetProvider` + `RemoteViewsService`, since
  widgets can't host a WebView) showing today's periods with subject, room,
  and color. Tapping it opens the app straight to the Timetable tab.

## Building

```
apt-get install android-sdk-build-tools android-sdk-platform-23 \
                 android-sdk-platform-tools dalvik-exchange
cd android
./build.sh
```

Output: `android/build/apk/notesino-debug-signed.apk` — signed with a
throwaway debug key (`android/debug.keystore`, generated on first run;
password `notesino123`). Good for sideloading and testing, **not** for
Play Store distribution.

## Installing

Either:
- Copy the APK to a phone and open it (enable "Install unknown apps" for
  whatever app you copy it with), or
- `adb install -r build/apk/notesino-debug-signed.apk` with the phone
  connected over USB (developer options + USB debugging enabled).

Then add the widget: long-press the home screen → Widgets → Notesino
Timetable.

## Known limitations / things worth knowing

- **compileSdk 23 / targetSdk 23.** That's the newest platform available
  through apt without hitting the blocked Google SDK servers. It still
  installs and runs fine on current Android versions (Android 14 refuses
  anything below targetSdk 23, so 23 is the floor, not a problem), but it
  means the app runs under some old platform-compat behavior (e.g. all
  normal permissions granted at install time — irrelevant here since the
  only permission is `INTERNET`). Rebuilding against a newer platform is a
  matter of installing a newer `android-sdk-platform-NN` package (or using
  the real Android SDK/Gradle on a machine that can reach
  `dl.google.com`) and bumping `targetSdkVersion` in the manifest —
  nothing else in this project depends on API 23 specifically.
- **Widget refresh cadence.** Android's minimum `updatePeriodMillis` is 30
  minutes, so the widget's day rollover (e.g. right after midnight) can lag
  by up to that long. It also refreshes instantly whenever the Timetable
  tab is edited inside the app.
- **The shared-by-default live room.** This carries over unchanged from
  the web app: `index.html` auto-joins a public Firebase room
  (`NOTESINO-MAIN`) on first launch unless a device has explicitly left or
  joined a private room. That was already true of the web app; packaging
  it as an installable app just means it's worth being deliberate about
  before handing this APK to other people. Nothing in this Android work
  changed that behavior — see the 🔗 button in-app to leave/create a
  private room.
- **No Play Store path yet.** This is a debug-signed sideload build. A
  release build needs its own signing key (`keytool -genkeypair` with real
  identity info, kept secret and backed up — losing it means you can never
  update the app again under the same package), plus the usual Play
  Console listing work.
