/* ==========================================================================
   Sticky notes — draggable/resizable cards with a rich-text toolbar
   (font, size, color, bold/italic/underline) and a "+" connect dot.
   Same pattern as Notesino's notes, generalized on top of Canvas.
   ========================================================================== */
(function (global) {
  var FONT_OPTIONS = [
    { id: 'system', label: 'System', css: '-apple-system, sans-serif' },
    { id: 'poppins', label: 'Poppins', css: '"Poppins", sans-serif' },
    { id: 'opensans', label: 'Open Sans', css: '"Open Sans", sans-serif' },
    { id: 'mono', label: 'Mono', css: '"SF Mono", "Courier New", monospace' }
  ];
  var FONT_SIZES = [12, 14, 16, 18, 22, 28];
  var COLORS = ['#ffd166', '#ff8fa3', '#8ecae6', '#95d5b2', '#c8b6ff', '#ffffff'];

  function setNoteColor(card, dotBtn, color) { card.style.background = color; dotBtn.style.color = color; }

  function createNote(data, onChange) {
    var layer = global.Canvas.layer();
    var color = (data && data.color) || COLORS[Math.floor(Math.random() * COLORS.length)];
    var pos = data && data.x !== undefined ? { x: data.x, y: data.y } : global.Canvas.randomPos();

    var card = document.createElement('div');
    card.className = 'note';
    card.style.left = pos.x + 'px';
    card.style.top = pos.y + 'px';
    card.style.width = (data && data.w ? data.w : 200) + 'px';
    card.style.height = (data && data.h ? data.h : 160) + 'px';
    card.style.background = color;
    card.style.zIndex = global.Canvas.nextZ();

    var head = document.createElement('div');
    head.className = 'note-head';

    var dot = document.createElement('button');
    dot.className = 'note-dot';
    dot.style.color = color;
    dot.title = 'Change color';
    dot.addEventListener('click', function (e) {
      e.stopPropagation();
      var idx = COLORS.indexOf(card.style.background && rgbToHex(card.style.background) || color);
      var next = COLORS[(Math.max(idx, 0) + 1) % COLORS.length];
      setNoteColor(card, dot, next);
      onChange();
    });

    var right = document.createElement('div');
    right.className = 'note-head-right';

    var fontSelect = document.createElement('select');
    fontSelect.className = 'note-font-select';
    var fp = document.createElement('option'); fp.textContent = 'Font'; fp.disabled = true; fp.selected = true;
    fontSelect.appendChild(fp);
    FONT_OPTIONS.forEach(function (f) {
      var opt = document.createElement('option'); opt.value = f.id; opt.textContent = f.label; fontSelect.appendChild(opt);
    });

    var sizeSelect = document.createElement('select');
    sizeSelect.className = 'note-size-select';
    var sp = document.createElement('option'); sp.textContent = 'Size'; sp.disabled = true; sp.selected = true;
    sizeSelect.appendChild(sp);
    FONT_SIZES.forEach(function (s) {
      var opt = document.createElement('option'); opt.value = s; opt.textContent = s; sizeSelect.appendChild(opt);
    });

    var colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = '#16161c';
    colorInput.title = 'Text color';

    var boldBtn = mkFmtBtn('<b>B</b>', 'Bold');
    var italicBtn = mkFmtBtn('I', 'Italic');
    var underlineBtn = mkFmtBtn('U', 'Underline');
    var closeBtn = document.createElement('button');
    closeBtn.className = 'note-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Delete note';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      global.Canvas.purgeConnectionsFor(card.dataset.linkId);
      card.remove();
      onChange();
    });

    [fontSelect, sizeSelect, colorInput, boldBtn, italicBtn, underlineBtn, closeBtn].forEach(function (el) { right.appendChild(el); });
    head.appendChild(dot);
    head.appendChild(right);

    var body = document.createElement('div');
    body.className = 'note-body';
    body.contentEditable = 'true';
    body.innerHTML = (data && data.html) || '';
    body.addEventListener('input', onChange);
    body.addEventListener('pointerdown', function (e) { e.stopPropagation(); });

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
    function mkFmtBtn(html, title) {
      var b = document.createElement('button');
      b.className = 'fmt-btn';
      b.innerHTML = html;
      b.title = title;
      return b;
    }
    boldBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    boldBtn.addEventListener('click', function () { applyFormat('bold'); });
    italicBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    italicBtn.addEventListener('click', function () { applyFormat('italic'); });
    underlineBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
    underlineBtn.addEventListener('click', function () { applyFormat('underline'); });
    fontSelect.addEventListener('change', function (e) {
      var f = FONT_OPTIONS.filter(function (x) { return x.id === e.target.value; })[0];
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

    var resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(resizeHandle);
    layer.appendChild(card);

    global.Canvas.makeDraggable(card, head, onChange);
    global.Canvas.makeResizable(card, resizeHandle, 160, 120);
    global.Canvas.attachConnectDot(card, data && data.linkId);

    return card;
  }

  function rgbToHex(rgb) { return rgb; } // best-effort; used only to advance the color-cycle button

  global.Notes = { createNote: createNote, FONT_OPTIONS: FONT_OPTIONS, FONT_SIZES: FONT_SIZES, COLORS: COLORS };
})(window);
