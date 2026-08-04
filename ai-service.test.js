/* Tests for ai-service.js — Gemini request build, response parse, and fallback.
 * Uses a stubbed https.request so no real API key or network is needed. */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const https = require('https');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', name); } }

function stubGemini(payloadText, status) {
  https.request = function (opts, cb) {
    const EventEmitter = require('events');
    const res = new EventEmitter();
    res.statusCode = status || 200;
    const body = JSON.stringify({ candidates: [{ content: { parts: [{ text: payloadText }] } }] });
    process.nextTick(() => { cb(res); res.emit('data', body); res.emit('end'); });
    return { on() {}, write() {}, end() {} };
  };
}

const GOOD = JSON.stringify({
  deliberation: [
    { p: 'BS', say: 'ROI strong.' }, { p: 'RA', say: 'Residency risk.' },
    { p: 'CI', say: 'Vertex AI fits.' }, { p: 'BS', say: 'Mitigate.' },
    { p: 'RA', say: 'Accept.' }, { p: 'CI', say: 'Conditional.' },
    { p: 'CC', say: 'CONDITIONAL GO.' },
  ],
  stances: [{ persona: 'BS', value: 'Support' }, { persona: 'RA', value: 'Conditional' }],
  verdict: 'CONDITIONAL GO', condition: 'Data residency clause.',
});

test('ai-service', async () => {
  const orig = https.request;

  // No key -> disabled.
  delete process.env.GOOGLE_API_KEY; delete process.env.GEMINI_API_KEY;
  delete require.cache[require.resolve('./ai-service')];
  let ai = require('./ai-service');
  ok('disabled without key', ai.isEnabled() === false);

  // With key -> enabled, parses clean JSON.
  process.env.GOOGLE_API_KEY = 'FAKE';
  delete require.cache[require.resolve('./ai-service')];
  ai = require('./ai-service');
  ok('enabled with key', ai.isEnabled() === true);

  stubGemini(GOOD);
  const d = await ai.deliberate({ name: 'AskHR', verdict: 'CONDITIONAL GO' });
  ok('source is gemini', d.source === 'gemini');
  ok('7 turns', d.deliberation.length === 7);
  ok('valid persona codes only', d.deliberation.every((t) => ['BS','RA','CI','CC'].includes(t.p)));
  ok('stance has klass', d.stances[0].klass === 'stance--support');
  ok('condition passed through', d.condition === 'Data residency clause.');

  // Markdown-fenced JSON still parses.
  stubGemini('```json\n' + GOOD + '\n```');
  const d2 = await ai.deliberate({ name: 'X' });
  ok('fenced JSON parses', d2.deliberation.length === 7);

  // HTTP error -> rejects (caller falls back).
  stubGemini('nope', 500);
  let threw = false;
  try { await ai.deliberate({ name: 'X' }); } catch (e) { threw = true; }
  ok('rejects on HTTP error', threw === true);

  // Assist.
  stubGemini(JSON.stringify({ hint: 'Use Vertex AI Agent Builder.' }));
  const h = await ai.assist({ step: 'intake' });
  ok('assist returns hint', h.source === 'gemini' && /Vertex AI/.test(h.hint));

  https.request = orig;
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  assert.strictEqual(fail, 0);
});
