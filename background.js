/**
 * Service worker: mantém o badge sincronizado e guarda os últimos interceptos.
 */
const MAX_LOGS = 120;

async function refreshBadge() {
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.action.setBadgeBackgroundColor({ color: enabled ? '#C4622D' : '#3A4450' });
  await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
}

chrome.runtime.onInstalled.addListener(refreshBadge);
chrome.runtime.onStartup.addListener(refreshBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enabled) refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'qa-log') {
    const entry = { ...msg.entry, tabId: sender.tab ? sender.tab.id : null };
    chrome.storage.session.get('logs', (data) => {
      const logs = Array.isArray(data.logs) ? data.logs : [];
      logs.unshift(entry);
      chrome.storage.session.set({ logs: logs.slice(0, MAX_LOGS) });
    });
    return false;
  }

  if (msg && msg.type === 'qa-clear-logs') {
    chrome.storage.session.set({ logs: [] }, () => sendResponse({ ok: true }));
    return true;
  }

  return false;
});
