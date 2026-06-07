(function () {
  if (document.getElementById('claude-tc-overlay')) return;

  // Per-conversation running totals (reset when convId changes)
  let currentConvId  = null;
  let currentConvName = '';
  let sessionIn  = 0;
  let sessionOut = 0;
  let lastIn     = 0;
  let lastOut    = 0;
  let lastModel  = '';

  // ── Styles ───────────────────────────────────────────────────────────────────

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
      text-rendering: optimizeLegibility;
    }

    /* Collapsed badge — always visible */
    #claude-tc-badge {
      display: flex;
      align-items: center;
      gap: 5px;
      background: rgba(20, 20, 23, 0.88);
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: 20px;
      padding: 4px 11px;
      color: #71717a;
      cursor: default;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      white-space: nowrap;
    }
    #claude-tc-badge .ctc-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #52525b;
      margin-right: 2px;
    }
    #claude-tc-badge .ctc-in  { color: #60a5fa; font-weight: 600; }
    #claude-tc-badge .ctc-out { color: #34d399; font-weight: 600; }
    #claude-tc-badge .ctc-sep { color: #3f3f46; }

    /* Expanded detail panel — appears above badge on hover */
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
      color: #d4d4d8;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      min-width: 210px;
      transition: opacity 0.12s ease, visibility 0.12s ease;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    #claude-tc-overlay:hover #claude-tc-detail {
      visibility: visible;
      opacity: 1;
    }

    #claude-tc-detail .ctc-conv {
      color: #a1a1aa;
      font-size: 10px;
      margin-bottom: 10px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 200px;
    }
    #claude-tc-detail .ctc-model-name {
      color: #52525b;
      font-size: 10px;
      margin-top: -6px;
      margin-bottom: 10px;
    }
    #claude-tc-detail table {
      width: 100%;
      border-collapse: collapse;
    }
    #claude-tc-detail td {
      padding: 1px 0;
      color: #71717a;
    }
    #claude-tc-detail td:last-child {
      text-align: right;
      font-weight: 600;
    }
    #claude-tc-detail .ctc-section-row td {
      color: #3f3f46;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      padding-top: 9px;
      padding-bottom: 2px;
    }
    #claude-tc-detail .ctc-in-val  { color: #60a5fa; }
    #claude-tc-detail .ctc-out-val { color: #34d399; }
  `;
  document.head.appendChild(style);

  // ── DOM ───────────────────────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.id = 'claude-tc-overlay';
  overlay.innerHTML = `
    <div id="claude-tc-detail">
      <div class="ctc-conv"    id="ctc-conv">—</div>
      <div class="ctc-model-name" id="ctc-model">—</div>
      <table>
        <tr class="ctc-section-row"><td colspan="2">Last turn</td></tr>
        <tr><td>Input</td> <td class="ctc-in-val"  id="ctc-last-in">—</td></tr>
        <tr><td>Output</td><td class="ctc-out-val" id="ctc-last-out">—</td></tr>
        <tr class="ctc-section-row"><td colspan="2">Conversation total</td></tr>
        <tr><td>Input</td> <td class="ctc-in-val"  id="ctc-ses-in">—</td></tr>
        <tr><td>Output</td><td class="ctc-out-val" id="ctc-ses-out">—</td></tr>
      </table>
    </div>
    <div id="claude-tc-badge">
      <span class="ctc-label">tc</span>
      <span class="ctc-in"  id="ctc-badge-in">—</span>
      <span class="ctc-sep">·</span>
      <span class="ctc-out" id="ctc-badge-out">—</span>
    </div>
  `;
  document.body.appendChild(overlay);

  // ── Message listener ──────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== 'TURN_COUNTED') return;

    // Reset totals when the user switches to a different conversation
    if (msg.convId !== currentConvId) {
      sessionIn  = 0;
      sessionOut = 0;
      currentConvId   = msg.convId;
      currentConvName = msg.convName || '';
    }

    lastIn  = msg.usage.input_tokens;
    lastOut = msg.usage.output_tokens;
    sessionIn  += lastIn;
    sessionOut += lastOut;
    lastModel = msg.model || lastModel;

    render();
  });

  // ── Render ────────────────────────────────────────────────────────────────────

  function render() {
    document.getElementById('ctc-badge-in').textContent  = fmt(sessionIn);
    document.getElementById('ctc-badge-out').textContent = fmt(sessionOut);
    document.getElementById('ctc-conv').textContent      = currentConvName || 'Untitled conversation';
    document.getElementById('ctc-model').textContent     = lastModel;
    document.getElementById('ctc-last-in').textContent   = fmt(lastIn);
    document.getElementById('ctc-last-out').textContent  = fmt(lastOut);
    document.getElementById('ctc-ses-in').textContent    = fmt(sessionIn);
    document.getElementById('ctc-ses-out').textContent   = fmt(sessionOut);
  }

  function fmt(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }
})();
