import { countTokens } from './tokenizer.js';

const HOST_NAME = 'com.anthropic.claudeai_tc';

// ── Message routing ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'TURN_SSE_DONE') {
    handleSseDone(message);
  } else if (message.type === 'CONVERSATION_FETCHED') {
    handleConversationFetched(message);
  }
});

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSseDone(data) {
  const key   = stateKey(data.convId);
  const state = (await sessionGet(key)) ?? {};
  state.sseData = data;
  await sessionSet(key, state);
  if (state.convData) await assembleTurn(data.convId, state);
}

async function handleConversationFetched(data) {
  const key   = stateKey(data.convId);
  const state = (await sessionGet(key)) ?? {};
  state.convData = data;
  await sessionSet(key, state);
  if (state.sseData) await assembleTurn(data.convId, state);
}

// ── Turn assembly ─────────────────────────────────────────────────────────────

async function assembleTurn(convId, { sseData, convData }) {
  const {
    model, parentMessageUuid, promptText, outputText, timestamp,
  } = sseData;
  const { convName, chatMessages } = convData;

  // Input context = all messages up to and including the human message that
  // triggered this turn. parentMessageUuid identifies that human message.
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

  try {
    await sendToHost(record);
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
