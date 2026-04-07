const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
const twilio = require('twilio');
const { initCheckins, runCheckin } = require('./checkin');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const twilioClient = (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN)
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const LCARS_SYSTEM = `You are LCARS — Library Computer Access and Retrieval System for Luis Espinosa (LRE).
Video Engineer & Creative Director, Coral Springs FL. Frost Florida. Office at 701 Boutwell.
Kids school drop-off 7:15am weekdays. Night owl, 24hr gym Mon/Wed/Fri post-10pm.
Building: Pi + Stream Deck + Claude control system. Uses Monday.com for work.
Gigs: MPM Bioimpact 2026 (Apr 6, 1 Hotel South Beach), Selfless Love Gala (Apr 10, Mar-a-Lago).
Meeting Thomas Thu Apr 9 1pm — Systems & SOPs.
Style: Concise, Starfleet computer. Use Acknowledged/Processing/Confirmed/Standby. Max 3-4 sentences. Lists use ▸. Command interface not chat.`;

app.get('/', (req, res) => res.json({ status: 'LCARS API v2.1 ONLINE' }));
app.get('/health', (req, res) => res.json({ status: 'nominal', ts: new Date().toISOString() }));

const conversations = new Map();

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default', context = '' } = req.body;
    if (!conversations.has(sessionId)) conversations.set(sessionId, []);
    const history = conversations.get(sessionId);
    history.push({ role: 'user', content: message });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 300,
      system: LCARS_SYSTEM + (context ? `\nContext: ${context}` : ''),
      messages: history.slice(-10)
    });
    const response = msg.content[0].text;
    history.push({ role: 'assistant', content: response });
    res.json({ response, tokens: msg.usage.output_tokens, turns: Math.floor(history.length / 2) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/chat/clear', (req, res) => {
  conversations.delete(req.body.sessionId || 'default');
  res.json({ status: 'cleared' });
});

app.get('/api/briefing', async (req, res) => {
  try {
    const now = new Date();
    const h = now.getHours();
    const tod = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
    const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 200, system: LCARS_SYSTEM,
      messages: [{ role: 'user', content: `${tod} briefing for Luis. Today: ${day}. 3 bullet points, ▸ prefix, LCARS style, actionable.` }]
    });
    res.json({ briefing: msg.content[0].text, timestamp: now.toISOString(), tod });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Multi-calendar — accepts multiple ?url= params
app.get('/api/calendar', async (req, res) => {
  let urls = req.query.url;
  if (!urls) return res.json({ events: [], note: 'Add ?url=ICAL_URL' });
  if (!Array.isArray(urls)) urls = [urls];
  const CAL_NAMES = ['Frost Work','Frost Shows','Personal','Shared','School','Family'];

  try {
    const results = await Promise.allSettled(
      urls.map(async (url, i) => {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const text = await r.text();
        return parseICal(text).map(e => ({ ...e, calIdx: i, calName: CAL_NAMES[i] || `Calendar ${i+1}` }));
      })
    );
    let all = [];
    results.forEach(r => { if (r.status === 'fulfilled') all = all.concat(r.value); });
    all.sort((a, b) => new Date(a.start) - new Date(b.start));
    res.json({ events: all.slice(0, 50), count: all.length, calendars: urls.length, fetched: results.filter(r => r.status === 'fulfilled').length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

function parseICal(text) {
  const events = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  // Unfold
  const unfolded = [];
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else { unfolded.push(line); }
  }
  let ev = null;
  const now = new Date();
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (line === 'END:VEVENT') {
      if (ev && ev.start && new Date(ev.end || ev.start) >= now) events.push(ev);
      ev = null; continue;
    }
    if (!ev) continue;
    const ci = line.indexOf(':');
    if (ci === -1) continue;
    const rawKey = line.slice(0, ci);
    const val = line.slice(ci + 1).replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';');
    const key = rawKey.split(';')[0].trim().toUpperCase();
    if (key === 'SUMMARY') ev.title = val.trim();
    else if (key === 'DTSTART') ev.start = parseDate(val.trim());
    else if (key === 'DTEND') ev.end = parseDate(val.trim());
    else if (key === 'LOCATION') ev.location = val.trim().slice(0, 100);
    else if (key === 'DESCRIPTION') ev.description = val.trim().slice(0, 150);
    else if (key === 'UID') ev.uid = val.trim();
    else if (key === 'RRULE') ev.recurring = true;
  }
  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

function parseDate(s) {
  if (!s) return null;
  s = s.replace('Z', '').trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T00:00:00`;
  if (/^\d{8}T\d{6}/.test(s)) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:00`;
  return s;
}

// ── PERSISTENT STORE (survives server restarts) ──────────────────
const fs = require('fs');
const STORE_PATH = process.env.STORE_PATH || '/tmp/lcars-store.json';

const DEFAULT_STORE = {
  nuggets: [
    { text: 'LCARS as main personal OS', date: '2026-04-04', source: 'session', id: 1 },
    { text: 'Stream Deck as Claude command surface', date: '2026-04-04', source: 'session', id: 2 },
    { text: 'Pi as always-on control brain', date: '2026-04-04', source: 'session', id: 3 },
    { text: 'Mac mini as full-time home AI server', date: '2026-04-05', source: 'claude-chat', id: 4 },
    { text: 'Twilio SMS bridge to Claude + LCARS', date: '2026-04-05', source: 'session', id: 5 },
  ],
  tasks: [],
  events: [],
};

function loadStore() {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
      console.log(`✅ Store loaded from disk: ${data.nuggets?.length || 0} nuggets, ${data.tasks?.length || 0} tasks`);
      return data;
    }
  } catch(e) { console.log('⚠️ Store load failed, using defaults:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULT_STORE));
}

function saveStore() {
  try { fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2)); }
  catch(e) { console.error('⚠️ Store save failed:', e.message); }
}

const store = loadStore();

// ── SCHEDULED CHECK-INS ──────────────────────────────────────────
initCheckins(store, twilioClient, saveStore);

// Manual trigger: GET /api/checkin/:type (morning|afternoon|evening|weekly)
app.get('/api/checkin/:type', async (req, res) => {
  try {
    const briefing = await runCheckin(req.params.type, store, twilioClient, saveStore);
    res.json({ success: true, type: req.params.type, subject: briefing.subject, text: briefing.text });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── SMS CONVERSATION MEMORY ───────────────────────────────────────
const smsConversations = {}; // phone -> [{role, content}]
const SMS_MAX_HISTORY = 6;   // remember last 6 exchanges per number

function getSmsHistory(phone) {
  if (!smsConversations[phone]) smsConversations[phone] = [];
  return smsConversations[phone];
}

function addSmsMessage(phone, role, content) {
  const history = getSmsHistory(phone);
  history.push({ role, content });
  // Keep only last N messages to avoid token bloat
  if (history.length > SMS_MAX_HISTORY * 2) {
    smsConversations[phone] = history.slice(-SMS_MAX_HISTORY * 2);
  }
}

// ── NUGGETS ──────────────────────────────────────────────────────
app.get('/api/nuggets', (req, res) => {
  res.json({ nuggets: store.nuggets, count: store.nuggets.length });
});

app.post('/api/nuggets', (req, res) => {
  const { text, source = 'claude-chat' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const nugget = { text, date: new Date().toISOString().slice(0, 10), source, id: Date.now() };
  store.nuggets.unshift(nugget);
  console.log(`💡 NUGGET: ${text}`);
  res.json({ success: true, nugget });
});

// ── TASKS ─────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
  res.json({ tasks: store.tasks, count: store.tasks.length });
});

app.post('/api/tasks', (req, res) => {
  const { text, priority = 'MED', source = 'claude-chat' } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const task = { text, priority, done: false, date: new Date().toISOString().slice(0, 10), source, id: Date.now() };
  store.tasks.unshift(task);
  console.log(`✅ TASK: ${text}`);
  res.json({ success: true, task });
});

app.patch('/api/tasks/:id', (req, res) => {
  const task = store.tasks.find(t => t.id === parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: 'not found' });
  task.done = !task.done;
  saveStore();
  res.json({ success: true, task });
});

// ── EVENTS (from Claude chat) ─────────────────────────────────────
app.post('/api/events', (req, res) => {
  const { title, date, time, notes, source = 'claude-chat' } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const event = { title, date, time, notes, source, id: Date.now() };
  store.events.unshift(event);
  console.log(`📅 EVENT: ${title} on ${date}`);
  res.json({ success: true, event });
});

app.get('/api/events', (req, res) => {
  res.json({ events: store.events, count: store.events.length });
});

// ── FULL STORE DUMP (for LCARS to poll) ──────────────────────────
app.get('/api/store', (req, res) => {
  res.json({ ...store, updated: new Date().toISOString() });
});

// ── SMS / TWILIO BRIDGE ───────────────────────────────────────────
const MessagingResponse = require('twilio').twiml.MessagingResponse;

function smsReply(res, text) {
  const twiml = new MessagingResponse();
  twiml.message(text);
  res.type('text/xml').send(twiml.toString());
}

app.post('/api/sms', async (req, res) => {
  const inbound = req.body.Body?.trim() || '';
  const from = req.body.From || '';
  console.log(`📱 SMS from ${from}: ${inbound}`);

  const lower = inbound.toLowerCase();
  let reply = '';

  try {
    // COMMAND PARSING
    if (lower.startsWith('/nugget ')) {
      const text = inbound.slice(8).trim();
      store.nuggets.unshift({ text, date: new Date().toISOString().slice(0,10), source: 'sms', id: Date.now() });
      saveStore();
      reply = `💡 NUGGET LOGGED: "${text}" — visible in LCARS within 30s`;

    } else if (lower.startsWith('/task ')) {
      const text = inbound.slice(6).trim();
      const priority = lower.includes('high') ? 'HIGH' : lower.includes('low') ? 'LOW' : 'MED';
      store.tasks.unshift({ text, priority, done: false, date: new Date().toISOString().slice(0,10), source: 'sms', id: Date.now() });
      saveStore();
      reply = `✅ TASK ADDED [${priority}]: "${text}" — visible in LCARS within 30s`;

    } else if (lower.startsWith('/remind ')) {
      const text = inbound.slice(8).trim();
      store.tasks.unshift({ text: `🔔 ${text}`, priority: 'HIGH', done: false, date: new Date().toISOString().slice(0,10), source: 'sms-remind', id: Date.now() });
      saveStore();
      reply = `🔔 REMINDER LOGGED: "${text}"`;

    } else if (lower.startsWith('/cal ')) {
      const text = inbound.slice(5).trim();
      store.events.unshift({ title: text, date: new Date().toISOString().slice(0,10), source: 'sms', id: Date.now() });
      saveStore();
      reply = `📅 EVENT CAPTURED: "${text}" — add to calendar when ready`;

    } else if (lower === '/brief' || lower === '/status') {
      const now = new Date();
      const h = now.getHours();
      const tod = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 150,
        system: LCARS_SYSTEM,
        messages: [{ role: 'user', content: `Quick ${tod} briefing for Luis via SMS. Max 3 bullet points, plain text no markdown, keep it short.` }]
      });
      reply = msg.content[0].text;

    } else if (lower === '/nuggets') {
      const recent = store.nuggets.slice(0, 3).map((n,i) => `${i+1}. ${n.text}`).join('\n');
      reply = `💡 RECENT NUGGETS:\n${recent || 'None yet'}`;

    } else if (lower === '/tasks') {
      const open = store.tasks.filter(t => !t.done).slice(0, 3).map((t,i) => `${i+1}. [${t.priority}] ${t.text}`).join('\n');
      reply = `✅ OPEN TASKS:\n${open || 'All clear'}`;

    } else if (lower === '/help') {
      reply = `LCARS SMS COMMANDS:\n/nugget [idea]\n/task [item]\n/remind [text]\n/cal [event]\n/brief — status update\n/nuggets — recent ideas\n/tasks — open tasks\nAnything else = chat with Claude`;

    } else {
      // Free chat with Claude — with conversation memory per number
      const history = getSmsHistory(from);
      addSmsMessage(from, 'user', inbound);
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: LCARS_SYSTEM + '\nResponding via SMS. Keep replies under 300 chars. Plain text only. You remember this conversation.',
        messages: history
      });
      reply = msg.content[0].text;
      addSmsMessage(from, 'assistant', reply);
    }

  } catch (err) {
    console.error('SMS handler error:', err);
    reply = 'LCARS ERROR: ' + err.message;
  }

  console.log(`📤 Reply: ${reply.slice(0,60)}`);
  smsReply(res, reply);
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ LCARS API v2.1 on port ${PORT}`));
