(function () {
  if (document.getElementById('claude-tc-overlay')) return;

  // ── State ─────────────────────────────────────────────────────────────────
  let currentConvId   = null;
  let currentConvName = '';
  let sessionIn  = 0;
  let sessionOut = 0;
  let lastIn     = 0;
  let lastOut    = 0;
  let lastModel  = '';
  let limitData  = null; // raw messageLimit object from SSE

  // Refresh reset-time countdown every minute
  setInterval(() => { if (limitData?.resetsAt) render(); }, 60_000);

  // ── Styles ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #claude-tc-overlay {
      position: fixed;
      bottom: 24px;
      right: 20px;
      z-index: 2147483647;
      font-family: ui-monospace, 'SF Mono', 'Cascadia Code', monospace;
      font-size: 11px;
      line-height: 1.5;
      user-select: none;
    }

    /* ── Badge (always visible) ── */
    #claude-tc-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(20, 20, 23, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 20px;
      padding: 4px 11px;
      color: #e4e4e7;
      cursor: grab;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      white-space: nowrap;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.30);
    }
    #claude-tc-overlay.dragging #claude-tc-badge { cursor: grabbing; }
    #claude-tc-badge .ctc-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; margin-right: 2px; }
    #claude-tc-badge .ctc-in    { color: #60a5fa; font-weight: 600; }
    #claude-tc-badge .ctc-out   { color: #34d399; font-weight: 600; }
    #claude-tc-badge .ctc-pct   { color: #a78bfa; font-weight: 600; }
    #claude-tc-badge .ctc-sep   { color: #52525b; }

    /* ── Detail panel (hover) ── */
    #claude-tc-detail {
      visibility: hidden;
      opacity: 0;
      position: absolute;
      bottom: calc(100% + 8px);
      right: 0;
      background: rgba(20, 20, 23, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 10px;
      padding: 12px 14px;
      color: #ffffff;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      min-width: 220px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      transition: opacity 0.12s ease, visibility 0.12s ease;
    }
    /* Suppress hover-expand while dragging */
    #claude-tc-overlay:not(.dragging):hover #claude-tc-detail {
      visibility: visible;
      opacity: 1;
    }
    /* Flip panel below badge when widget is near top of viewport */
    #claude-tc-detail.ctc-below {
      bottom: auto;
      top: calc(100% + 8px);
    }

    #claude-tc-detail .ctc-conv       { color: #e4e4e7; font-size: 10px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 210px; }
    #claude-tc-detail .ctc-model-name { color: #71717a; font-size: 10px; margin-bottom: 10px; }
    #claude-tc-detail table            { width: 100%; border-collapse: collapse; }
    #claude-tc-detail td               { padding: 1px 0; color: #d4d4d8; }
    #claude-tc-detail td:last-child    { text-align: right; font-weight: 600; }
    #claude-tc-detail .ctc-section-row td { color: #71717a; font-size: 9px; text-transform: uppercase; letter-spacing: 0.07em; padding-top: 9px; padding-bottom: 2px; }
    #claude-tc-detail .ctc-in-val  { color: #60a5fa; }
    #claude-tc-detail .ctc-out-val { color: #34d399; }
    #claude-tc-detail .ctc-pct-val { color: #a78bfa; }
    #claude-tc-detail .ctc-dim     { color: #71717a; }

    /* 5h window progress bar */
    #claude-tc-bar-wrap {
      margin-top: 6px;
      background: #3f3f46;
      border-radius: 3px;
      height: 4px;
      overflow: hidden;
    }
    #claude-tc-bar-fill {
      height: 100%;
      background: #a78bfa;
      border-radius: 3px;
      transition: width 0.4s ease;
    }
  `;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'claude-tc-overlay';
  overlay.innerHTML = `
    <div id="claude-tc-detail">
      <div class="ctc-conv"       id="ctc-conv">—</div>
      <div class="ctc-model-name" id="ctc-model">—</div>
      <table>
        <tr class="ctc-section-row"><td colspan="2">Last turn</td></tr>
        <tr><td>Input</td>  <td class="ctc-in-val"  id="ctc-last-in">—</td></tr>
        <tr><td>Output</td> <td class="ctc-out-val" id="ctc-last-out">—</td></tr>
        <tr class="ctc-section-row"><td colspan="2">Conversation total</td></tr>
        <tr><td>Input</td>  <td class="ctc-in-val"  id="ctc-ses-in">—</td></tr>
        <tr><td>Output</td> <td class="ctc-out-val" id="ctc-ses-out">—</td></tr>
        <tr class="ctc-section-row" id="ctc-limit-header" style="display:none"><td colspan="2">5h window</td></tr>
        <tr id="ctc-limit-msgs-row" style="display:none"><td>Messages</td><td class="ctc-pct-val" id="ctc-limit-msgs">—</td></tr>
        <tr id="ctc-limit-reset-row" style="display:none"><td>Resets</td><td class="ctc-dim" id="ctc-limit-reset">—</td></tr>
      </table>
      <div id="claude-tc-bar-wrap" style="display:none">
        <div id="claude-tc-bar-fill" style="width:0%"></div>
      </div>
    </div>
    <div id="claude-tc-badge">
      <span class="ctc-label">tc</span>
      <span class="ctc-in"  id="ctc-badge-in">—</span>
      <span class="ctc-sep">·</span>
      <span class="ctc-out" id="ctc-badge-out">—</span>
      <span class="ctc-sep" id="ctc-pct-sep"  style="display:none">·</span>
      <span class="ctc-pct" id="ctc-badge-pct" style="display:none">—</span>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── Restore saved position ────────────────────────────────────────────────
  const savedPos = (() => {
    try { return JSON.parse(localStorage.getItem('claude-tc-pos')); } catch { return null; }
  })();
  if (savedPos) {
    overlay.style.right  = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.left   = Math.min(savedPos.left, window.innerWidth  - 120) + 'px';
    overlay.style.top    = Math.min(savedPos.top,  window.innerHeight -  36) + 'px';
  }
  updatePanelDirection();

  // ── Drag ─────────────────────────────────────────────────────────────────
  document.getElementById('claude-tc-badge').addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = overlay.getBoundingClientRect();
    let curLeft = rect.left;
    let curTop  = rect.top;
    overlay.style.right  = 'auto';
    overlay.style.bottom = 'auto';
    overlay.style.left   = curLeft + 'px';
    overlay.style.top    = curTop  + 'px';
    overlay.classList.add('dragging');

    let lastX = e.clientX;
    let lastY = e.clientY;

    function onMove(e) {
      curLeft += e.clientX - lastX;
      curTop  += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      curLeft = Math.max(0, Math.min(window.innerWidth  - 80, curLeft));
      curTop  = Math.max(0, Math.min(window.innerHeight - 30, curTop));
      overlay.style.left = curLeft + 'px';
      overlay.style.top  = curTop  + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      overlay.classList.remove('dragging');
      localStorage.setItem('claude-tc-pos', JSON.stringify({ left: curLeft, top: curTop }));
      updatePanelDirection();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TURN_COUNTED') {
      if (msg.convId !== currentConvId) {
        sessionIn       = 0;
        sessionOut      = 0;
        currentConvId   = msg.convId;
        currentConvName = msg.convName || '';
      }
      lastIn  = msg.usage.input_tokens;
      lastOut = msg.usage.output_tokens;
      sessionIn  += lastIn;
      sessionOut += lastOut;
      lastModel = msg.model || lastModel;
      render();
    } else if (msg.type === 'MESSAGE_LIMIT') {
      limitData = msg.messageLimit;
      render();
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────
  function render() {
    // Badge
    setEl('ctc-badge-in',  fmt(sessionIn));
    setEl('ctc-badge-out', fmt(sessionOut));

    // Detail header
    setEl('ctc-conv',  currentConvName || 'Untitled conversation');
    setEl('ctc-model', lastModel);

    // Turn + session counts
    setEl('ctc-last-in',  fmt(lastIn));
    setEl('ctc-last-out', fmt(lastOut));
    setEl('ctc-ses-in',   fmt(sessionIn));
    setEl('ctc-ses-out',  fmt(sessionOut));

    // 5h window
    if (limitData) {
      showEl('ctc-limit-header', true);

      // Message count row — only when server sends remaining + total
      const hasCount = limitData.remaining != null && limitData.total != null;
      if (hasCount) {
        setEl('ctc-limit-msgs', `${limitData.total - limitData.remaining} / ${limitData.total}`);
      }
      showEl('ctc-limit-msgs-row', hasCount);

      // Reset time
      if (limitData.resetsAt) {
        setEl('ctc-limit-reset', fmtReset(limitData.resetsAt));
        showEl('ctc-limit-reset-row', true);
      } else {
        showEl('ctc-limit-reset-row', false);
      }

      // Progress bar + badge percentage
      const pct = computePct();
      if (pct != null) {
        const clamped = Math.max(0, Math.min(100, pct));
        document.getElementById('claude-tc-bar-fill').style.width = clamped + '%';
        showEl('claude-tc-bar-wrap', true);
        setEl('ctc-badge-pct', clamped + '%');
        showEl('ctc-badge-pct', true);
        showEl('ctc-pct-sep',  true);
      } else {
        showEl('claude-tc-bar-wrap', false);
        showEl('ctc-badge-pct', false);
        showEl('ctc-pct-sep',  false);
      }
    }
  }

  function computePct() {
    if (!limitData) return null;
    // Prefer message-count-based percentage
    if (limitData.remaining != null && limitData.total != null && limitData.total > 0) {
      return Math.round((1 - limitData.remaining / limitData.total) * 100);
    }
    // Fall back to time-elapsed percentage (how far into the 5h window are we)
    if (limitData.resetsAt) {
      const msLeft = new Date(limitData.resetsAt) - Date.now();
      return Math.round((1 - Math.max(0, msLeft) / (5 * 3_600_000)) * 100);
    }
    return null;
  }

  function fmtReset(resetsAt) {
    const ms = Math.max(0, new Date(resetsAt) - Date.now());
    if (ms === 0) return 'any moment';
    const totalMin = Math.ceil(ms / 60_000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }

  function fmt(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  function setEl(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function showEl(id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  }

  function updatePanelDirection() {
    const detail = document.getElementById('claude-tc-detail');
    if (!detail) return;
    const rect = overlay.getBoundingClientRect();
    detail.classList.toggle('ctc-below', rect.top < 280);
  }
})();
