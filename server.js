const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
app.use(cors());
app.use(express.json());

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

// ── IN-MEMORY STORE (persists until server restarts) ──────────────
const store = {
  nuggets: [
    { text: 'LCARS as main personal OS', date: '2026-04-04', source: 'session' },
    { text: 'Stream Deck as Claude command surface', date: '2026-04-04', source: 'session' },
    { text: 'Pi as always-on control brain', date: '2026-04-04', source: 'session' },
    { text: 'Mac mini as full-time home AI server', date: '2026-04-05', source: 'claude-chat' },
  ],
  tasks: [],
  events: [],
};

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ LCARS API v2.1 on port ${PORT}`));
