/* ==========================================================================
   Auth — email/password, phone (SMS code), Google, Apple.
   All backed by Firebase Auth (see firebase-boot.js / firebase-config.js).
   On first sign-up we also create the user's profile doc in Firestore
   with a unique friend code, which friends.js reads/writes.
   ========================================================================== */
(function (global) {
  var els = {};
  var recaptchaVerifier = null;
  var confirmationResult = null;
  var currentUser = null;

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    els.modal = $('authModal');
    els.close = $('authCloseBtn');
    els.email = $('authEmail');
    els.password = $('authPassword');
    els.name = $('authName');
    els.signUpBtn = $('authSignUpBtn');
    els.signInBtn = $('authSignInBtn');
    els.googleBtn = $('authGoogleBtn');
    els.appleBtn = $('authAppleBtn');
    els.phoneNumber = $('authPhoneNumber');
    els.phoneSendBtn = $('authPhoneSendBtn');
    els.phoneCode = $('authPhoneCode');
    els.phoneVerifyBtn = $('authPhoneVerifyBtn');
    els.phoneCodeRow = $('authPhoneCodeRow');
    els.error = $('authError');
    els.disabledNotice = $('authDisabledNotice');
    els.profileBtn = $('profileBtn');
    els.profileMenu = $('profileMenu');
    els.userName = $('userDisplayName');
    els.friendCodeDisplay = $('friendCodeDisplay');
    els.signOutBtn = $('signOutBtn');
    els.openFriendsBtn = $('openFriendsBtn');
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg || '';
    els.error.hidden = !msg;
  }

  function openAuthModal() { if (els.modal) els.modal.hidden = false; showError(''); }
  function closeAuthModal() { if (els.modal) els.modal.hidden = true; }

  function randomFriendCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function ensureUserDoc(user, displayName) {
    var Fire = global.Fire;
    var ref = Fire.doc(Fire.db, 'users', user.uid);
    return Fire.getDoc(ref).then(function (snap) {
      if (snap.exists()) return snap.data();
      var profile = {
        uid: user.uid,
        displayName: displayName || user.displayName || (user.email || 'Player').split('@')[0],
        email: user.email || null,
        phone: user.phoneNumber || null,
        friendCode: randomFriendCode(),
        friends: [],
        createdAt: Fire.serverTimestamp()
      };
      return Fire.setDoc(ref, profile).then(function () { return profile; });
    });
  }

  function renderSignedIn(profile) {
    if (els.profileBtn) els.profileBtn.textContent = (profile.displayName || 'U')[0].toUpperCase();
    if (els.userName) els.userName.textContent = profile.displayName || '';
    if (els.friendCodeDisplay) els.friendCodeDisplay.textContent = profile.friendCode || '';
    document.dispatchEvent(new CustomEvent('user-ready', { detail: profile }));
  }

  function wireAuthUI() {
    if (els.profileBtn) els.profileBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!currentUser) { openAuthModal(); return; }
      if (els.profileMenu) els.profileMenu.classList.toggle('open');
    });
    if (els.close) els.close.addEventListener('click', closeAuthModal);
    if (els.modal) els.modal.addEventListener('pointerdown', function (e) { if (e.target === els.modal) closeAuthModal(); });

    if (els.signUpBtn) els.signUpBtn.addEventListener('click', function () {
      if (!global.Fire.enabled) return;
      showError('');
      global.Fire.createUserWithEmailAndPassword(global.Fire.auth, els.email.value.trim(), els.password.value)
        .then(function (cred) {
          return global.Fire.updateProfile(cred.user, { displayName: els.name.value.trim() || undefined })
            .then(function () { return ensureUserDoc(cred.user, els.name.value.trim()); });
        })
        .then(function () { closeAuthModal(); })
        .catch(function (err) { showError(err.message); });
    });

    if (els.signInBtn) els.signInBtn.addEventListener('click', function () {
      if (!global.Fire.enabled) return;
      showError('');
      global.Fire.signInWithEmailAndPassword(global.Fire.auth, els.email.value.trim(), els.password.value)
        .then(function () { closeAuthModal(); })
        .catch(function (err) { showError(err.message); });
    });

    if (els.googleBtn) els.googleBtn.addEventListener('click', function () {
      if (!global.Fire.enabled) return;
      showError('');
      var provider = new global.Fire.GoogleAuthProvider();
      var signIn = global.Platform.isNative ? global.Fire.signInWithRedirect : global.Fire.signInWithPopup;
      signIn(global.Fire.auth, provider)
        .then(function (res) { if (res && res.user) return ensureUserDoc(res.user); })
        .then(function () { closeAuthModal(); })
        .catch(function (err) { showError(err.message); });
    });

    if (els.appleBtn) els.appleBtn.addEventListener('click', function () {
      if (!global.Fire.enabled) return;
      showError('');
      var provider = new global.Fire.OAuthProvider('apple.com');
      var signIn = global.Platform.isNative ? global.Fire.signInWithRedirect : global.Fire.signInWithPopup;
      signIn(global.Fire.auth, provider)
        .then(function (res) { if (res && res.user) return ensureUserDoc(res.user); })
        .then(function () { closeAuthModal(); })
        .catch(function (err) { showError(err.message); });
    });

    if (els.phoneSendBtn) els.phoneSendBtn.addEventListener('click', function () {
      if (!global.Fire.enabled) return;
      showError('');
      if (!recaptchaVerifier) {
        recaptchaVerifier = new global.Fire.RecaptchaVerifier(global.Fire.auth, 'recaptcha-container', { size: 'invisible' });
      }
      global.Fire.signInWithPhoneNumber(global.Fire.auth, els.phoneNumber.value.trim(), recaptchaVerifier)
        .then(function (result) {
          confirmationResult = result;
          if (els.phoneCodeRow) els.phoneCodeRow.hidden = false;
        })
        .catch(function (err) { showError(err.message); });
    });

    if (els.phoneVerifyBtn) els.phoneVerifyBtn.addEventListener('click', function () {
      if (!confirmationResult) return;
      confirmationResult.confirm(els.phoneCode.value.trim())
        .then(function (cred) { return ensureUserDoc(cred.user); })
        .then(function () { closeAuthModal(); })
        .catch(function (err) { showError(err.message); });
    });

    if (els.signOutBtn) els.signOutBtn.addEventListener('click', function () {
      global.Fire.signOut(global.Fire.auth);
      if (els.profileMenu) els.profileMenu.classList.remove('open');
    });

    document.addEventListener('pointerdown', function (e) {
      if (els.profileMenu && els.profileMenu.classList.contains('open') && !e.target.closest('.profile-wrap')) {
        els.profileMenu.classList.remove('open');
      }
    });
  }

  function init() {
    cacheEls();
    wireAuthUI();
    var Fire = global.Fire;
    if (!Fire.enabled) {
      if (els.disabledNotice) els.disabledNotice.hidden = false;
      if (els.profileBtn) els.profileBtn.title = 'Connect a Firebase project to enable accounts (see README)';
      return;
    }
    Fire.onAuthStateChanged(Fire.auth, function (user) {
      currentUser = user;
      if (!user) {
        document.dispatchEvent(new CustomEvent('user-signed-out'));
        return;
      }
      ensureUserDoc(user).then(renderSignedIn);
    });
  }

  window.addEventListener('firebase-ready', init);
  global.Auth = { openAuthModal: openAuthModal, closeAuthModal: closeAuthModal, currentUser: function () { return currentUser; } };
})(window);
