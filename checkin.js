// ═══════════════════════════════════════════════════════════════
// LCARS CHECKIN MODULE — checkin.js
// Drop this file into your lcars-api repo root, then
// require('./checkin')(store, twilioClient, config) in server.js
// ═══════════════════════════════════════════════════════════════
// Dependencies to add to package.json:
//   npm install node-cron nodemailer
// ═══════════════════════════════════════════════════════════════

const cron = require('node-cron');
const nodemailer = require('nodemailer');

// ── CONFIG ──────────────────────────────────────────────────────
// All secrets pulled from environment variables (set in Render dashboard)
// GMAIL_USER       → luislre@gmail.com
// GMAIL_PASS       → Gmail App Password (16-char, not your login password)
// TWILIO_TO        → +19545399989  (your number)
// TWILIO_FROM      → your Twilio number
// LCARS_API_URL    → https://lcars-api.onrender.com (for internal calendar fetch)

const EMAIL_TO   = process.env.CHECKIN_EMAIL || 'lespinosa@frostflorida.com';
const SMS_TO     = process.env.TWILIO_TO  || '+19545399989';

// ── EMAIL TRANSPORT ─────────────────────────────────────────────
function makeTransport() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,   // Gmail App Password
    },
  });
}

// ── HELPERS ─────────────────────────────────────────────────────
function stardate() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const doy = Math.floor(diff / oneDay);
  return `${now.getFullYear()}.${doy.toString().padStart(3,'0')}`;
}

function etNow() {
  return new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });
}

function todayET() {
  return new Date().toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long', month: 'long', day: 'numeric'
  });
}

// Fetch today's calendar events from the LCARS API itself
async function fetchTodayEvents() {
  try {
    const apiUrl = process.env.LCARS_API_URL || 'https://lcars-api.onrender.com';
    const URLS = [
      'https://calendar.google.com/calendar/ical/lespinosa%40frostflorida.com/private-1bb59553e99af6e8fc4f4d2074182626/basic.ics',
      'webcal://p135-caldav.icloud.com/published/2/MTAzNTE5Mzk4NDIxMDM1MRH7oMYq2vnBm9PGGEMy-6_OjOARgb-NBp5vXUkh4D1m',
    ];
    const params = URLS.map(u => `url=${encodeURIComponent(u)}`).join('&');
    const res = await fetch(`${apiUrl}/api/calendar?${params}`);
    const data = await res.json();

    const today = new Date().toISOString().split('T')[0];
    return (data.events || []).filter(e => {
      const d = e.start?.split('T')[0] || e.start || '';
      return d === today;
    });
  } catch (e) {
    return [];
  }
}

// ── BRIEFING BUILDERS ────────────────────────────────────────────

async function buildMorningBriefing(store) {
  const events = await fetchTodayEvents();
  const tasks  = (store.tasks  || []).filter(t => !t.done).slice(0, 5);
  const nuggets = (store.nuggets || []).slice(0, 3);

  const eventLines = events.length
    ? events.map(e => `  • ${e.time || ''} ${e.title}`).join('\n')
    : '  No calendar events pulled — check feed.';

  const taskLines = tasks.length
    ? tasks.map(t => `  [${t.priority}] ${t.text}`).join('\n')
    : '  Task board clear.';

  const text = [
    `☀️ LCARS MORNING BRIEFING — STARDATE ${stardate()}`,
    `${todayET()}`,
    ``,
    `━━ TODAY'S CALENDAR ━━`,
    eventLines,
    ``,
    `━━ TOP TASKS ━━`,
    taskLines,
    ``,
    `━━ STANDING BY ━━`,
    `  Systems nominal. All stations ready.`,
    `  Reply /help for commands.`,
  ].join('\n');

  const html = `
    <div style="font-family:monospace;background:#000;color:#FF9900;padding:20px;border-radius:8px;max-width:600px;">
      <h2 style="color:#FF9900;letter-spacing:0.1em;">☀️ LCARS MORNING BRIEFING</h2>
      <p style="color:#FFCC66;">STARDATE ${stardate()} — ${todayET()}</p>
      <hr style="border-color:#FF9900;opacity:0.3;"/>
      <h3 style="color:#FF6633;">TODAY'S CALENDAR</h3>
      <pre style="color:#FFCC66;">${eventLines}</pre>
      <h3 style="color:#FF6633;">TOP TASKS</h3>
      <pre style="color:#FFCC66;">${taskLines}</pre>
      <hr style="border-color:#FF9900;opacity:0.3;"/>
      <p style="color:#888;font-size:0.85em;">LCARS ESPINOSA COMMAND v3 — All systems nominal</p>
    </div>`;

  return { text, html, subject: `☀️ LCARS Morning Briefing — ${todayET()}` };
}

async function buildAfternoonBriefing(store) {
  const events  = await fetchTodayEvents();
  const tasks   = (store.tasks || []).filter(t => !t.done).slice(0, 5);
  const nowHour = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });

  // Remaining events (rough filter — afternoon only)
  const remaining = events.filter(e => {
    const h = parseInt((e.time || '00:00').split(':')[0]);
    return h >= 14;
  });

  const remainingLines = remaining.length
    ? remaining.map(e => `  • ${e.time || ''} ${e.title}`).join('\n')
    : '  No remaining events on the calendar.';

  const taskLines = tasks.length
    ? tasks.map(t => `  [${t.priority}] ${t.text}`).join('\n')
    : '  Task board clear.';

  const text = [
    `🔆 LCARS AFTERNOON CHECK-IN — STARDATE ${stardate()}`,
    `${todayET()} | ${nowHour}:00 ET`,
    ``,
    `━━ REMAINING TODAY ━━`,
    remainingLines,
    ``,
    `━━ OPEN TASKS ━━`,
    taskLines,
    ``,
    `━━ SYSTEMS ━━`,
    `  Mid-day systems check complete.`,
    `  Standing by for commands.`,
  ].join('\n');

  const html = `
    <div style="font-family:monospace;background:#000;color:#4499FF;padding:20px;border-radius:8px;max-width:600px;">
      <h2 style="color:#4499FF;letter-spacing:0.1em;">🔆 LCARS AFTERNOON CHECK-IN</h2>
      <p style="color:#66CCFF;">STARDATE ${stardate()} — ${todayET()}</p>
      <hr style="border-color:#4499FF;opacity:0.3;"/>
      <h3 style="color:#00CCFF;">REMAINING TODAY</h3>
      <pre style="color:#AADDFF;">${remainingLines}</pre>
      <h3 style="color:#00CCFF;">OPEN TASKS</h3>
      <pre style="color:#AADDFF;">${taskLines}</pre>
      <hr style="border-color:#4499FF;opacity:0.3;"/>
      <p style="color:#888;font-size:0.85em;">LCARS ESPINOSA COMMAND v3 — Mid-day check complete</p>
    </div>`;

  return { text, html, subject: `🔆 LCARS Afternoon Check-in — ${todayET()}` };
}

async function buildWeeklyBriefing(store) {
  const tasks   = (store.tasks   || []).filter(t => !t.done).slice(0, 10);
  const nuggets = (store.nuggets || []).slice(0, 5);

  const taskLines  = tasks.length  ? tasks.map(t  => `  [${t.priority}] ${t.text}`).join('\n') : '  Task board clear.';
  const nuggetLines = nuggets.length ? nuggets.map(n => `  ★ ${n.text}`).join('\n')               : '  No recent nuggets.';

  const text = [
    `🖖 LCARS WEEKLY BRIEFING — STARDATE ${stardate()}`,
    `Week of ${todayET()}`,
    ``,
    `━━ OPEN TASKS ━━`,
    taskLines,
    ``,
    `━━ RECENT NUGGETS ━━`,
    nuggetLines,
    ``,
    `━━ PRIORITY THIS WEEK ━━`,
    `  Review above — protect your anchors.`,
    `  Reply /nugget <text> to log new intelligence.`,
  ].join('\n');

  const html = `
    <div style="font-family:monospace;background:#000;color:#AA44FF;padding:20px;border-radius:8px;max-width:600px;">
      <h2 style="color:#AA44FF;letter-spacing:0.1em;">🖖 LCARS WEEKLY BRIEFING</h2>
      <p style="color:#CC88FF;">STARDATE ${stardate()} — Week of ${todayET()}</p>
      <hr style="border-color:#AA44FF;opacity:0.3;"/>
      <h3 style="color:#DD66FF;">OPEN TASKS</h3>
      <pre style="color:#DDAAFF;">${taskLines}</pre>
      <h3 style="color:#DD66FF;">RECENT NUGGETS</h3>
      <pre style="color:#DDAAFF;">${nuggetLines}</pre>
      <hr style="border-color:#AA44FF;opacity:0.3;"/>
      <p style="color:#888;font-size:0.85em;">LCARS ESPINOSA COMMAND v3 — Weekly systems review</p>
    </div>`;

  return { text, html, subject: `🖖 LCARS Weekly Briefing — ${todayET()}` };
}

// ── DELIVERY ─────────────────────────────────────────────────────

async function sendEmail({ subject, html, text }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    console.log('[CHECKIN] Email not configured — skipping');
    return;
  }
  try {
    const transport = makeTransport();
    await transport.sendMail({
      from: `"LCARS CMD" <${process.env.GMAIL_USER}>`,
      to: EMAIL_TO,
      subject,
      text,
      html,
    });
    console.log(`[CHECKIN] Email sent: ${subject}`);
  } catch (e) {
    console.error('[CHECKIN] Email error:', e.message);
  }
}

async function sendSMS(twilioClient, body) {
  if (!twilioClient) {
    console.log('[CHECKIN] Twilio not configured — skipping SMS');
    return;
  }
  try {
    // Truncate to SMS-friendly length
    const smsBody = body.length > 1500 ? body.substring(0, 1497) + '...' : body;
    await twilioClient.messages.create({
      body: smsBody,
      messagingServiceSid: process.env.TWILIO_MESSAGING_SID,
      to: SMS_TO,
    });
    console.log('[CHECKIN] SMS sent');
  } catch (e) {
    console.error('[CHECKIN] SMS error:', e.message);
  }
}

function pushToLCARS(store, briefingText, type) {
  // Push briefing as a special nugget so LCARS panel picks it up
  if (!store.nuggets) store.nuggets = [];
  store.nuggets.unshift({
    text: `[${type}] ${briefingText.split('\n')[0]}`,
    date: new Date().toLocaleDateString('en-US', { month:'short', day:'numeric' }),
    type: 'briefing',
  });
  // Keep briefing store key for the home panel
  store.lastBriefing = briefingText;
  store.lastBriefingTime = new Date().toISOString();
  console.log(`[CHECKIN] Pushed ${type} briefing to LCARS store`);
}

async function buildEveningBriefing(store) {
  const tasks   = (store.tasks || []).filter(t => !t.done).slice(0, 5);
  const nuggets = (store.nuggets || []).slice(0, 3);

  const taskLines   = tasks.length   ? tasks.map(t   => `  [${t.priority}] ${t.text}`).join('\n') : '  Task board clear — good work.';
  const nuggetLines = nuggets.length ? nuggets.map(n  => `  ★ ${n.text}`).join('\n')               : '  No recent nuggets.';

  const text = [
    `🌆 LCARS EVENING WRAP — STARDATE ${stardate()}`,
    `${todayET()}`,
    ``,
    `━━ OPEN TASKS (CARRY FORWARD) ━━`,
    taskLines,
    ``,
    `━━ RECENT NUGGETS ━━`,
    nuggetLines,
    ``,
    `━━ END OF DAY ━━`,
    `  Protect the anchor: kids bedtime 19:30.`,
    `  Systems standing by. Good work today.`,
  ].join('\n');

  const html = `
    <div style="font-family:monospace;background:#000;color:#CC6622;padding:20px;border-radius:8px;max-width:600px;">
      <h2 style="color:#CC6622;letter-spacing:0.1em;">🌆 LCARS EVENING WRAP</h2>
      <p style="color:#FF9966;">STARDATE ${stardate()} — ${todayET()}</p>
      <hr style="border-color:#CC6622;opacity:0.3;"/>
      <h3 style="color:#FF6633;">OPEN TASKS</h3>
      <pre style="color:#FFAA77;">${taskLines}</pre>
      <h3 style="color:#FF6633;">RECENT NUGGETS</h3>
      <pre style="color:#FFAA77;">${nuggetLines}</pre>
      <hr style="border-color:#CC6622;opacity:0.3;"/>
      <p style="color:#888;font-size:0.85em;">LCARS ESPINOSA COMMAND v3 — End of day wrap</p>
    </div>`;

  return { text, html, subject: `🌆 LCARS Evening Wrap — ${todayET()}` };
}

// ── MAIN EXPORT ───────────────────────────────────────────────────

// ── ON-DEMAND RUNNER (used by /api/checkin/:type endpoint) ──────
async function runCheckin(type, store, twilioClient, saveStore) {
  const builders = {
    morning:   buildMorningBriefing,
    afternoon: buildAfternoonBriefing,
    evening:   buildEveningBriefing,
    weekly:    buildWeeklyBriefing,
  };
  const build = builders[type];
  if (!build) throw new Error(`Unknown type: ${type}`);
  const briefing = await build(store);
  pushToLCARS(store, briefing.text, type.toUpperCase());
  if (saveStore) saveStore(store);
  await sendEmail(briefing);
  await sendSMS(twilioClient, briefing.text);
  return { subject: briefing.subject };
}

module.exports = { runCheckin };

// ── SCHEDULED INIT ───────────────────────────────────────────────
function initCheckins(store, twilioClient, saveStore) {
  console.log('[CHECKIN] Scheduling check-ins (ET timezone)');

  // ── MORNING: 8:15 AM ET Mon–Fri ─────────────────────────────
  cron.schedule('15 8 * * 1-5', async () => {
    console.log('[CHECKIN] Running morning briefing...');
    const briefing = await buildMorningBriefing(store);
    pushToLCARS(store, briefing.text, 'MORNING');
    if (saveStore) saveStore(store);
    await sendEmail(briefing);
    await sendSMS(twilioClient, briefing.text);
  }, { timezone: 'America/New_York' });

  // ── MORNING WEEKEND: 8:15 AM ET Sat–Sun ─────────────────────
  cron.schedule('15 8 * * 0,6', async () => {
    console.log('[CHECKIN] Running weekend morning briefing...');
    const briefing = await buildMorningBriefing(store);
    pushToLCARS(store, briefing.text, 'MORNING');
    if (saveStore) saveStore(store);
    await sendEmail(briefing);
    await sendSMS(twilioClient, briefing.text);
  }, { timezone: 'America/New_York' });

  // ── AFTERNOON: 2:00 PM ET daily ─────────────────────────────
  cron.schedule('0 14 * * *', async () => {
    console.log('[CHECKIN] Running afternoon check-in...');
    const briefing = await buildAfternoonBriefing(store);
    pushToLCARS(store, briefing.text, 'AFTERNOON');
    if (saveStore) saveStore(store);
    await sendEmail(briefing);
    await sendSMS(twilioClient, briefing.text);
  }, { timezone: 'America/New_York' });

  // ── EVENING: 6:00 PM ET daily ───────────────────────────────
  cron.schedule('0 18 * * *', async () => {
    console.log('[CHECKIN] Running evening wrap...');
    const briefing = await buildEveningBriefing(store);
    pushToLCARS(store, briefing.text, 'EVENING');
    if (saveStore) saveStore(store);
    await sendEmail(briefing);
    await sendSMS(twilioClient, briefing.text);
  }, { timezone: 'America/New_York' });

  // ── WEEKLY: Sunday 7:00 PM ET ────────────────────────────────
  cron.schedule('0 19 * * 0', async () => {
    console.log('[CHECKIN] Running weekly briefing...');
    const briefing = await buildWeeklyBriefing(store);
    pushToLCARS(store, briefing.text, 'WEEKLY');
    if (saveStore) saveStore(store);
    await sendEmail(briefing);
    await sendSMS(twilioClient, briefing.text);
  }, { timezone: 'America/New_York' });

  console.log('[CHECKIN] Scheduled:');
  console.log('  ☀️  Morning   — 8:15 AM ET (daily)');
  console.log('  🔆  Afternoon — 2:00 PM ET (daily)');
  console.log('  🌆  Evening   — 6:00 PM ET (daily)');
  console.log('  🖖  Weekly    — Sunday 7:00 PM ET');
}

module.exports.initCheckins = initCheckins;
