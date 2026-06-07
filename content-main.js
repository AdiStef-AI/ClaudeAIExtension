(function patchFetch() {
  console.log('[claude-tc] content-main.js injected');
  // Matches: /api/organizations/{orgId}/chat_conversations/{convId}/completion
  const COMPLETION_RE = /\/api\/organizations\/([^/?]+)\/chat_conversations\/([^/?]+)\/completion$/;

  // Matches: /api/organizations/{orgId}/chat_conversations/{convId}?...consistency=strong...
  // Only the strong-consistency fetch carries the fully-updated conversation after a turn.
  const CONVERSATION_RE = /\/api\/organizations\/([^/?]+)\/chat_conversations\/([^/?]+)\?[^#]*consistency=strong/;

  const _fetch = window.fetch.bind(window);

  window.fetch = async function claudeTCFetch(input, init = {}) {
    const url =
      input instanceof Request ? input.url :
      input instanceof URL     ? input.href :
      String(input);

    const method = (
      init.method ||
      (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();

    const cm = url.match(COMPLETION_RE);
    if (cm && method === 'POST') {
      const [, orgId, convId] = cm;
      return interceptCompletion(input, init, orgId, convId);
    }

    const vm = url.match(CONVERSATION_RE);
    if (vm && method === 'GET') {
      const [, , convId] = vm;
      return interceptConversation(input, init, convId);
    }

    return _fetch(input, init);
  };

  // ── Completion POST ──────────────────────────────────────────────────────────

  async function interceptCompletion(input, init, orgId, convId) {
    // Extract model, parent UUID, and prompt text from the request body.
    let model = '';
    let parentMessageUuid = '';
    let promptText = '';
    try {
      if (typeof init.body === 'string') {
        const b = JSON.parse(init.body);
        model             = b.model               ?? '';
        parentMessageUuid = b.parent_message_uuid ?? '';
        promptText        = b.prompt              ?? '';
      } else if (input instanceof Request) {
        const b = await input.clone().json();
        model             = b.model               ?? '';
        parentMessageUuid = b.parent_message_uuid ?? '';
        promptText        = b.prompt              ?? '';
      }
    } catch (_) {}

    const timestamp = new Date().toISOString();
    const response = await _fetch(input, init);

    if (!response.body) return response;

    const [pageStream, tapStream] = response.body.tee();
    consumeSSE(tapStream, { orgId, convId, model, parentMessageUuid, promptText, timestamp });

    return new Response(pageStream, {
      status:     response.status,
      statusText: response.statusText,
      headers:    response.headers,
    });
  }

  async function consumeSSE(stream, ctx) {
    const reader  = stream.getReader();
    const decoder = new TextDecoder();
    let outputText = '';
    let buffer     = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process line-by-line; SSE events are newline-delimited.
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trimEnd();
          buffer = buffer.slice(nl + 1);

          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));

            if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
              outputText += ev.delta.text ?? '';
            }

            if (ev.type === 'message_stop') {
              window.postMessage(
                { __claudeTC: true, type: 'TURN_SSE_DONE', ...ctx, outputText },
                '*'
              );
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // ── Conversation GET ─────────────────────────────────────────────────────────

  async function interceptConversation(input, init, convId) {
    const response = await _fetch(input, init);

    if (!response.body) return response;

    const [pageStream, tapStream] = response.body.tee();
    consumeConversation(tapStream, convId);

    return new Response(pageStream, {
      status:     response.status,
      statusText: response.statusText,
      headers:    response.headers,
    });
  }

  async function consumeConversation(stream, convId) {
    const reader  = stream.getReader();
    const decoder = new TextDecoder();
    let body = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        body += decoder.decode(value, { stream: true });
      }
      const data = JSON.parse(body);
      window.postMessage({
        __claudeTC:   true,
        type:         'CONVERSATION_FETCHED',
        convId,
        convName:     data.name          ?? '',
        model:        data.model         ?? '',
        chatMessages: data.chat_messages ?? [],
      }, '*');
    } catch (_) {}
  }
})();
