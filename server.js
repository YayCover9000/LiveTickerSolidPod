import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  getSolidDataset,
  getContainedResourceUrlAll,
  getThingAll,
  getStringNoLocale,
  getUrl,
  getUrlAll,
} from '@inrupt/solid-client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const POD_URL = (process.env.POD_URL || '').replace(/\/$/, '');
const MESSAGES_CONTAINER = `${POD_URL}/ticker/messages/`;

app.use(cors());
app.use(express.json());

// Serve built frontend in production
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// --- SSE client registry ---
const clients = new Set();

// --- In-memory message store ---
const knownUrls = new Set();
let allMessages = [];

// --- SSE helpers ---
function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

// --- Solid Pod polling ---
async function fetchMessage(url) {
  const ds = await getSolidDataset(url);
  const things = getThingAll(ds);
  const msgThing = things.find((t) => t.url === `${url}#msg`);
  if (!msgThing) return null;

  const text = getStringNoLocale(msgThing, 'https://schema.org/text');
  const author = getUrl(msgThing, 'https://schema.org/author');
  const created = getStringNoLocale(msgThing, 'https://schema.org/dateCreated');
  const mentions = getUrlAll(msgThing, 'https://schema.org/mentions') || [];

  if (!text || !author) return null;
  return { id: url, text, author, created, mentions };
}

async function poll() {
  if (!POD_URL) {
    console.warn('[poll] POD_URL not set — copy .env to .env and configure it.');
    return;
  }

  try {
    const container = await getSolidDataset(MESSAGES_CONTAINER);
    const urls = getContainedResourceUrlAll(container).filter((u) => u.endsWith('.ttl'));
    const newUrls = urls.filter((u) => !knownUrls.has(u));

    if (newUrls.length === 0) return;

    const results = await Promise.allSettled(newUrls.map(fetchMessage));
    const newMessages = results
      .filter((r) => r.status === 'fulfilled' && r.value)
      .map((r) => r.value);

    for (const msg of newMessages) {
      knownUrls.add(msg.id);
      allMessages.push(msg);
    }

    allMessages.sort((a, b) => new Date(a.created) - new Date(b.created));

    if (newMessages.length > 0) {
      broadcast('messages', newMessages);
    }
  } catch (err) {
    if (err?.statusCode === 404 || err?.message?.includes('404')) {
      console.warn('[poll] Container not found — create it on your Pod:', MESSAGES_CONTAINER);
    } else {
      console.error('[poll]', err.message);
    }
  }
}

// Poll every 3 seconds
setInterval(poll, 3000);
poll();

// --- Routes ---

// SSE endpoint — clients connect here for real-time updates
app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send all current messages on connect
  res.write(`event: init\ndata: ${JSON.stringify(allMessages)}\n\n`);

  clients.add(res);
  req.on('close', () => clients.delete(res));
});

// Config endpoint — frontend reads podUrl from here
app.get('/api/config', (_req, res) => {
  res.json({ podUrl: POD_URL });
});

// SPA fallback — serve index.html for any unknown route
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
  console.log(`Polling Pod container: ${MESSAGES_CONTAINER || '(not configured)'}`);
});
