/* ==========================================================================
   Presence — hosted/joined shared sessions, live "who's here" circles, and
   live cursors, so a PC user and a phone user can work the same canvas at
   once and see each other move around it.

   Backed by the Realtime Database (built for exactly this: cheap
   high-frequency writes + onDisconnect cleanup when a tab/app closes or
   the network drops):
     presence/{sessionId}/{uid} = { name, color, x, y, device, updatedAt }
   x/y are canvas *world* coordinates (not screen pixels), so every
   viewer — regardless of their own pan/zoom — can place the dot in the
   same logical spot via Canvas.canvasToScreen().
   ========================================================================== */
(function (global) {
  var els = {};
  var myProfile = null;
  var myColor = null;
  var sessionId = null;
  var presenceRef = null;
  var others = {}; // uid -> { name, color, x, y, device }
  var cursorEls = {}; // uid -> DOM element
  var rafRunning = false;
  var lastSent = 0;

  var PALETTE = ['#ff8fa3', '#8ecae6', '#95d5b2', '#c8b6ff', '#ffd166', '#6a7cff'];

  function $(id) { return document.getElementById(id); }

  function cacheEls() {
    els.hostBtn = $('hostSessionBtn');
    els.leaveBtn = $('leaveSessionBtn');
    els.codeDisplay = $('sessionCodeDisplay');
    els.joinInput = $('joinSessionInput');
    els.joinBtn = $('joinSessionBtn');
    els.strip = $('presenceStrip');
  }

  function randomSessionCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var out = '';
    for (var i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function hostSession() {
    joinSession(randomSessionCode());
    if (els.codeDisplay) els.codeDisplay.textContent = sessionId;
  }

  function joinSession(id) {
    if (!global.Fire.rtdb) { alert('Live shared sessions need a Firebase Realtime Database URL in firebase-config.js.'); return; }
    if (sessionId) leaveSession();
    sessionId = id.toUpperCase();
    myColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    var Fire = global.Fire;
    var myRef = Fire.ref(Fire.rtdb, 'presence/' + sessionId + '/' + myProfile.uid);
    presenceRef = Fire.ref(Fire.rtdb, 'presence/' + sessionId);

    Fire.rtdbSet(myRef, {
      name: myProfile.displayName, color: myColor,
      x: 0, y: 0,
      device: global.Platform.isNative ? global.Platform.nativePlatform : (global.Platform.isTouch ? 'mobile-web' : 'desktop-web'),
      updatedAt: Date.now()
    });
    Fire.onDisconnect(myRef).remove();

    Fire.onValue(presenceRef, function (snap) {
      var val = snap.val() || {};
      others = {};
      Object.keys(val).forEach(function (uid) {
        if (uid === myProfile.uid) return;
        others[uid] = val[uid];
      });
      renderPresenceStrip();
      ensureCursorLoop();
    });

    if (els.codeDisplay) els.codeDisplay.textContent = sessionId;
    if (els.hostBtn) els.hostBtn.hidden = true;
    if (els.leaveBtn) els.leaveBtn.hidden = false;

    global.Canvas.onWorldPointerMove(function (x, y) { sendCursor(x, y); });
  }

  function sendCursor(x, y) {
    if (!sessionId) return;
    var now = performance.now();
    if (now - lastSent < 50) return; // ~20fps network cap
    lastSent = now;
    var Fire = global.Fire;
    Fire.rtdbUpdate(Fire.ref(Fire.rtdb, 'presence/' + sessionId + '/' + myProfile.uid), { x: x, y: y, updatedAt: Date.now() });
  }

  function leaveSession() {
    if (!sessionId) return;
    var Fire = global.Fire;
    Fire.rtdbRemove(Fire.ref(Fire.rtdb, 'presence/' + sessionId + '/' + myProfile.uid));
    Fire.rtdbOff(presenceRef);
    sessionId = null;
    others = {};
    Object.keys(cursorEls).forEach(function (uid) { cursorEls[uid].remove(); });
    cursorEls = {};
    if (els.strip) els.strip.innerHTML = '';
    if (els.codeDisplay) els.codeDisplay.textContent = '';
    if (els.hostBtn) els.hostBtn.hidden = false;
    if (els.leaveBtn) els.leaveBtn.hidden = true;
  }

  function renderPresenceStrip() {
    if (!els.strip) return;
    els.strip.innerHTML = '';
    Object.keys(others).forEach(function (uid) {
      var p = others[uid];
      var c = document.createElement('div');
      c.className = 'presence-circle';
      c.style.background = p.color;
      c.title = p.name + ' (' + p.device + ')';
      c.textContent = (p.name || '?')[0].toUpperCase();
      els.strip.appendChild(c);
    });
  }

  function ensureCursorLoop() {
    if (rafRunning) return;
    rafRunning = true;
    requestAnimationFrame(tickCursors);
  }

  function tickCursors() {
    var uids = Object.keys(others);
    uids.forEach(function (uid) {
      var p = others[uid];
      var el = cursorEls[uid];
      if (!el) {
        el = document.createElement('div');
        el.className = 'presence-cursor';
        el.innerHTML = '<div class="dot"></div><div class="label"></div>';
        document.body.appendChild(el);
        cursorEls[uid] = el;
      }
      el.querySelector('.dot').style.background = p.color;
      el.querySelector('.label').textContent = p.name;
      var screen = global.Canvas.canvasToScreen(p.x || 0, p.y || 0);
      el.style.left = screen.x + 'px';
      el.style.top = screen.y + 'px';
    });
    Object.keys(cursorEls).forEach(function (uid) {
      if (!others[uid]) { cursorEls[uid].remove(); delete cursorEls[uid]; }
    });
    if (sessionId) requestAnimationFrame(tickCursors);
    else rafRunning = false;
  }

  function wireUI() {
    if (els.hostBtn) els.hostBtn.addEventListener('click', hostSession);
    if (els.leaveBtn) els.leaveBtn.addEventListener('click', leaveSession);
    if (els.joinBtn) els.joinBtn.addEventListener('click', function () {
      if (els.joinInput.value.trim()) joinSession(els.joinInput.value.trim());
    });
  }

  document.addEventListener('user-ready', function (e) {
    myProfile = e.detail;
    cacheEls();
    wireUI();
  });

  document.addEventListener('invite-accepted', function (e) { joinSession(e.detail.sessionId); });
  document.addEventListener('invite-friend-requested', function (e) {
    if (!sessionId) { alert('Host or join a session first, then invite a friend into it.'); return; }
    global.Friends.inviteFriendToSession(e.detail.uid, sessionId);
  });

  global.Presence = { hostSession: hostSession, joinSession: joinSession, leaveSession: leaveSession, currentSessionId: function () { return sessionId; } };
})(window);
