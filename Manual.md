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

### Step 1 — Build the tokenizer

The extension uses [gpt-tokenizer](https://github.com/nicholaides/gpt-tokenizer) to estimate token counts client-side. It needs to be bundled before the extension can be loaded.

```
npm install
npm run build
```

This produces `tokenizer.js` (~1.1 MB) in the project root. You only need to do this once (or after updating `gpt-tokenizer`).

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

1. Open a claude.ai/chat conversation in Chrome
2. Send a message and wait for the response to finish
3. Check `%USERPROFILE%\.claude\claude-ai\` — a file named `<conversation-uuid>.jsonl` should appear
4. Run `tc logs` — the session should appear alongside Claude Code sessions

---

## How to use it

Once installed, the extension is fully automatic. There is no UI, no popup, no settings to configure. Every time you send a message in a `claude.ai/chat/...` conversation, the extension:

1. Captures the response as it streams in
2. Waits for claude.ai to fetch the updated conversation (which happens automatically in the background)
3. Estimates token counts for both input and output
4. Appends a record to `~/.claude/claude-ai/<session-id>.jsonl`

The `tc` CLI picks up these files automatically — no changes to `tc` are needed.

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
 chrome.ai/chat page
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
 └──────────────────┬───────────────────────┘
                    │ Chrome Native Messaging
 ┌──────────────────▼───────────────────────┐
 │  host/host.py                            │
 │  - receives turn records                 │
 │  - appends to                            │
 │    ~/.claude/claude-ai/{session}.jsonl   │
 └──────────────────────────────────────────┘
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
manifest.json         — MV3 extension manifest
content-main.js       — fetch interceptor (world: MAIN)
content-isolated.js   — message relay (world: ISOLATED)
background.js         — service worker: correlation, tokenization, native messaging
tokenizer-src.js      — gpt-tokenizer wrapper (esbuild source)
tokenizer.js          — bundled tokenizer (esbuild output, committed)
host/
  host.py             — native messaging host (JSONL writer)
  host.bat            — Windows executable wrapper for host.py
  host.json           — native messaging host manifest (generated by setup.bat)
  setup.bat           — one-time setup: writes host.json + registry key
  setup_helper.py     — Python helper called by setup.bat
package.json          — npm: gpt-tokenizer + esbuild
```

---

## Phase 2 (not yet built)

Claude Designer (`claude.ai/design`) uses a completely different backend: **Connect RPC** with binary protobuf encoding (`OmeletteService/Chat`). There are no JSON events to intercept and no readable text in the response stream. Supporting it would require a protobuf decoder and knowledge of the `OmeletteService` schema. This is deferred to Phase 2.
