/* ==========================================================================
   Firebase bootstrap. Loaded as an ES module (Firebase's v10 SDK is
   ESM-only from the CDN) and attaches everything the rest of the app
   needs onto window.Fire, then fires 'firebase-ready' — the classic
   <script> files (auth.js, friends.js, presence.js, app.js) load in
   document order but wait for that event before touching Firebase, same
   pattern Notesino uses for its single Firebase import.
   ========================================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithRedirect,
  RecaptchaVerifier, signInWithPhoneNumber, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, serverTimestamp, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getDatabase, ref, set, update, onValue, onDisconnect, remove, off
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js';

var config = window.SCHOOLBOARD_FIREBASE_CONFIG || {};
var enabled = !!config.apiKey && config.apiKey.indexOf('YOUR_') !== 0;

var fire = {
  enabled: enabled,
  app: null, auth: null, db: null, rtdb: null,
  // auth
  onAuthStateChanged: onAuthStateChanged,
  createUserWithEmailAndPassword: createUserWithEmailAndPassword,
  signInWithEmailAndPassword: signInWithEmailAndPassword,
  signOut: signOut,
  GoogleAuthProvider: GoogleAuthProvider,
  OAuthProvider: OAuthProvider,
  signInWithPopup: signInWithPopup,
  signInWithRedirect: signInWithRedirect,
  RecaptchaVerifier: RecaptchaVerifier,
  signInWithPhoneNumber: signInWithPhoneNumber,
  updateProfile: updateProfile,
  // firestore
  doc: doc, setDoc: setDoc, getDoc: getDoc, updateDoc: updateDoc, deleteDoc: deleteDoc,
  collection: collection, query: query, where: where, onSnapshot: onSnapshot,
  serverTimestamp: serverTimestamp, arrayUnion: arrayUnion, arrayRemove: arrayRemove,
  // realtime database (presence)
  ref: ref, rtdbSet: set, rtdbUpdate: update, onValue: onValue, onDisconnect: onDisconnect,
  rtdbRemove: remove, rtdbOff: off
};

if (enabled) {
  fire.app = initializeApp(config);
  fire.auth = getAuth(fire.app);
  fire.db = getFirestore(fire.app);
  if (config.databaseURL) fire.rtdb = getDatabase(fire.app);
}

window.Fire = fire;
window.dispatchEvent(new CustomEvent('firebase-ready', { detail: { enabled: enabled } }));
