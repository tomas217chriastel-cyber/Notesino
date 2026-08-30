/* ==========================================================================
   Canvas engine — infinite pan/zoom surface, draggable/resizable instances,
   and the "+" connect-dot mind-map linking system.

   Ported from the Notesino project (same interaction model, same visual
   language) and generalized into a small module so both the sticky-note
   layer and the Timetable card can use it. Touch vs desktop control
   differences (bigger hit targets, tap-and-hold vs hover) are handled by
   platform.js flipping `[data-controls]` on <html>; this file stays input
   agnostic and just uses Pointer Events everywhere, which both mice and
   touch report through.
   ========================================================================== */
(function (global) {
  var viewport = null;
  var layer = null;
  var linkLayerRoot = null;

  var topZ = 10;
  var canvasPanX = 0, canvasPanY = 0, canvasZoom = 1;
  var onChange = function () {}; // set by app.js — called after any mutation worth persisting
  var worldMoveListeners = [];

  function init(viewportEl, layerEl, onChangeCb) {
    viewport = viewportEl;
    layer = layerEl;
    if (onChangeCb) onChange = onChangeCb;
    setupPanZoom();
    canvasLinkLayer = makeLinkLayer(layer);
    viewport.addEventListener('pointermove', function (e) {
      if (!worldMoveListeners.length) return;
      var p = screenToCanvas(e.clientX, e.clientY);
      worldMoveListeners.forEach(function (cb) { cb(p.x, p.y); });
    });
  }

  /* Registers a callback fired with world (canvas-space) coordinates on
     every pointer move over the canvas viewport — used by presence.js to
     broadcast the local user's live cursor position. */
  function onWorldPointerMove(cb) { worldMoveListeners.push(cb); }

  function applyTransform() {
    layer.style.transform = 'translate(' + canvasPanX + 'px,' + canvasPanY + 'px) scale(' + canvasZoom + ')';
  }

  function screenToCanvas(clientX, clientY) {
    var rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - canvasPanX) / canvasZoom,
      y: (clientY - rect.top - canvasPanY) / canvasZoom
    };
  }

  /* Inverse of screenToCanvas — turns a world-space point (as broadcast
     over the network, so it means the same place for every viewer
     regardless of their own pan/zoom) back into this viewport's local
     screen pixels, e.g. for rendering another user's live cursor. */
  function canvasToScreen(x, y) {
    var rect = viewport.getBoundingClientRect();
    return { x: x * canvasZoom + canvasPanX + rect.left, y: y * canvasZoom + canvasPanY + rect.top };
  }

  function setupPanZoom() {
    var panning = false, lastX = 0, lastY = 0;
    var pointers = {}; // active pointers, for pinch-zoom on touch

    viewport.addEventListener('pointerdown', function (e) {
      if (e.target !== viewport && e.target !== layer) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (Object.keys(pointers).length === 1) {
        panning = true;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });

    viewport.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        panning = false;
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        var dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (!setupPanZoom._pinchDist) setupPanZoom._pinchDist = dist;
        var factor = dist / setupPanZoom._pinchDist;
        setupPanZoom._pinchDist = dist;
        zoomAt((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, factor);
      } else if (panning) {
        canvasPanX += e.clientX - lastX;
        canvasPanY += e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        applyTransform();
      }
    });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length < 2) setupPanZoom._pinchDist = null;
      if (Object.keys(pointers).length === 0) { panning = false; onChange(); }
    }
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', endPointer);

    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var factor = e.deltaY < 0 ? 1.08 : 0.93;
      zoomAt(e.clientX, e.clientY, factor);
    }, { passive: false });
  }

  function zoomAt(clientX, clientY, factor) {
    var rect = viewport.getBoundingClientRect();
    var before = screenToCanvas(clientX, clientY);
    canvasZoom = Math.max(0.3, Math.min(2.5, canvasZoom * factor));
    var afterScreenX = before.x * canvasZoom + canvasPanX + rect.left;
    var afterScreenY = before.y * canvasZoom + canvasPanY + rect.top;
    canvasPanX += clientX - afterScreenX;
    canvasPanY += clientY - afterScreenY;
    applyTransform();
  }

  function randomPos() {
    var rect = viewport.getBoundingClientRect();
    var c = screenToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { x: c.x + (Math.random() - 0.5) * 160, y: c.y + (Math.random() - 0.5) * 120 };
  }

  /* ---------- Drag / resize ---------- */
  function isInteractiveTarget(target) {
    return !!target.closest('button, select, input, label, [contenteditable="true"], .swatches, .note-toolbar2');
  }

  function makeDraggable(el, handle, onMove) {
    var offsetX = 0, offsetY = 0, dragging = false;
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', function (e) {
      if (isInteractiveTarget(e.target)) return;
      dragging = true;
      el.classList.add('dragging');
      el.style.zIndex = ++topZ;
      var rect = el.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var p = screenToCanvas(e.clientX - offsetX, e.clientY - offsetY);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      if (onMove) onMove();
      e.preventDefault();
    });

    function endDrag() {
      if (dragging) { dragging = false; el.classList.remove('dragging'); onChange(); }
    }
    handle.addEventListener('pointerup', endDrag);
    handle.addEventListener('pointercancel', endDrag);
  }

  function makeResizable(el, handle, minW, minH, lockSquare) {
    minW = minW || 140;
    minH = minH || 120;
    var startX = 0, startY = 0, startW = 0, startH = 0, resizing = false;
    handle.style.touchAction = 'none';

    handle.addEventListener('pointerdown', function (e) {
      resizing = true;
      startX = e.clientX;
      startY = e.clientY;
      startW = el.offsetWidth / canvasZoom;
      startH = el.offsetHeight / canvasZoom;
      el.style.zIndex = ++topZ;
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    });

    handle.addEventListener('pointermove', function (e) {
      if (!resizing) return;
      var dx = (e.clientX - startX) / canvasZoom;
      var dy = (e.clientY - startY) / canvasZoom;
      var newW = Math.max(minW, startW + dx);
      var newH = Math.max(minH, startH + dy);
      if (lockSquare) {
        var side = Math.max(newW, newH, Math.max(minW, minH));
        newW = side; newH = side;
      }
      el.style.width = newW + 'px';
      el.style.height = newH + 'px';
      e.preventDefault();
    });

    function endResize() { if (resizing) { resizing = false; onChange(); } }
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
  }

  /* ---------- "+" connect-dot linking ---------- */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var linkIdSeq = 0;
  function nextLinkId() { return 'x' + (++linkIdSeq) + Math.random().toString(36).slice(2, 6); }

  var canvasLinkLayer = null;
  var linkAnimT = 0;
  var linkLoopRunning = false;
  var activeLink = null;

  function makeLinkLayer(root) {
    var overlay = document.createElement('div');
    overlay.className = 'link-overlay';
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'connections-svg');
    overlay.appendChild(svg);
    root.appendChild(overlay);
    return { root: root, overlay: overlay, svg: svg, list: [], dotOwners: {}, pathEls: {} };
  }

  function connKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function cornerPoint(el) { return { x: el.offsetLeft + el.offsetWidth, y: el.offsetTop }; }

  function sagPath(p1, p2, phaseSeed) {
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var sag = Math.min(90, dist * 0.22) + 10;
    var sway = Math.sin(linkAnimT / 900 + phaseSeed * 1.7) * Math.min(10, 4 + dist * 0.02);
    var midX = (p1.x + p2.x) / 2;
    var midY = (p1.y + p2.y) / 2 + sag + sway;
    return 'M ' + p1.x + ',' + p1.y + ' Q ' + midX + ',' + midY + ' ' + p2.x + ',' + p2.y;
  }

  function updateLinkLayer(linkLayer) {
    Object.keys(linkLayer.dotOwners).forEach(function (id) {
      var owner = linkLayer.dotOwners[id];
      if (!owner.el.isConnected) { delete linkLayer.dotOwners[id]; return; }
      var p = cornerPoint(owner.el);
      owner.dot.style.left = p.x + 'px';
      owner.dot.style.top = p.y + 'px';
    });
    linkLayer.list.forEach(function (c, i) {
      var pair = linkLayer.pathEls[connKey(c.a, c.b)];
      var ownerA = linkLayer.dotOwners[c.a];
      var ownerB = linkLayer.dotOwners[c.b];
      if (!pair || !ownerA || !ownerB) return;
      var d = sagPath(cornerPoint(ownerA.el), cornerPoint(ownerB.el), i);
      pair.visible.setAttribute('d', d);
      pair.hit.setAttribute('d', d);
    });
  }

  function anyLinkActivity() {
    return !!activeLink || Object.keys(canvasLinkLayer.dotOwners).length > 0;
  }

  function tickLinks(ts) {
    linkAnimT = ts || 0;
    updateLinkLayer(canvasLinkLayer);
    if (activeLink) updateActiveLinkTemp();
    if (anyLinkActivity()) requestAnimationFrame(tickLinks);
    else linkLoopRunning = false;
  }

  function ensureLinkLoop() {
    if (linkLoopRunning) return;
    linkLoopRunning = true;
    requestAnimationFrame(tickLinks);
  }

  function rebuildLinkPaths(linkLayer) {
    linkLayer.svg.innerHTML = '';
    linkLayer.pathEls = {};
    linkLayer.list.forEach(function (c) {
      var key = connKey(c.a, c.b);
      var hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('class', 'link-path-hit');
      hit.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      hit.addEventListener('click', function (e) {
        e.stopPropagation();
        linkLayer.list = linkLayer.list.filter(function (x) { return connKey(x.a, x.b) !== key; });
        rebuildLinkPaths(linkLayer);
        onChange();
      });
      var visible = document.createElementNS(SVG_NS, 'path');
      visible.setAttribute('class', 'link-path');
      linkLayer.svg.appendChild(hit);
      linkLayer.svg.appendChild(visible);
      linkLayer.pathEls[key] = { hit: hit, visible: visible };
    });
    ensureLinkLoop();
  }

  function attachConnectDot(el, existingId) {
    var id = existingId || nextLinkId();
    el.dataset.linkId = id;
    var dot = document.createElement('div');
    dot.className = 'connect-dot';
    dot.textContent = '+';
    dot.title = 'Drag to connect this to another card';
    dot.addEventListener('pointerdown', function (e) { startLinking(e, id, dot); });
    canvasLinkLayer.overlay.appendChild(dot);
    canvasLinkLayer.dotOwners[id] = { el: el, dot: dot };
    ensureLinkLoop();
    return id;
  }

  function purgeConnectionsFor(linkId) {
    if (!linkId) return;
    canvasLinkLayer.list = canvasLinkLayer.list.filter(function (c) { return c.a !== linkId && c.b !== linkId; });
    var owner = canvasLinkLayer.dotOwners[linkId];
    if (owner) { owner.dot.remove(); delete canvasLinkLayer.dotOwners[linkId]; }
    rebuildLinkPaths(canvasLinkLayer);
  }

  function startLinking(e, fromId, dotEl) {
    e.preventDefault();
    e.stopPropagation();
    var tempPath = document.createElementNS(SVG_NS, 'path');
    tempPath.setAttribute('class', 'link-path-temp');
    canvasLinkLayer.svg.appendChild(tempPath);
    dotEl.classList.add('linking');
    document.body.classList.add('linking-active');

    var rootRect = canvasLinkLayer.root.getBoundingClientRect();
    activeLink = {
      fromId: fromId, dotEl: dotEl, tempPath: tempPath,
      x: e.clientX - rootRect.left, y: e.clientY - rootRect.top
    };
    window.addEventListener('pointermove', onLinkPointerMove);
    window.addEventListener('pointerup', onLinkPointerUp);
    ensureLinkLoop();
  }

  function onLinkPointerMove(e) {
    if (!activeLink) return;
    var rootRect = canvasLinkLayer.root.getBoundingClientRect();
    activeLink.x = e.clientX - rootRect.left;
    activeLink.y = e.clientY - rootRect.top;
  }

  function updateActiveLinkTemp() {
    var owner = canvasLinkLayer.dotOwners[activeLink.fromId];
    if (!owner) return;
    activeLink.tempPath.setAttribute('d', sagPath(cornerPoint(owner.el), { x: activeLink.x, y: activeLink.y }, 0));
  }

  function onLinkPointerUp(e) {
    if (!activeLink) return;
    var link = activeLink;
    window.removeEventListener('pointermove', onLinkPointerMove);
    window.removeEventListener('pointerup', onLinkPointerUp);
    link.dotEl.classList.remove('linking');
    document.body.classList.remove('linking-active');
    link.tempPath.remove();
    activeLink = null;

    var targetEl = document.elementFromPoint(e.clientX, e.clientY);
    var targetDot = targetEl && targetEl.closest('.connect-dot');
    if (!targetDot) return;

    var toId = null;
    Object.keys(canvasLinkLayer.dotOwners).forEach(function (id) {
      if (canvasLinkLayer.dotOwners[id].dot === targetDot) toId = id;
    });
    if (!toId || toId === link.fromId) return;

    var key = connKey(link.fromId, toId);
    var exists = canvasLinkLayer.list.some(function (c) { return connKey(c.a, c.b) === key; });
    if (exists) return;

    canvasLinkLayer.list.push({ a: link.fromId, b: toId });
    rebuildLinkPaths(canvasLinkLayer);
    onChange();
  }

  function getConnections() { return canvasLinkLayer.list.slice(); }
  function setConnections(list) { canvasLinkLayer.list = list || []; rebuildLinkPaths(canvasLinkLayer); }
  function nextZ() { return ++topZ; }

  global.Canvas = {
    init: init,
    layer: function () { return layer; },
    screenToCanvas: screenToCanvas,
    canvasToScreen: canvasToScreen,
    onWorldPointerMove: onWorldPointerMove,
    randomPos: randomPos,
    makeDraggable: makeDraggable,
    makeResizable: makeResizable,
    attachConnectDot: attachConnectDot,
    purgeConnectionsFor: purgeConnectionsFor,
    getConnections: getConnections,
    setConnections: setConnections,
    nextZ: nextZ
  };
})(window);
