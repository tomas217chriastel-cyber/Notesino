/* ==========================================================================
   App bootstrap — wires Canvas + Notes + Timetable together, the "+" add
   menu, and local persistence (localStorage; the same per-device
   workspace-save pattern Notesino uses).
   ========================================================================== */
(function (global) {
  var STORAGE_KEY = 'schoolboard_workspace_v1';
  var saveTimer = null;

  function $(id) { return document.getElementById(id); }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveWorkspace, 300);
  }

  function serializeCard(card) {
    var base = {
      x: parseFloat(card.style.left) || 0,
      y: parseFloat(card.style.top) || 0,
      w: card.offsetWidth,
      h: card.offsetHeight,
      linkId: card.dataset.linkId
    };
    if (card.classList.contains('table-card')) {
      var t = card._serialize();
      base.type = 'timetable';
      base.columns = t.columns;
      base.rows = t.rows;
    } else {
      base.type = 'note';
      base.color = card.style.background;
      base.html = card.querySelector('.note-body').innerHTML;
    }
    return base;
  }

  function saveWorkspace() {
    var layer = global.Canvas.layer();
    var cards = Array.prototype.map.call(layer.querySelectorAll(':scope > .note'), serializeCard);
    var state = { cards: cards, connections: global.Canvas.getConnections() };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage full/unavailable — non-fatal */ }
  }

  function loadWorkspace() {
    var raw;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) { seedDefaultTimetable(); return; }
    var state;
    try { state = JSON.parse(raw); } catch (e) { seedDefaultTimetable(); return; }
    (state.cards || []).forEach(function (data) {
      if (data.type === 'timetable') global.Timetable.createTimetable(data, scheduleSave);
      else global.Notes.createNote(data, scheduleSave);
    });
    if (state.connections) global.Canvas.setConnections(state.connections);
  }

  function seedDefaultTimetable() {
    global.Timetable.createTimetable({ x: 60, y: 100 }, scheduleSave);
  }

  function wireAddMenu() {
    var btn = $('addMenuBtn');
    var menu = $('addMenu');
    if (!btn || !menu) return;
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
    document.addEventListener('pointerdown', function (e) {
      if (menu.classList.contains('open') && !e.target.closest('.add-menu-wrap')) menu.classList.remove('open');
    });
    var addNoteBtn = $('addNoteBtn');
    var addTimetableBtn = $('addTimetableBtn');
    if (addNoteBtn) addNoteBtn.addEventListener('click', function () {
      global.Notes.createNote(null, scheduleSave);
      scheduleSave();
      menu.classList.remove('open');
    });
    if (addTimetableBtn) addTimetableBtn.addEventListener('click', function () {
      global.Timetable.createTimetable(null, scheduleSave);
      scheduleSave();
      menu.classList.remove('open');
    });
  }

  function init() {
    var viewport = $('canvasViewport');
    var layer = $('canvasLayer');
    global.Canvas.init(viewport, layer, scheduleSave);
    wireAddMenu();
    loadWorkspace();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
