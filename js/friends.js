/* ==========================================================================
   Friends — add by unique friend code, list friends, invite a friend into
   the session you're currently hosting. Session hosting/joining itself
   (and live presence circles/cursors) lives in presence.js; this file
   owns the social graph in Firestore:
     users/{uid}            { displayName, friendCode, friends: [uid...] }
     users/{uid}/invites/*  { sessionId, fromUid, fromName, createdAt }
   ========================================================================== */
(function (global) {
  var els = {};
  var myProfile = null;
  var friendProfiles = {}; // uid -> profile, kept in sync for the friends list UI

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    els.modal = $('friendsModal');
    els.close = $('friendsCloseBtn');
    els.codeInput = $('friendCodeInput');
    els.addBtn = $('addFriendBtn');
    els.error = $('friendsError');
    els.list = $('friendsList');
    els.myCode = $('friendCodeDisplay2');
    els.inviteBanner = $('inviteBanner');
    els.inviteText = $('inviteText');
    els.inviteAcceptBtn = $('inviteAcceptBtn');
    els.inviteDeclineBtn = $('inviteDeclineBtn');
    els.openFriendsBtn = $('openFriendsBtn');
  }

  function showError(msg) {
    if (!els.error) return;
    els.error.textContent = msg || '';
    els.error.hidden = !msg;
  }

  function open() {
    if (els.modal) els.modal.hidden = false;
    showError('');
    renderFriendList();
    if (els.myCode) els.myCode.textContent = myProfile.friendCode || '';
  }
  function close() { if (els.modal) els.modal.hidden = true; }

  function renderFriendList() {
    if (!els.list) return;
    els.list.innerHTML = '';
    (myProfile.friends || []).forEach(function (uid) {
      var p = friendProfiles[uid];
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = p ? p.displayName : '…';
      var inviteBtn = document.createElement('button');
      inviteBtn.className = 'fmt-btn';
      inviteBtn.textContent = '↗';
      inviteBtn.title = 'Invite to your session';
      inviteBtn.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('invite-friend-requested', { detail: { uid: uid, name: p && p.displayName } }));
      });
      li.appendChild(name);
      li.appendChild(inviteBtn);
      els.list.appendChild(li);
    });
  }

  function refreshFriendProfiles() {
    var Fire = global.Fire;
    (myProfile.friends || []).forEach(function (uid) {
      if (friendProfiles[uid]) return;
      Fire.getDoc(Fire.doc(Fire.db, 'users', uid)).then(function (snap) {
        if (snap.exists()) { friendProfiles[uid] = snap.data(); renderFriendList(); }
      });
    });
  }

  function addFriendByCode(code) {
    var Fire = global.Fire;
    code = (code || '').trim().toUpperCase();
    if (!code) return;
    showError('');
    var q = Fire.query(Fire.collection(Fire.db, 'users'), Fire.where('friendCode', '==', code));
    getDocsOnce(q).then(function (docs) {
      if (!docs.length) { showError('No account with that code.'); return; }
      var friend = docs[0];
      if (friend.uid === myProfile.uid) { showError("That's your own code."); return; }
      var meRef = Fire.doc(Fire.db, 'users', myProfile.uid);
      var themRef = Fire.doc(Fire.db, 'users', friend.uid);
      return Promise.all([
        Fire.updateDoc(meRef, { friends: Fire.arrayUnion(friend.uid) }),
        Fire.updateDoc(themRef, { friends: Fire.arrayUnion(myProfile.uid) })
      ]).then(function () {
        myProfile.friends = (myProfile.friends || []).concat(friend.uid);
        friendProfiles[friend.uid] = friend;
        renderFriendList();
        els.codeInput.value = '';
      });
    }).catch(function (err) { showError(err.message); });
  }

  /* Firestore's onSnapshot is push-based; for the one-shot "look up this
     code" lookup we just want a single read, so we subscribe and
     unsubscribe on the first result rather than importing getDocs too. */
  function getDocsOnce(q) {
    var Fire = global.Fire;
    return new Promise(function (resolve, reject) {
      var unsub = Fire.onSnapshot(q, function (snap) {
        unsub();
        resolve(snap.docs.map(function (d) { return d.data(); }));
      }, reject);
    });
  }

  function inviteFriendToSession(friendUid, sessionId) {
    var Fire = global.Fire;
    var inviteId = 'inv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    return Fire.setDoc(Fire.doc(Fire.db, 'users', friendUid, 'invites', inviteId), {
      sessionId: sessionId,
      fromUid: myProfile.uid,
      fromName: myProfile.displayName,
      createdAt: Fire.serverTimestamp()
    });
  }

  var pendingInvites = {};
  function listenInvites() {
    var Fire = global.Fire;
    Fire.onSnapshot(Fire.collection(Fire.db, 'users', myProfile.uid, 'invites'), function (snap) {
      snap.docChanges().forEach(function (change) {
        if (change.type === 'added') {
          var invite = change.doc.data();
          pendingInvites[change.doc.id] = invite;
          showInviteBanner(change.doc.id, invite);
        }
      });
    });
  }

  function showInviteBanner(inviteId, invite) {
    if (!els.inviteBanner) return;
    els.inviteText.textContent = (invite.fromName || 'Someone') + ' invited you to their session';
    els.inviteBanner.hidden = false;
    els.inviteAcceptBtn.onclick = function () {
      document.dispatchEvent(new CustomEvent('invite-accepted', { detail: invite }));
      global.Fire.deleteDoc(global.Fire.doc(global.Fire.db, 'users', myProfile.uid, 'invites', inviteId));
      els.inviteBanner.hidden = true;
    };
    els.inviteDeclineBtn.onclick = function () {
      global.Fire.deleteDoc(global.Fire.doc(global.Fire.db, 'users', myProfile.uid, 'invites', inviteId));
      els.inviteBanner.hidden = true;
    };
  }

  function wireUI() {
    if (els.openFriendsBtn) els.openFriendsBtn.addEventListener('click', open);
    if (els.close) els.close.addEventListener('click', close);
    if (els.modal) els.modal.addEventListener('pointerdown', function (e) { if (e.target === els.modal) close(); });
    if (els.addBtn) els.addBtn.addEventListener('click', function () { addFriendByCode(els.codeInput.value); });
  }

  document.addEventListener('user-ready', function (e) {
    myProfile = e.detail;
    friendProfiles = {};
    cacheEls();
    wireUI();
    refreshFriendProfiles();
    listenInvites();
  });

  global.Friends = { inviteFriendToSession: inviteFriendToSession, open: open };
})(window);
