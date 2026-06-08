import { countTokens } from './tokenizer-src.js';

const HOST_NAME = 'com.anthropic.claudeai_tc';

// Guards against duplicate assembly when claude.ai fires multiple
// CONVERSATION_FETCHED events for the same turn.
const assembling = new Set();

// ── Message routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  const tabId = sender?.tab?.id;
  if (message.type === 'TURN_SSE_DONE') {
    console.log('[claude-tc] TURN_SSE_DONE', message.convId, 'outputLen:', message.outputText?.length);
    handleSseDone(message, tabId);
  } else if (message.type === 'CONVERSATION_FETCHED') {
    console.log('[claude-tc] CONVERSATION_FETCHED', message.convId, 'msgs:', message.chatMessages?.length);
    handleConversationFetched(message, tabId);
  } else if (message.type === 'MESSAGE_LIMIT') {
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, {
        type: 'MESSAGE_LIMIT',
        messageLimit: message.messageLimit,
      }).catch(() => {});
    }
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSseDone(data, tabId) {
  const key   = stateKey(data.convId);
  const state = (await sessionGet(key)) ?? {};
  state.sseData = data;
  if (tabId != null) state.tabId = tabId;
  await sessionSet(key, state);
  if (state.convData) await assembleTurn(data.convId, state);
}

async function handleConversationFetched(data, tabId) {
  const key   = stateKey(data.convId);
  const state = (await sessionGet(key)) ?? {};
  state.convData = data;
  if (tabId != null) state.tabId = tabId;
  await sessionSet(key, state);
  if (state.sseData) await assembleTurn(data.convId, state);
}

// ── Turn assembly ─────────────────────────────────────────────────────────────

async function assembleTurn(convId, { sseData, convData, tabId }) {
  if (assembling.has(convId)) return;
  assembling.add(convId);
  try {
    await _assembleTurn(convId, { sseData, convData, tabId });
  } finally {
    assembling.delete(convId);
  }
}

async function _assembleTurn(convId, { sseData, convData, tabId }) {
  const {
    model, parentMessageUuid, outputText, timestamp,
  } = sseData;
  const { convName, chatMessages } = convData;

  const parentIdx = chatMessages.findIndex(m => m.uuid === parentMessageUuid);
  const inputMessages = parentIdx >= 0
    ? chatMessages.slice(0, parentIdx + 1)
    : [];

  const inputText = inputMessages
    .flatMap(m => (m.content ?? []).map(c => c.text ?? ''))
    .join('\n');

  const record = {
    type:       'assistant',
    timestamp,
    source:     'claude.ai',
    project:    convName,
    session_id: convId,
    message: {
      model: model || convData.model,
      usage: {
        input_tokens:                countTokens(inputText),
        output_tokens:               countTokens(outputText),
        cache_creation_input_tokens: 0,
        cache_read_input_tokens:     0,
      },
    },
  };

  console.log('[claude-tc] assembled record — input_tokens:', record.message.usage.input_tokens, 'output_tokens:', record.message.usage.output_tokens);
  try {
    const resp = await sendToHost(record);
    console.log('[claude-tc] host response:', resp);
    if (tabId != null) {
      chrome.tabs.sendMessage(tabId, {
        type:         'TURN_COUNTED',
        convId,
        convName,
        model:        record.message.model,
        usage:        record.message.usage,
        windowTokens: resp?.window_tokens ?? null,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[claude-tc] native host error:', err);
  }

  await chrome.storage.session.remove(stateKey(convId));
}

// ── Native messaging ──────────────────────────────────────────────────────────

function sendToHost(record) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connectNative(HOST_NAME);

    port.onMessage.addListener((response) => {
      port.disconnect();
      resolve(response);
    });

    port.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError;
      if (err) reject(err.message);
      else resolve();
    });

    port.postMessage(record);
  });
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function stateKey(convId) {
  return `tc_${convId}`;
}

async function sessionGet(key) {
  const result = await chrome.storage.session.get(key);
  return result[key];
}

async function sessionSet(key, value) {
  await chrome.storage.session.set({ [key]: value });
}
