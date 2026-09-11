/**
 * Roda no contexto da página (world: MAIN), antes de qualquer script do app.
 * Substitui window.fetch e XMLHttpRequest para devolver respostas simuladas.
 */
(() => {
  'use strict';

  if (window.__QA_INTERCEPTOR__) return;
  window.__QA_INTERCEPTOR__ = true;

  const state = { enabled: false, rules: [] };
  const BODYLESS = new Set([204, 205, 304]);

  // ---------------------------------------------------------------- bridge

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const data = ev.data;
    if (!data || data.__qa !== 'rules') return;
    state.enabled = !!data.enabled;
    state.rules = Array.isArray(data.rules) ? data.rules : [];
  });

  function log(entry) {
    try {
      window.postMessage({ __qa: 'log', payload: { ...entry, ts: Date.now() } }, '*');
    } catch (_) {}
  }

  // ---------------------------------------------------------------- helpers

  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function absolute(url) {
    try {
      return new URL(String(url), document.baseURI).href;
    } catch (_) {
      return String(url);
    }
  }

  function findRule(url, method) {
    if (!state.enabled) return null;
    const verb = String(method || 'GET').toUpperCase();

    for (const rule of state.rules) {
      if (!rule || !rule.enabled) continue;

      const ruleVerb = String(rule.method || 'ANY').toUpperCase();
      if (ruleVerb !== 'ANY' && ruleVerb !== verb) continue;

      const pattern = rule.pattern || '';
      if (!pattern) continue;

      if (rule.isRegex) {
        try {
          if (new RegExp(pattern, 'i').test(url)) return rule;
        } catch (_) {}
        continue;
      }

      if (pattern.includes('*')) {
        try {
          const rx = new RegExp(pattern.split('*').map(escapeRx).join('.*'), 'i');
          if (rx.test(url)) return rule;
        } catch (_) {}
        continue;
      }

      if (url.toLowerCase().includes(pattern.toLowerCase())) return rule;
    }
    return null;
  }

  function safeStatus(value) {
    const n = parseInt(value, 10);
    return n >= 200 && n <= 599 ? n : 500;
  }

  function guessContentType(body) {
    const t = String(body || '').trim();
    return t.startsWith('{') || t.startsWith('[') ? 'application/json' : 'text/plain';
  }

  function buildHeaders(rule) {
    const headers = {};
    (rule.headers || []).forEach((h) => {
      if (h && h.name) headers[h.name] = h.value == null ? '' : String(h.value);
    });
    const hasType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
    if (!hasType) headers['Content-Type'] = guessContentType(rule.body);
    return headers;
  }

  // ---------------------------------------------------------------- fetch

  const nativeFetch = window.fetch;

  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      let url, method;
      try {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          url = input.url;
          method = (init && init.method) || input.method;
        } else {
          url = absolute(input);
          method = (init && init.method) || 'GET';
        }
      } catch (_) {
        return nativeFetch.apply(this, arguments);
      }

      const rule = findRule(url, method);
      if (!rule) return nativeFetch.apply(this, arguments);

      const ctx = this;
      const args = arguments;

      return sleep(rule.delayMs | 0).then(() => {
        if (rule.action === 'passthrough') {
          log({ url, method, rule: rule.name, outcome: 'delay ' + (rule.delayMs | 0) + 'ms', kind: 'fetch' });
          return nativeFetch.apply(ctx, args);
        }

        if (rule.action === 'networkError') {
          log({ url, method, rule: rule.name, outcome: 'network error', kind: 'fetch' });
          throw new TypeError('Failed to fetch');
        }

        const status = safeStatus(rule.status);
        const body = BODYLESS.has(status) ? null : rule.body == null ? '' : String(rule.body);
        const response = new Response(body, {
          status,
          statusText: rule.statusText || '',
          headers: buildHeaders(rule),
        });

        try {
          Object.defineProperty(response, 'url', { value: url, configurable: true });
        } catch (_) {}

        log({ url, method, rule: rule.name, outcome: String(status), status, kind: 'fetch' });
        return response;
      });
    };

    try {
      window.fetch.toString = () => 'function fetch() { [native code] }';
    } catch (_) {}
  }

  // ---------------------------------------------------------------- XHR

  const XHR = window.XMLHttpRequest;

  if (typeof XHR === 'function' && XHR.prototype) {
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;
    const nativeSetHeader = XHR.prototype.setRequestHeader;

    const define = (obj, props) => {
      Object.keys(props).forEach((key) => {
        try {
          Object.defineProperty(obj, key, { configurable: true, writable: true, value: props[key] });
        } catch (_) {}
      });
    };

    const fire = (xhr, type, EventCtor) => {
      try {
        xhr.dispatchEvent(new (EventCtor || Event)(type));
      } catch (_) {}
    };

    function decodeBody(responseType, text) {
      try {
        if (responseType === 'json') return text ? JSON.parse(text) : null;
        if (responseType === 'blob') return new Blob([text]);
        if (responseType === 'arraybuffer') return new TextEncoder().encode(text).buffer;
        if (responseType === 'document') return new DOMParser().parseFromString(text, 'text/html');
      } catch (_) {
        return null;
      }
      return text;
    }

    XHR.prototype.open = function (method, url) {
      this.__qa = { method: String(method || 'GET').toUpperCase(), url: absolute(url) };
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.setRequestHeader = function () {
      try {
        return nativeSetHeader.apply(this, arguments);
      } catch (_) {}
    };

    XHR.prototype.send = function () {
      const meta = this.__qa;
      const rule = meta ? findRule(meta.url, meta.method) : null;

      if (!rule) return nativeSend.apply(this, arguments);
      if (rule.action === 'passthrough' && !(rule.delayMs | 0)) return nativeSend.apply(this, arguments);

      const xhr = this;
      const args = arguments;

      setTimeout(() => {
        if (rule.action === 'passthrough') {
          log({ url: meta.url, method: meta.method, rule: rule.name, outcome: 'delay ' + (rule.delayMs | 0) + 'ms', kind: 'xhr' });
          try {
            nativeSend.apply(xhr, args);
          } catch (_) {}
          return;
        }

        if (rule.action === 'networkError') {
          define(xhr, {
            readyState: 4,
            status: 0,
            statusText: '',
            responseURL: meta.url,
            responseText: '',
            response: '',
            getAllResponseHeaders: () => '',
            getResponseHeader: () => null,
          });
          log({ url: meta.url, method: meta.method, rule: rule.name, outcome: 'network error', kind: 'xhr' });
          fire(xhr, 'readystatechange');
          fire(xhr, 'error', ProgressEvent);
          fire(xhr, 'loadend', ProgressEvent);
          return;
        }

        const status = safeStatus(rule.status);
        const text = BODYLESS.has(status) ? '' : rule.body == null ? '' : String(rule.body);
        const headers = buildHeaders(rule);
        const type = xhr.responseType || '';

        define(xhr, {
          readyState: 4,
          status,
          statusText: rule.statusText || '',
          responseURL: meta.url,
          responseText: type === '' || type === 'text' ? text : '',
          response: decodeBody(type, text),
          getAllResponseHeaders: () =>
            Object.keys(headers)
              .map((k) => k.toLowerCase() + ': ' + headers[k])
              .join('\r\n') + '\r\n',
          getResponseHeader: (name) => {
            const key = Object.keys(headers).find((k) => k.toLowerCase() === String(name).toLowerCase());
            return key ? headers[key] : null;
          },
        });

        log({ url: meta.url, method: meta.method, rule: rule.name, outcome: String(status), status, kind: 'xhr' });
        fire(xhr, 'readystatechange');
        fire(xhr, 'load', ProgressEvent);
        fire(xhr, 'loadend', ProgressEvent);
      }, rule.delayMs | 0);
    };
  }
})();
