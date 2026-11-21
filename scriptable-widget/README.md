# Notesino Lock Screen widget (Scriptable)

A small script that shows today's current/next lesson on an iPhone's
Lock Screen (iOS 16+) or Home Screen, using the same EduPage relay the
Notesino app itself talks to. No Xcode, no App Store submission, no
developer account -- just the free Scriptable app.

## Setup

1. Install **[Scriptable](https://apps.apple.com/app/scriptable/id1405459188)**
   from the App Store (free).
2. Open Scriptable, tap **+** (new script), delete the placeholder
   content, and paste in the whole contents of `Notesino Timetable.js`.
3. Tap the script's name at the top and rename it to `Notesino Timetable`.
4. Tap the **▶ (play)** button to run it manually once. It will ask
   for four things and save them in this device's Keychain (not
   iCloud, not the script file itself, so they aren't synced or
   readable by anyone else):
   - **Relay URL** -- the `https://....workers.dev` URL from deploying
     `edupage-relay/` (see its own README).
   - **School subdomain** -- the part before `.edupage.org`.
   - **Username** / **Password** -- the same EduPage login the app uses.
5. It should show a preview of the widget. If it shows an error
   instead, the message names which step failed, same as the app's
   own EduPage Sync panel.
6. Add it to your Lock Screen: long-press the Lock Screen → **Customize**
   → tap a widget slot under the clock → **Add Widget** → **Scriptable**
   → pick the rectangular size → in the widget's own settings, set
   **Script** to `Notesino Timetable` and **When Interacting** to
   **Run Script**.

You can also add it as an ordinary Home Screen widget the same way,
or run it again manually any time to reconfigure (it'll ask whether
you want to replace your saved login).

## Notes

- iOS decides exactly when to refresh Lock Screen widgets; this
  script only hints that 15 minutes is a reasonable refresh interval.
  It won't update second-by-second.
- Lock Screen widgets render in a single system tint color -- the
  "NOW"/"NEXT" label and room text will not show their own colors
  there, only on a Home Screen widget.
- This has not been tested against the real Scriptable runtime from
  this session (no access to it here) -- it mirrors the exact
  request/response shape already verified working in the relay and
  the main app's own sync panel. If it errors, the message it shows
  is the same kind of step name the app's sync panel gives (e.g.
  `bad-credentials`), so it can be debugged the same way.
