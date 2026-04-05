const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'LCARS API ONLINE', version: '1.0' });
});

// Claude chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, context } = req.body;

    const systemPrompt = `You are LCARS — the Library Computer Access and Retrieval System for Luis Espinosa's personal command interface. You are concise, direct, and speak in a Starfleet computer style. You know about Luis's schedule, gigs, projects, and goals. Keep responses short and punchy — this is a command interface, not a conversation. Use LCARS terminology when appropriate. Current context: ${context || 'General query'}`;

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }]
    });

    res.json({
      response: msg.content[0].text,
      tokens: msg.usage.output_tokens
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Daily briefing endpoint
app.get('/api/briefing', async (req, res) => {
  try {
    const now = new Date();
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Generate a short LCARS-style daily briefing for Luis Espinosa. Today is ${now.toDateString()}. He is a video engineer / creative director based in Coral Springs FL. He has a gig today (MPM Bioimpact 2026 at 1 Hotel South Beach) and a meeting Thursday with Thomas about systems and SOPs. Keep it to 3 bullet points max, LCARS computer style.`
      }]
    });
    res.json({ briefing: msg.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ LCARS API running on port ${PORT}`));
