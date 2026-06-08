# claude.ai Token Tracker — Manual

## What it is

The `tc` (TokenCounter) CLI tool tracks Claude usage by reading session transcripts from `~/.claude/projects/`. Those transcripts are written by the Claude Code CLI. Sessions on **claude.ai** — the browser chat — are never written to disk, so they are invisible to `tc`.

This browser extension closes that gap. It intercepts the network traffic from claude.ai, estimates per-turn token usage, and writes JSONL records to `~/.claude/claude-ai/` in a format that `tc` already understands. After installing the extension, `tc logs`, `tc window`, `tc watch`, and `tc forecast` all reflect your full Claude usage across both Claude Code and claude.ai.

---

## Prerequisites

- **Chrome 111 or later**
- **Node.js** (any recent version — needed once to build the tokenizer bundle)
- **Python 3.8 or later** (must be on PATH — the native host runs as a Python script)

---

## Setup

### Step 1 — Build

The extension uses [gpt-tokenizer](https://github.com/niieani/gpt-tokenizer) to estimate token counts. Both the tokenizer and the background service worker are bundled with esbuild before the extension can be loaded — this is required because Chrome service workers cannot use dynamic `import()`.

```
npm install
npm run build
```

This produces two files in the project root:
- `background.js` (~1.1 MB) — the service worker bundle
- `tokenizer.js` (~1.1 MB) — the tokenizer bundle (used by content scripts)

Both are build artifacts and are **not committed to git**. You must run this step once (or after pulling updates that change `background-src.js` or `tokenizer-src.js`).

### Step 2 — Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the root of this project folder (the folder containing `manifest.json`)
5. The extension card appears. Copy the **Extension ID** — a 32-character string like `abcdefghijklmnopqrstuvwxyzabcdef`

### Step 3 — Register the native host

The extension writes token data to disk via a small Python companion process. Chrome requires this companion to be registered before it will allow the extension to talk to it.

Run the setup script from a command prompt (not PowerShell):

```
host\setup.bat
```

When prompted, paste the Extension ID you copied in Step 2. The script will:

- Write `host\host.json` with the correct paths and extension ID
- Add the required registry key under `HKCU\Software\Google\Chrome\NativeMessagingHosts\`

After setup completes, click the **refresh icon** on the extension card in `chrome://extensions` to reload it.

### Verify it works

**Step 1 — Reload the extension after setup**

After running `host\setup.bat`, click the **refresh icon** on the extension card in `chrome://extensions` to reload it with the updated host registration.

**Step 2 — Open the service worker console**

On the extension card in `chrome://extensions`, click the **"service worker"** link (next to "Inspect views"). This opens a DevTools window for the background script. Keep the **Console** tab visible.

**Step 3 — Send a test message**

Open any `claude.ai/chat/...` conversation in Chrome, send a short message, and wait for the full response to finish streaming.

**Step 4 — Confirm the log sequence**

You should see these four lines in the service worker console:

```
[claude-tc] TURN_SSE_DONE <conv-uuid>  outputLen: <N>
[claude-tc] CONVERSATION_FETCHED <conv-uuid>  msgs: <N>
[claude-tc] assembled record — input_tokens: X  output_tokens: Y
[claude-tc] host response: {ok: true}
```

**Step 5 — Confirm the file was written**

```
%USERPROFILE%\.claude\claude-ai\
```

A file named `<conversation-uuid>.jsonl` should appear. Each assistant turn appends one JSON record to that file.

**Step 6 — Confirm tc sees it**

The TokenCounter project (`C:\Adrian\DEV\Projects\TokenCounter`) needs a one-time update to also scan `~/.claude/claude-ai/`. Once that update is made, running `tc logs` will show claude.ai sessions alongside Claude Code sessions.

---

## How to use it

Once installed, the extension is fully automatic. Every time you send a message in a `claude.ai/chat/...` conversation, the extension:

1. Captures the response as it streams in
2. Waits for claude.ai to fetch the updated conversation (which happens automatically in the background)
3. Estimates token counts for both input and output
4. Appends a record to `~/.claude/claude-ai/<session-id>.jsonl`
5. Updates the in-page token counter widget

**Note:** `tc` must be updated to also scan `~/.claude/claude-ai/` in addition to `~/.claude/projects/`. That change lives in the **TokenCounter** project (`C:\Adrian\DEV\Projects\TokenCounter`), not here.

### In-page token counter widget

A small floating widget is injected into every `claude.ai/chat/...` page. It appears in the **bottom-right corner** by default, is draggable, and saves its position across reloads.

**Collapsed badge (always visible):**

```
tc  1.2k · 324 · 23%
    ^^^^   ^^^   ^^^
    in     out   5h window usage (purple, appears after first turn)
```

Input tokens in blue, output tokens in green, 5h window percentage in purple.

**Expanded panel (hover to reveal):**

The widget expands upward (or downward if near the top of the viewport) to show:

| Section | Contents |
|---|---|
| Header | Conversation name + model |
| Last turn | Input and output token counts for the most recent assistant response |
| Conversation total | Cumulative input and output tokens for the current conversation |
| 5h window | Rolling token total (all sessions) · progress bar · reset countdown · editable limit |

**5h window section:**

```
5h window
  Tokens    2.3M / 10M  (23%)
  [▓▓▓▓▓░░░░░░░░░░░░░░░]
  Resets    in 3h 20m
  Limit     [10] M
```

- The **token total** is computed by the native host scanning every `.jsonl` file under `~/.claude/claude-ai/` (claude.ai sessions) and `~/.claude/projects/` (Claude Code CLI sessions), summing all token fields for records timestamped within the last 5 hours. This gives a true cross-session rolling total on this device.
- The **reset countdown** comes from the `message_limit` SSE event that claude.ai fires after each turn, and refreshes every minute.
- The **Limit** field is always editable — click the number and type your plan's token budget in millions (default: 10 for the Pro 10M limit). The value is saved to `localStorage` and takes effect immediately.

**Dragging:**

Click and drag the badge to reposition the widget anywhere on screen. Position is saved to `localStorage` and restored on the next page load. If dragged near the top of the viewport, the detail panel automatically flips to open downward.

**Conversation switching:**

Conversation-level totals (last turn, conversation total) reset automatically when the active conversation ID changes. The 5h window total is unaffected — it reflects all sessions regardless of which conversation is open.

**Relationship to disk writes:**

The widget only updates after `sendToHost` succeeds — meaning the JSONL record was written to disk first. If the native host is unreachable for any reason, neither the file nor the widget updates. They are always in sync.

### What gets recorded

Each completed assistant turn produces one JSON record:

```json
{
  "type": "assistant",
  "timestamp": "2026-05-15T10:34:21.000Z",
  "source": "claude.ai",
  "project": "Tracking browser session token usage",
  "session_id": "e3e94827-b8e6-48ee-96b0-75107a717d65",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 4821,
      "output_tokens": 312,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0
    }
  }
}
```

### Accuracy

| Field | Accuracy | Notes |
|---|---|---|
| `model` | Exact | Read from the request body |
| `output_tokens` | ~95% | All streamed text deltas tokenized with cl100k_base |
| `input_tokens` | ~90% | Full conversation history tokenized; excludes the hidden system prompt |
| `session_id` | Exact | UUID from the URL |
| `project` | Exact | Conversation name from the claude.ai API |

Token counts are estimates — claude.ai does not expose exact server-side counts in the browser. The cl100k_base tokenizer (GPT-4 / Claude compatible) gives ~90–95% accuracy.

### Known limitations

- **claude.ai/chat only** — Claude Designer (`claude.ai/design`) uses a binary protobuf API and is not supported in Phase 1.
- **System prompt not counted** — claude.ai injects a system prompt server-side that is not visible to the extension. Input tokens will be underestimated by that amount.
- **Navigate-away loss** — If you close or navigate away from a tab immediately after sending a message, the extension may not capture that turn (the conversation fetch that completes the record may not fire in time).
- **Multi-tab deduplication** — Opening the same conversation in two tabs simultaneously may produce duplicate records.

---

## How it was built

### The problem with claude.ai's API

Claude Code CLI writes exact token counts to local JSONL transcripts. The claude.ai web app does not — the Anthropic Messages API's `usage` block is stripped before the SSE stream reaches the browser. The `model` field in the `message_start` event is also an empty string. There is no public endpoint that returns token counts for a given browser session.

### HAR analysis

Before writing any code, the claude.ai network traffic was captured in HAR files and analysed to understand what data is actually available in the browser.

Key findings:

- **Completion endpoint**: `POST /api/organizations/{org_id}/chat_conversations/{conv_id}/completion` — streams SSE; request body contains the model name and the new user message
- **SSE stream**: contains `content_block_delta` events with the response text, but **no token counts** and **no model name**
- **Conversation endpoint**: `GET /api/organizations/{org_id}/chat_conversations/{conv_id}?...consistency=strong` — returns the full conversation as JSON including model and all message text; claude.ai fetches this automatically after every turn
- **Rate limit event**: `message_limit` in the SSE stream tracks message-count utilization (not token count), so it cannot be used to calibrate token estimates

### Architecture

```
 claude.ai/chat page
 ┌──────────────────────────────────────────┐
 │  content-main.js  (world: MAIN)          │
 │  - patches window.fetch                  │
 │  - taps POST /completion → SSE text      │
 │  - taps GET chat_conversations → history │
 │  - sends via window.postMessage          │
 └──────────────────┬───────────────────────┘
                    │ window.postMessage
 ┌──────────────────▼───────────────────────┐
 │  content-isolated.js  (world: ISOLATED)  │
 │  - relays to background                  │
 │    via chrome.runtime.sendMessage        │
 └──────────────────┬───────────────────────┘
                    │ chrome.runtime.sendMessage
 ┌──────────────────▼───────────────────────┐
 │  background.js  (service worker)         │
 │  - correlates SSE + conversation events  │
 │    via chrome.storage.session            │
 │  - tokenizes input + output text         │
 │  - sends turn record to native host      │
 │  - notifies overlay via tabs.sendMessage │
 └──────────┬───────────────────────────────┘
            │ Chrome Native Messaging  │ chrome.tabs.sendMessage
 ┌──────────▼────────────┐  ┌──────────▼───────────────────────┐
 │  host/host.py         │  │  content-overlay.js              │
 │  - receives records   │  │  (world: ISOLATED, document_end) │
 │  - appends to         │  │  - draggable floating widget     │
 │    ~/.claude/         │  │  - last-turn + session totals    │
 │    claude-ai/         │  │  - 5h rolling window % vs.       │
 │    {session}.jsonl    │  │    configurable token limit      │
 │  - scans all JSONL    │  │  - reset countdown from SSE      │
 │    for 5h token total │  └──────────────────────────────────┘
 │  - returns            │
 │    window_tokens      │
 └───────────────────────┘
```

### Why two content scripts?

Chrome Manifest V3 content scripts can run in two worlds:

- **MAIN world** — the page's own JavaScript context. Has access to `window.fetch` (needed to patch it) but has **no access** to `chrome.*` APIs.
- **ISOLATED world** — the extension's sandboxed context. Has `chrome.*` APIs but a separate copy of `window`, so patching `window.fetch` here has no effect on the page.

The solution is two scripts: `content-main.js` patches fetch and communicates via `window.postMessage`; `content-isolated.js` listens for those messages and forwards them to the background via `chrome.runtime.sendMessage`.

### Why intercept the conversation GET?

The completion POST body only contains the **new user message** (`prompt` field). The server reconstructs the full conversation history server-side using the `parent_message_uuid` chain. So tokenizing just the prompt severely underestimates input tokens.

After every turn, claude.ai automatically fetches the full conversation (`consistency=strong`) to update its UI. The extension intercepts this response to get the complete message history, which can be tokenized to estimate the full input context.

### Why Native Messaging?

Browser extensions cannot write to the local filesystem directly. Chrome's [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) protocol allows an extension to communicate with a locally registered process via stdin/stdout. The Python companion (`host.py`) receives turn records from the extension and writes them to disk using the 4-byte length-prefixed JSON framing that Chrome requires.

### File structure

```
manifest.json           — MV3 extension manifest
content-main.js         — fetch interceptor (world: MAIN)
content-isolated.js     — message relay (world: ISOLATED)
content-overlay.js      — in-page widget: per-turn/session counts, 5h window %, draggable (world: ISOLATED, document_end)
background-src.js       — service worker source (esbuild entry point)
background.js           — service worker bundle (esbuild output, gitignored)
tokenizer-src.js        — gpt-tokenizer wrapper (esbuild entry point)
tokenizer.js            — tokenizer bundle (esbuild output, gitignored)
check-install.ps1       — cross-machine install and version check script
host/
  host.py               — native messaging host (JSONL writer)
  host.bat              — Windows executable wrapper for host.py
  host.json             — native messaging host manifest (generated by setup.py)
  setup.bat             — one-time setup: calls setup.py
  setup.py              — writes host.json + adds Windows registry key
  test_host.py          — smoke test: pipes a synthetic record to host.py
package.json            — npm: gpt-tokenizer + esbuild + build script
```

---

## Phase 2 (not yet built)

Claude Designer (`claude.ai/design`) uses a completely different backend: **Connect RPC** with binary protobuf encoding (`OmeletteService/Chat`). There are no JSON events to intercept and no readable text in the response stream. Supporting it would require a protobuf decoder and knowledge of the `OmeletteService` schema. This is deferred to Phase 2.
