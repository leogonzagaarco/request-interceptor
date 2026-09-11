/**
 * Content script isolado. Faz a ponte entre chrome.storage e o interceptor
 * que roda no contexto da página.
 */
(() => {
  'use strict';

  function push() {
    chrome.storage.local.get(['enabled', 'rules'], (data) => {
      if (chrome.runtime.lastError) return;
      window.postMessage(
        {
          __qa: 'rules',
          enabled: data.enabled === true,
          rules: Array.isArray(data.rules) ? data.rules : [],
        },
        '*'
      );
    });
  }

  push();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.rules || changes.enabled)) push();
  });

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.__qa !== 'log') return;
    try {
      chrome.runtime.sendMessage({ type: 'qa-log', entry: data.payload }, () => void chrome.runtime.lastError);
    } catch (_) {}
  });
})();
