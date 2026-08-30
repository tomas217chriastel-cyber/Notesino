/* ==========================================================================
   Timetable card — the app's core feature.

   A draggable/resizable card (same chrome as a note) holding an editable
   grid of lessons: start time, end time, subject, room, teacher, and a
   free-lesson toggle. Rows/columns can be added or removed exactly like
   Notesino's generic Table instance, cell text supports the same
   font/size/color/bold/italic/underline formatting, and the grid
   continuously highlights the "current" and "next" lesson by comparing
   each row's start/end time to the clock — the requested "what's next"
   indicator.

   Extra columns beyond the five defaults are plain text (no special
   role), so the grid stays a general editable table like Notesino's,
   just seeded with the fields the brief asked for.
   ========================================================================== */
(function (global) {
  var DEFAULT_COLUMNS = [
    { role: 'start', label: 'Start' },
    { role: 'end', label: 'End' },
    { role: 'subject', label: 'Subject' },
    { role: 'room', label: 'Room' },
    { role: 'teacher', label: 'Teacher' },
    { role: 'free', label: 'Free?' }
  ];

  function parseTime(str) {
    var m = /^(\d{1,2}):(\d{2})$/.exec((str || '').trim());
    if (!m) return null;
    var h = +m[1], min = +m[2];
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
  }

  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function createTimetable(data, onChange) {
    var layer = global.Canvas.layer();
    var pos = data && data.x !== undefined ? { x: data.x, y: data.y } : global.Canvas.randomPos();
    var columns = (data && data.columns) || DEFAULT_COLUMNS.map(function (c) { return Object.assign({}, c); });
    var rows = (data && data.rows) || [
      { start: '08:00', end: '08:45', subject: 'Math', room: '204', teacher: 'Mr. Novak', free: false },
      { start: '08:50', end: '09:35', subject: 'Free period', room: '', teacher: '', free: true },
      { start: '09:40', end: '10:25', subject: 'English', room: '110', teacher: 'Ms. Reed', free: false }
    ];

    var card = document.createElement('div');
    card.className = 'note table-card';
    card.style.left = pos.x + 'px';
    card.style.top = pos.y + 'px';
    card.style.width = (data && data.w ? data.w : 460) + 'px';
    card.style.height = (data && data.h ? data.h : 260) + 'px';
    card.style.zIndex = global.Canvas.nextZ();

    var head = document.createElement('div');
    head.className = 'note-head';

    var title = document.createElement('div');
    title.textContent = '📅 Timetable';
    title.style.fontWeight = '700';
    title.style.fontSize = '13px';
    title.style.paddingLeft = '4px';

    var right = document.createElement('div');
    right.className = 'note-head-right';

    var fontSelect = document.createElement('select');
    fontSelect.className = 'note-font-select';
    var fp = document.createElement('option'); fp.textContent = 'Font'; fp.disabled = true; fp.selected = true;
    fontSelect.appendChild(fp);
    global.Notes.FONT_OPTIONS.forEach(function (f) {
      var opt = document.createElement('option'); opt.value = f.id; opt.textContent = f.label; fontSelect.appendChild(opt);
    });
    var sizeSelect = document.createElement('select');
    sizeSelect.className = 'note-size-select';
    var sp = document.createElement('option'); sp.textContent = 'Size'; sp.disabled = true; sp.selected = true;
    sizeSelect.appendChild(sp);
    global.Notes.FONT_SIZES.forEach(function (s) {
      var opt = document.createElement('option'); opt.value = s; opt.textContent = s; sizeSelect.appendChild(opt);
    });
    var colorInput = document.createElement('input');
    colorInput.type = 'color'; colorInput.value = '#16161c'; colorInput.title = 'Text color';
    var boldBtn = mkFmtBtn('<b>B</b>', 'Bold');
    var italicBtn = mkFmtBtn('I', 'Italic');
    var underlineBtn = mkFmtBtn('U', 'Underline');
    var addColBtn = mkFmtBtn('+col', 'Add column');
    var addRowBtn = mkFmtBtn('+row', 'Add row');
    var closeBtn = document.createElement('button');
    closeBtn.className = 'note-close'; closeBtn.innerHTML = '&times;'; closeBtn.title = 'Delete timetable';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      global.Canvas.purgeConnectionsFor(card.dataset.linkId);
      card.remove();
      onChange();
    });

    [fontSelect, sizeSelect, colorInput, boldBtn, italicBtn, underlineBtn, addColBtn, addRowBtn, closeBtn]
      .forEach(function (el) { right.appendChild(el); });
    head.appendChild(title);
    head.appendChild(right);

    function mkFmtBtn(html, titleText) {
      var b = document.createElement('button');
      b.className = 'fmt-btn';
      b.innerHTML = html;
      b.title = titleText;
      b.style.width = 'auto';
      b.style.padding = '0 8px';
      return b;
    }

    var wrap = document.createElement('div');
    wrap.className = 'table-card-wrap';
    var grid = document.createElement('table');
    grid.className = 'table-grid';
    wrap.appendChild(grid);

    var savedRange = null;
    document.addEventListener('selectionchange', function () {
      var sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && card.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    });
    function restoreSelection() {
      if (!savedRange) return false;
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
      return true;
    }
    function applyFormat(cmd, value) {
      if (!restoreSelection()) return;
      document.execCommand(cmd, false, value);
      onChange();
    }
    boldBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    boldBtn.addEventListener('click', function () { applyFormat('bold'); });
    italicBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    italicBtn.addEventListener('click', function () { applyFormat('italic'); });
    underlineBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    underlineBtn.addEventListener('click', function () { applyFormat('underline'); });
    fontSelect.addEventListener('change', function (e) {
      var f = global.Notes.FONT_OPTIONS.filter(function (x) { return x.id === e.target.value; })[0];
      if (f) applyFormat('fontName', f.css.split(',')[0].replace(/['"]/g, ''));
      fontSelect.selectedIndex = 0;
    });
    sizeSelect.addEventListener('change', function (e) {
      var px = e.target.value;
      if (!px || !restoreSelection()) { sizeSelect.selectedIndex = 0; return; }
      document.execCommand('fontSize', false, '7');
      Array.prototype.forEach.call(card.querySelectorAll('font[size="7"]'), function (f) {
        f.removeAttribute('size'); f.style.fontSize = px + 'px';
      });
      onChange();
      sizeSelect.selectedIndex = 0;
    });
    colorInput.addEventListener('input', function (e) { applyFormat('foreColor', e.target.value); });

    function readRowsFromDom() {
      var out = [];
      Array.prototype.forEach.call(grid.querySelectorAll('tbody tr'), function (tr) {
        var row = {};
        Array.prototype.forEach.call(tr.children, function (td, i) {
          var col = columns[i];
          if (!col) return;
          if (col.role === 'free') row.free = !!td.querySelector('input[type="checkbox"]').checked;
          else row[col.role || ('col' + i)] = td.innerHTML;
        });
        out.push(row);
      });
      return out;
    }

    function buildGrid() {
      var currentRows = grid.querySelector('tbody') ? readRowsFromDom() : rows;
      grid.innerHTML = '';
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      columns.forEach(function (col, i) {
        var th = document.createElement('th');
        th.contentEditable = 'true';
        th.textContent = col.label;
        th.addEventListener('input', function () { col.label = th.textContent; onChange(); });
        th.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      grid.appendChild(thead);

      var tbody = document.createElement('tbody');
      currentRows.forEach(function (row) {
        tbody.appendChild(buildRow(row));
      });
      grid.appendChild(tbody);
      rows = currentRows;
      refreshIndicators();
    }

    function buildRow(row) {
      var tr = document.createElement('tr');
      columns.forEach(function (col) {
        var td = document.createElement('td');
        if (col.role === 'free') {
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!row.free;
          cb.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
          cb.addEventListener('change', function () { rows = readRowsFromDom(); refreshIndicators(); onChange(); });
          td.appendChild(cb);
        } else {
          td.contentEditable = 'true';
          td.innerHTML = row[col.role] !== undefined ? row[col.role] : (row['col' + columns.indexOf(col)] || '');
          td.addEventListener('input', function () {
            if (col.role === 'start' || col.role === 'end') refreshIndicators();
            onChange();
          });
        }
        td.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        tr.appendChild(td);
      });
      return tr;
    }

    /* ---------- "What's next" indicator ---------- */
    function refreshIndicators() {
      var trs = grid.querySelectorAll('tbody tr');
      var now = nowMinutes();
      var startColIdx = columns.findIndex(function (c) { return c.role === 'start'; });
      var endColIdx = columns.findIndex(function (c) { return c.role === 'end'; });
      var freeColIdx = columns.findIndex(function (c) { return c.role === 'free'; });

      var candidates = [];
      Array.prototype.forEach.call(trs, function (tr, i) {
        tr.classList.remove('tt-row-current', 'tt-row-next', 'tt-row-free');
        var badgeHost = startColIdx >= 0 ? tr.children[startColIdx] : null;
        var existingBadge = tr.querySelector('.tt-badge');
        if (existingBadge) existingBadge.remove();

        var isFree = freeColIdx >= 0 && tr.children[freeColIdx].querySelector('input') && tr.children[freeColIdx].querySelector('input').checked;
        if (isFree) tr.classList.add('tt-row-free');

        if (startColIdx < 0 || endColIdx < 0) return;
        var start = parseTime(tr.children[startColIdx].textContent);
        var end = parseTime(tr.children[endColIdx].textContent);
        if (start === null || end === null) return;
        candidates.push({ tr: tr, start: start, end: end, badgeHost: badgeHost, isFree: isFree });
      });

      var current = candidates.filter(function (c) { return now >= c.start && now < c.end; })[0];
      var upcoming = candidates.filter(function (c) { return c.start > now; }).sort(function (a, b) { return a.start - b.start; })[0];

      if (current) {
        current.tr.classList.add('tt-row-current');
        addBadge(current.badgeHost, current.isFree ? 'Free now' : 'Now', current.isFree ? 'free' : '');
      }
      if (upcoming && upcoming !== current) {
        upcoming.tr.classList.add('tt-row-next');
        addBadge(upcoming.badgeHost, 'Next', '');
      }
    }

    function addBadge(host, text, cls) {
      if (!host) return;
      var b = document.createElement('span');
      b.className = 'tt-badge' + (cls ? ' ' + cls : '');
      b.textContent = text;
      host.appendChild(b);
    }

    addColBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
    addColBtn.addEventListener('click', function () {
      rows = readRowsFromDom();
      columns.push({ role: '', label: 'New column' });
      buildGrid();
      onChange();
    });
    addRowBtn.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); });
    addRowBtn.addEventListener('click', function () {
      rows = readRowsFromDom();
      rows.push({ start: '', end: '', subject: '', room: '', teacher: '', free: false });
      buildGrid();
      onChange();
    });

    var resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';

    card.appendChild(head);
    card.appendChild(wrap);
    card.appendChild(resizeHandle);
    layer.appendChild(card);

    buildGrid();

    global.Canvas.makeDraggable(card, head, onChange);
    global.Canvas.makeResizable(card, resizeHandle, 320, 180);
    global.Canvas.attachConnectDot(card, data && data.linkId);

    var indicatorTimer = setInterval(refreshIndicators, 30000);
    var origRemove = card.remove.bind(card);
    card.remove = function () { clearInterval(indicatorTimer); origRemove(); };

    card._serialize = function () {
      return { columns: columns, rows: readRowsFromDom() };
    };

    return card;
  }

  global.Timetable = { createTimetable: createTimetable, DEFAULT_COLUMNS: DEFAULT_COLUMNS };
})(window);
