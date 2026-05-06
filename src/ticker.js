import { initAuth, solidLogin, solidLogout, getSession } from './auth.js';
import { saveMessage } from './pod.js';

// ── State ────────────────────────────────────────────────────────────────────
let podUrl = '';
let currentFilter = 'all';        // 'all' or a WebID string
let allMessages = [];             // sorted by created
let unreadMentions = [];          // messages where current user is mentioned
let knownWebIds = new Map();      // WebID → username
let currentUserWebId = null;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const loginScreen    = $('login-screen');
const tickerScreen   = $('ticker-screen');
const oidcInput      = $('oidc-issuer');
const loginBtn       = $('login-btn');
const logoutBtn      = $('logout-btn');
const userNameEl     = $('user-name');
const messagesEl     = $('messages');
const form           = $('message-form');
const input          = $('message-input');
const mentionDrop    = $('mention-dropdown');
const notifBtn       = $('notif-btn');
const notifPanel     = $('notif-panel');
const notifClose     = $('notif-close');
const notifList      = $('notif-list');
const notifCount     = $('notif-count');
const collectionList = $('collections-list');
const tickerTitle    = $('ticker-title');

// ── Helpers ──────────────────────────────────────────────────────────────────

function webIdToUsername(webId) {
  try {
    return new URL(webId).hostname.split('.')[0];
  } catch {
    return webId;
  }
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'gerade eben';
  if (mins < 60) return `vor ${mins} Min.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  return `vor ${Math.floor(hours / 24)} Tag(en)`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Wrap @mentions in spans; highlight if current user is mentioned. */
function formatText(text, mentions) {
  return escapeHtml(text).replace(/@(\S+)/g, (match, username) => {
    const entry = [...knownWebIds.entries()].find(([, u]) => u === username);
    const isSelf = entry && entry[0] === currentUserWebId;
    return `<span class="mention${isSelf ? ' self' : ''}">${escapeHtml(match)}</span>`;
  });
}

function registerWebId(webId) {
  if (!knownWebIds.has(webId)) {
    knownWebIds.set(webId, webIdToUsername(webId));
    renderCollectionEntry(webId);
  }
}

// ── Collections (sidebar) ────────────────────────────────────────────────────

function renderCollectionEntry(webId) {
  const username = knownWebIds.get(webId);
  const li = document.createElement('li');
  li.className = 'collection';
  li.dataset.filter = webId;
  li.innerHTML = `<span class="collection-icon">👤</span> @${username}`;
  li.addEventListener('click', () => activateFilter(webId, li));
  collectionList.appendChild(li);
}

function activateFilter(filter, el) {
  currentFilter = filter;
  document.querySelectorAll('.collection').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  tickerTitle.textContent =
    filter === 'all' ? 'Alle Nachrichten' : `@${knownWebIds.get(filter) || filter}`;
  renderMessages();
}

// ── Message rendering ────────────────────────────────────────────────────────

function renderMessages() {
  const filtered =
    currentFilter === 'all'
      ? allMessages
      : allMessages.filter(
          (m) => m.author === currentFilter || m.mentions.includes(currentFilter),
        );

  if (filtered.length === 0) {
    messagesEl.innerHTML = '<div class="empty-state">Noch keine Nachrichten.</div>';
    return;
  }

  messagesEl.innerHTML = filtered.map(renderMessage).join('');
}

function renderMessage(msg) {
  const username = knownWebIds.get(msg.author) || webIdToUsername(msg.author);
  const isMine = msg.author === currentUserWebId;
  const mentionsMe = msg.mentions.includes(currentUserWebId);

  return `
    <div class="message${isMine ? ' mine' : ''}${mentionsMe ? ' mention-highlight' : ''}">
      <div class="message-meta">
        <span class="msg-author">${escapeHtml(username)}</span>
        <span class="msg-time">${timeAgo(msg.created)}</span>
      </div>
      <div class="message-body">${formatText(msg.text, msg.mentions)}</div>
    </div>
  `.trim();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Ingesting messages ───────────────────────────────────────────────────────

function addMessages(msgs) {
  let changed = false;

  for (const msg of msgs) {
    if (allMessages.some((m) => m.id === msg.id)) continue;

    registerWebId(msg.author);
    allMessages.push(msg);
    changed = true;

    // Notification if current user is mentioned by someone else
    if (
      currentUserWebId &&
      msg.author !== currentUserWebId &&
      msg.mentions.includes(currentUserWebId)
    ) {
      unreadMentions.push(msg);
      updateNotifBadge();
    }
  }

  if (!changed) return;

  allMessages.sort((a, b) => new Date(a.created) - new Date(b.created));
  renderMessages();
  scrollToBottom();
}

// ── Notifications ─────────────────────────────────────────────────────────────

function updateNotifBadge() {
  const n = unreadMentions.length;
  notifCount.textContent = n;
  notifCount.classList.toggle('hidden', n === 0);
}

function renderNotifications() {
  if (unreadMentions.length === 0) {
    notifList.innerHTML = '<li class="notif-empty">Keine neuen Erwähnungen.</li>';
    return;
  }
  notifList.innerHTML = unreadMentions
    .map((msg) => {
      const user = knownWebIds.get(msg.author) || webIdToUsername(msg.author);
      return `<li class="notif-item">
        <strong>${escapeHtml(user)}</strong>: ${escapeHtml(msg.text)}
      </li>`;
    })
    .join('');
}

// ── @Mention autocomplete ─────────────────────────────────────────────────────

function showMentionDropdown(query) {
  const currentUsername = currentUserWebId ? webIdToUsername(currentUserWebId) : null;
  const matches = [...knownWebIds.entries()]
    .filter(([, u]) => u.startsWith(query) && u !== currentUsername)
    .slice(0, 6);

  if (matches.length === 0) {
    mentionDrop.classList.add('hidden');
    return;
  }

  mentionDrop.innerHTML = matches
    .map(
      ([webId, u]) =>
        `<div class="mention-item" data-webid="${webId}" data-username="${u}">@${u}</div>`,
    )
    .join('');
  mentionDrop.classList.remove('hidden');

  mentionDrop.querySelectorAll('.mention-item').forEach((item) => {
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertMention(item.dataset.username);
    });
  });
}

function insertMention(username) {
  const val = input.value;
  const atIdx = val.lastIndexOf('@');
  input.value = val.slice(0, atIdx) + `@${username} `;
  mentionDrop.classList.add('hidden');
  input.focus();
}

function extractMentions(text) {
  const matches = text.match(/@(\S+)/g) || [];
  return matches.flatMap((m) => {
    const username = m.slice(1);
    const entry = [...knownWebIds.entries()].find(([, u]) => u === username);
    return entry ? [entry[0]] : [];
  });
}

// ── SSE connection ────────────────────────────────────────────────────────────

function connectSSE() {
  const es = new EventSource('/events');

  es.addEventListener('init', (e) => {
    addMessages(JSON.parse(e.data));
  });

  es.addEventListener('messages', (e) => {
    addMessages(JSON.parse(e.data));
  });

  es.onerror = () => {
    console.warn('[SSE] Connection lost — reconnecting in 5 s…');
    es.close();
    setTimeout(connectSSE, 5000);
  };
}

// ── Event listeners ───────────────────────────────────────────────────────────

loginBtn.addEventListener('click', async () => {
  const issuer = oidcInput.value.trim();
  if (!issuer) return;
  loginBtn.disabled = true;
  loginBtn.textContent = 'Weiterleitung…';
  try {
    await solidLogin(issuer);
  } catch {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Mit Solid anmelden';
  }
});

logoutBtn.addEventListener('click', async () => {
  await solidLogout();
  location.href = '/';
});

notifBtn.addEventListener('click', () => {
  const isOpen = !notifPanel.classList.contains('hidden');
  if (isOpen) {
    notifPanel.classList.add('hidden');
  } else {
    renderNotifications();
    notifPanel.classList.remove('hidden');
    unreadMentions = [];
    updateNotifBadge();
  }
});

notifClose.addEventListener('click', () => {
  notifPanel.classList.add('hidden');
});

// Close notification panel on outside click
document.addEventListener('click', (e) => {
  if (!notifPanel.contains(e.target) && e.target !== notifBtn) {
    notifPanel.classList.add('hidden');
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  const session = getSession();
  if (!session.info.isLoggedIn) {
    alert('Bitte erst anmelden.');
    return;
  }
  if (!podUrl) {
    alert('POD_URL ist nicht konfiguriert (siehe .env).');
    return;
  }

  const mentions = extractMentions(text);
  input.value = '';
  input.disabled = true;

  try {
    await saveMessage({
      podUrl,
      text,
      authorWebId: currentUserWebId,
      mentions,
      fetchFn: session.fetch,
    });
  } catch (err) {
    console.error('[send]', err);
    alert(
      'Nachricht konnte nicht gespeichert werden.\n' +
        'Prüfe die ACL-Berechtigungen des Containers /ticker/messages/ auf deinem Pod.',
    );
    input.value = text; // restore on failure
  } finally {
    input.disabled = false;
    input.focus();
  }
});

input.addEventListener('input', () => {
  const val = input.value;
  const atIdx = val.lastIndexOf('@');
  if (atIdx !== -1) {
    const query = val.slice(atIdx + 1);
    if (!query.includes(' ')) {
      showMentionDropdown(query);
      return;
    }
  }
  mentionDrop.classList.add('hidden');
});

input.addEventListener('blur', () => {
  setTimeout(() => mentionDrop.classList.add('hidden'), 150);
});

// "All messages" collection item
collectionList.querySelector('[data-filter="all"]').addEventListener('click', function () {
  activateFilter('all', this);
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function init() {
  // Fetch pod URL from backend config
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    podUrl = cfg.podUrl || '';
  } catch {
    console.warn('Could not reach backend — is server.js running?');
  }

  const session = await initAuth();

  if (session.info.isLoggedIn) {
    currentUserWebId = session.info.webId;
    registerWebId(currentUserWebId);
    userNameEl.textContent = `@${webIdToUsername(currentUserWebId)}`;

    loginScreen.classList.add('hidden');
    tickerScreen.classList.remove('hidden');

    connectSSE();
  } else {
    loginScreen.classList.remove('hidden');
    tickerScreen.classList.add('hidden');
  }
}

init();
