const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function test() {
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'LCARS online. Confirm.' }]
  });
  console.log('✅ API CONNECTED:', msg.content[0].text);
}

test().catch(err => console.error('❌ ERROR:', err.message));
