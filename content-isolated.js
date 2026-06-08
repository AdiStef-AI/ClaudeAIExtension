// Relay __claudeTC postMessages from the MAIN world to the background service worker.
// This script runs in the ISOLATED world and is the only side that has chrome.runtime access.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data?.__claudeTC) return;
  chrome.runtime.sendMessage(event.data).catch(() => {});
});
