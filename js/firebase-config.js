/* ==========================================================================
   Firebase project config.

   This file is committed (not a secret): Firebase web config values are
   meant to be public — the client app ships them by design, and access
   is actually controlled by your Firestore/Auth security rules, not by
   hiding these values. See README.md → "Wiring up your own Firebase
   project" for the exact console steps.

   Replace the placeholders below with your project's values (Firebase
   console → Project settings → General → "Your apps" → SDK setup and
   configuration). Until you do, the app runs fine as a local canvas —
   accounts, friends, and live shared sessions just stay disabled and the
   UI says so.
   ========================================================================== */
window.SCHOOLBOARD_FIREBASE_CONFIG = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  databaseURL: 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID'
};
