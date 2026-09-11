'use strict';

const $ = (sel) => document.querySelector(sel);

const PRESETS = [
  { status: 400, statusText: 'Bad Request', body: '{ "message": "Requisição inválida" }' },
  { status: 401, statusText: 'Unauthorized', body: '{ "message": "Sessão expirada" }' },
  { status: 403, statusText: 'Forbidden', body: '{ "message": "Sem permissão" }' },
  { status: 404, statusText: 'Not Found', body: '{ "message": "Não encontrado" }' },
  { status: 409, statusText: 'Conflict', body: '{ "message": "Conflito de versão" }' },
  { status: 422, statusText: 'Unprocessable Entity', body: '{ "errors": { "titulo": ["obrigatório"] } }' },
  { status: 429, statusText: 'Too Many Requests', body: '{ "message": "Muitas tentativas" }' },
  { status: 500, statusText: 'Internal Server Error', body: '{ "message": "Erro interno" }' },
  { status: 502, statusText: 'Bad Gateway', body: '' },
  { status: 503, statusText: 'Service Unavailable', body: '{ "message": "Em manutenção" }' },
  { status: 504, statusText: 'Gateway Timeout', body: '' },
  { status: 204, statusText: 'No Content', body: '' },
];

let rules = [];
let editingId = null;

// ------------------------------------------------------------------ estado

async function load() {
  const data = await chrome.storage.local.get(['enabled', 'rules']);
  rules = Array.isArray(data.rules) ? data.rules : [];
  setMaster(data.enabled === true);
  renderRules();
}

function save() {
  return chrome.storage.local.set({ rules });
}

function setMaster(on) {
  const btn = $('#master');
  btn.setAttribute('aria-checked', String(on));
  $('#masterLabel').textContent = on ? 'Ligado' : 'Desligado';
  $('#dot').classList.toggle('is-on', on);
}

$('#master').addEventListener('click', async () => {
  const on = $('#master').getAttribute('aria-checked') !== 'true';
  setMaster(on);
  await chrome.storage.local.set({ enabled: on });
});

// -------------------------------------------------------------- navegação

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => showView(tab.dataset.view));
});

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('is-active'));
  $('#view-' + name).classList.add('is-active');
  const activeTab = name === 'form' ? 'rules' : name;
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.view === activeTab);
  });
  if (name === 'logs') renderLogs();
}

// ---------------------------------------------------------- lista regras

function statusClass(rule) {
  if (rule.action === 'networkError') return 'x';
  if (rule.action === 'passthrough') return 'x';
  return String(rule.status || 500).charAt(0);
}

function statusLabel(rule) {
  if (rule.action === 'networkError') return 'ERR';
  if (rule.action === 'passthrough') return (rule.delayMs | 0) + 'ms';
  return String(rule.status || 500);
}

function renderRules() {
  const list = $('#ruleList');
  list.innerHTML = '';
  $('#ruleEmpty').hidden = rules.length > 0;
  list.hidden = rules.length === 0;

  rules.forEach((rule) => {
    const row = document.createElement('div');
    row.className = 'rule' + (rule.enabled ? '' : ' is-off');

    const code = document.createElement('span');
    code.className = 'code';
    code.dataset.class = statusClass(rule);
    code.textContent = statusLabel(rule);

    const main = document.createElement('div');
    main.className = 'rule-main';

    const name = document.createElement('div');
    name.className = 'rule-name';
    name.textContent = rule.name || 'Sem nome';

    const meta = document.createElement('div');
    meta.className = 'rule-meta';
    const extra = rule.action === 'mock' && rule.delayMs ? '  +' + rule.delayMs + 'ms' : '';
    meta.textContent = (rule.method || 'ANY') + '  ' + (rule.pattern || '') + extra;
    meta.title = rule.pattern || '';

    main.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'rule-actions';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = !!rule.enabled;
    toggle.title = 'Ativar esta regra';
    toggle.addEventListener('change', async () => {
      rule.enabled = toggle.checked;
      await save();
      renderRules();
    });

    const edit = document.createElement('button');
    edit.className = 'icon';
    edit.textContent = '✎';
    edit.title = 'Editar';
    edit.addEventListener('click', () => openForm(rule.id));

    const dup = document.createElement('button');
    dup.className = 'icon';
    dup.textContent = '⧉';
    dup.title = 'Duplicar';
    dup.addEventListener('click', async () => {
      rules.push({ ...rule, id: crypto.randomUUID(), name: rule.name + ' (cópia)' });
      await save();
      renderRules();
    });

    const del = document.createElement('button');
    del.className = 'icon icon-danger';
    del.textContent = '✕';
    del.title = 'Excluir';
    del.addEventListener('click', async () => {
      rules = rules.filter((r) => r.id !== rule.id);
      await save();
      renderRules();
    });

    actions.append(toggle, edit, dup, del);
    row.append(code, main, actions);
    list.append(row);
  });
}

// ---------------------------------------------------------------- editor

const F = {
  name: $('#f-name'),
  pattern: $('#f-pattern'),
  regex: $('#f-regex'),
  method: $('#f-method'),
  action: $('#f-action'),
  status: $('#f-status'),
  statusText: $('#f-statusText'),
  delay: $('#f-delay'),
  delayAlt: $('#f-delay-alt'),
  headers: $('#f-headers'),
  body: $('#f-body'),
};

function syncActionFields() {
  const isMock = F.action.value === 'mock';
  document.querySelectorAll('[data-when="mock"]').forEach((el) => (el.hidden = !isMock));
  document.querySelectorAll('[data-when="other"]').forEach((el) => (el.hidden = isMock));
}

F.action.addEventListener('change', syncActionFields);

function openForm(id) {
  editingId = id || null;
  const rule = rules.find((r) => r.id === id);

  F.name.value = rule ? rule.name : '';
  F.pattern.value = rule ? rule.pattern : '';
  F.regex.checked = rule ? !!rule.isRegex : false;
  F.method.value = rule ? rule.method || 'ANY' : 'ANY';
  F.action.value = rule ? rule.action || 'mock' : 'mock';
  F.status.value = rule ? rule.status || 500 : 500;
  F.statusText.value = rule ? rule.statusText || '' : '';
  F.delay.value = rule ? rule.delayMs || 0 : 0;
  F.delayAlt.value = rule ? rule.delayMs || 0 : 0;
  F.headers.value = rule ? rule.headersText || '' : '';
  F.body.value = rule ? rule.body || '' : '';

  syncActionFields();
  showView('form');
  F.name.focus();
}

$('#newRule').addEventListener('click', () => openForm(null));
$('#cancelRule').addEventListener('click', () => showView('rules'));

const chips = $('#presets');
PRESETS.forEach((p) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = p.status;
  chip.title = p.statusText;
  chip.addEventListener('click', () => {
    F.status.value = p.status;
    F.statusText.value = p.statusText;
    if (!F.body.value.trim()) F.body.value = p.body;
  });
  chips.append(chip);
});

function parseHeaders(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(':');
      if (i === -1) return null;
      return { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

$('#ruleForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();

  const action = F.action.value;
  const headersText = F.headers.value;

  const rule = {
    id: editingId || crypto.randomUUID(),
    enabled: true,
    name: F.name.value.trim() || 'Sem nome',
    pattern: F.pattern.value.trim(),
    isRegex: F.regex.checked,
    method: F.method.value,
    action,
    status: parseInt(F.status.value, 10) || 500,
    statusText: F.statusText.value.trim(),
    delayMs: parseInt(action === 'mock' ? F.delay.value : F.delayAlt.value, 10) || 0,
    headersText,
    headers: parseHeaders(headersText),
    body: F.body.value,
  };

  const existing = rules.findIndex((r) => r.id === rule.id);
  if (existing >= 0) rule.enabled = rules[existing].enabled;
  if (existing >= 0) rules[existing] = rule;
  else rules.push(rule);

  await save();
  renderRules();
  showView('rules');
});

// ------------------------------------------------------------------ logs

async function renderLogs() {
  const data = await chrome.storage.session.get('logs');
  const logs = Array.isArray(data.logs) ? data.logs : [];
  const list = $('#logList');

  list.innerHTML = '';
  $('#logEmpty').hidden = logs.length > 0;
  list.hidden = logs.length === 0;

  logs.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'log';

    const code = document.createElement('span');
    code.className = 'code';
    code.dataset.class = entry.status ? String(entry.status).charAt(0) : 'x';
    code.textContent = entry.status || (entry.outcome === 'network error' ? 'ERR' : '···');

    const url = document.createElement('span');
    url.className = 'log-url';
    url.textContent = entry.method + ' ' + entry.url;
    url.title = entry.url;

    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.ts).toLocaleTimeString('pt-BR', { hour12: false });

    row.append(code, url, time);
    list.append(row);
  });
}

$('#clearLogs').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'qa-clear-logs' });
  renderLogs();
});

load();
