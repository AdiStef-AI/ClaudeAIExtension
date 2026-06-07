# claude.ai Token Tracker

A Chrome extension that captures per-turn token usage from **claude.ai** browser sessions and writes it to disk in the same format as Claude Code CLI transcripts — so your token counter sees everything in one place.

---

## The problem

The [`tc` TokenCounter CLI](https://github.com/AdiStef-AI/TokenCounter) tracks Claude usage by reading session transcripts written by the **Claude Code CLI**. Sessions on **claude.ai** (the browser chat) are never written to disk, so they are completely invisible to `tc`.

This extension closes that gap.

---

## How it works

```
claude.ai tab
  └─ content-main.js      patches window.fetch, taps SSE stream + conversation JSON
  └─ content-isolated.js  relays events to the background service worker
  └─ content-overlay.js   floating token counter widget injected into the page

background.js (service worker)
  └─ correlates SSE output + conversation history
  └─ estimates token counts with gpt-tokenizer (cl100k_base)
  └─ sends a turn record to the native host via Chrome Native Messaging
  └─ notifies the overlay with live per-turn counts

host/host.py
  └─ appends JSONL records to ~/.claude/claude-ai/<session-uuid>.jsonl
```

Each completed assistant turn produces one record:

```json
{
  "type": "assistant",
  "timestamp": "2026-06-07T10:00:00.000Z",
  "source": "claude.ai",
  "project": "My conversation title",
  "session_id": "a52c768f-30b7-4596-b0f0-4556f0a64d84",
  "message": {
    "model": "claude-sonnet-4-6",
    "usage": {
      "input_tokens": 2572,
      "output_tokens": 324,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 0
    }
  }
}
```

---

## Prerequisites

- Chrome 111 or later
- Node.js (to build the bundles — one-time)
- Python 3.8 or later (runs the native host companion)
- Git

---

## In-page token counter

A small widget is injected into every `claude.ai/chat/...` page. It sits in the bottom-right corner and updates automatically after each completed turn.

- **Collapsed view** — a pill badge showing session input (blue) and output (green) token totals
- **Expanded view** — hover to see the conversation name, model, last-turn counts, and running conversation totals
- Totals reset automatically when you switch to a different conversation
- The widget only updates after a turn is successfully written to disk — it is always in sync with the JSONL files

---

## Quick install (new machine)

Clone the repo anywhere, then run the check/install script:

```powershell
git clone https://github.com/AdiStef-AI/ClaudeAIExtension.git
powershell -ExecutionPolicy Bypass -File ClaudeAIExtension\check-install.ps1
```

The script checks prerequisites, builds the extension, and prints step-by-step instructions for the two manual steps that Chrome requires:
1. Loading the unpacked extension via `chrome://extensions`
2. Running `host\setup.py` with the Extension ID to register the native host

Run `check-install.ps1` at any time to verify the installation is up to date.

---

## Token count accuracy

| Field | Accuracy | Notes |
|---|---|---|
| `model` | Exact | From the completion request body |
| `output_tokens` | ~95% | All streamed SSE text deltas, tokenized with cl100k_base |
| `input_tokens` | ~90% | Full conversation history tokenized; excludes the hidden server-side system prompt |
| `session_id` | Exact | UUID from the claude.ai URL |
| `project` | Exact | Conversation title from the claude.ai API |

---

## Known limitations

- **claude.ai/chat only** — Claude Designer (`claude.ai/design`) uses a binary protobuf API and is not supported yet.
- **System prompt excluded** — claude.ai injects a server-side system prompt that is not visible to the extension. Input tokens will be slightly underestimated.
- **Navigate-away loss** — Closing a tab immediately after sending a message may miss that turn.

---

## Full documentation

See [Manual.md](Manual.md) for the complete setup guide, architecture details, and troubleshooting steps.
