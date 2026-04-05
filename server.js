const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());

const LCARS_SYSTEM = `You are LCARS — the Library Computer Access and Retrieval System, personal command interface for Luis Espinosa (callsign: LRE).

ABOUT LUIS:
- Video Engineer & Creative Director, Coral Springs FL
- Works under Frost Florida (lespinosa@frostflorida.com)
- Warehouse/office at 701 Boutwell
- Kids school drop-off by 7:15am weekdays
- Night owl, 24hr gym Mon/Wed/Fri after 10pm
- Building: Pi + Stream Deck + Claude control system
- Uses Monday.com for work comms
- Current gigs: MPM Bioimpact 2026 (Apr 6, 1 Hotel South Beach), Selfless Love Gala (Apr 10, Mar-a-Lago)
- Meeting with Thomas Thu Apr 9 1pm — Systems & SOPs

LCARS PERSONALITY:
- Concise, direct, Starfleet computer style
- Use: Acknowledged / Processing / Confirmed / Standby
- Max 3-4 sentences unless detail requested
- Lists use ▸ prefix
- This is a command interface, not a chat app`;

app.get('/', (req, res) => res.json({ status: 'LCARS API v2.0 ONLINE' }));
app.get('/health', (req, res) => res.json({ status: 'nominal', ts: new Date().toISOString() }));

// Conversation memory per session
const conversations = new Map();

app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId = 'default', context = '' } = req.body;
    if (!conversations.has(sessionId)) conversations.set(sessionId, []);
    const history = conversations.get(sessionId);
    history.push({ role: 'user', content: message });
    const recent = history.slice(-10);
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: LCARS_SYSTEM + (context ? `\nContext: ${context}` : ''),
      messages: recent
    });
    const response = msg.content[0].text;
    history.push({ role: 'assistant', content: response });
    res.json({ response, tokens: msg.usage.output_tokens, turns: history.length / 2 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      system: LCARS_SYSTEM,
      messages: [{ role: 'user', content: `${tod} briefing for Luis. Today: ${day}. 3 bullet points max, ▸ prefix, LCARS style, specific and actionable.` }]
    });
    res.json({ briefing: msg.content[0].text, timestamp: now.toISOString(), tod });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/calendar', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.json({ events: [], note: 'Add ?url=ICAL_URL to fetch calendar' });
  try {
    const r = await fetch(url);
    const text = await r.text();
    const events = parseICal(text);
    res.json({ events: events.slice(0, 20), count: events.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function parseICal(text) {
  const events = [], lines = text.split('\n').map(l => l.trim());
  let ev = null;
  const now = new Date();
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { ev = {}; }
    else if (line === 'END:VEVENT' && ev) {
      if (ev.start && new Date(ev.start) >= now) events.push(ev);
      ev = null;
    } else if (ev) {
      if (line.startsWith('SUMMARY:')) ev.title = line.slice(8).trim();
      else if (line.startsWith('DTSTART')) ev.start = parseDate(line.split(':').slice(1).join(':'));
      else if (line.startsWith('DTEND')) ev.end = parseDate(line.split(':').slice(1).join(':'));
      else if (line.startsWith('LOCATION:')) ev.location = line.slice(9).trim();
    }
  }
  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}

function parseDate(s) {
  if (!s) return null;
  s = s.trim().replace('Z', '');
  const y = s.slice(0,4), m = s.slice(4,6), d = s.slice(6,8);
  if (s.length > 8) return `${y}-${m}-${d}T${s.slice(9,11)||'00'}:${s.slice(11,13)||'00'}:00`;
  return `${y}-${m}-${d}`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ LCARS API v2.0 on port ${PORT}`));
