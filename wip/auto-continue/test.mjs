// node test.mjs — flows of the auto-continue extension with a fake pi.
import assert from 'node:assert/strict';
const mod = await import('./index.ts');
function make(env = {}) {
  Object.assign(process.env, { PI_AUTO_CONTINUE: '' }, env);
  const h = {}; const cmds = {};
  const pi = { on: (e, f) => (h[e] = f), registerCommand: (n, c) => (cmds[n] = c), getActiveTools: () => ['bash'] };
  mod.default(pi);
  const ui = { setStatus() {}, notify() {} };
  return {
    start: (hasUI = true) => h.session_start({}, { hasUI, ui }),
    say: (text) => h.input({ text }, { hasUI: true, ui }),
    cmd: (a) => cmds.auto.handler(a, { hasUI: true, ui }),
    settle: (text) => h.agent_before_settle({ outcome: 'completed', context: { contextMessages: [{ role: 'user' }, { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] }] } }),
  };
}
const OFFER = 'Done.\n\nShould I add the total now? I\'d pick yes.';
let x = make(); x.start(); x.say('fix the build');
assert.match(x.settle(OFFER).entries[0].content, /do it now/, 'default on in UI sessions');
x = make(); x.start(); x.say('why is the build red?');
assert.match(x.settle(OFFER).entries[0].content, /read-only/, 'question -> read-only nudge');
x = make(); x.start(); x.say('keep going, why not?');
assert.match(x.settle(OFFER).entries[0].content, /do it now/, 'explicit trigger beats question');
x = make(); x.start(false); x.say('fix it');
assert.equal(x.settle(OFFER), undefined, 'headless stays off');
x = make({ PI_AUTO_CONTINUE: 'manual' }); x.start(); x.say('fix it');
assert.equal(x.settle(OFFER), undefined, 'manual: off until asked');
x.say('keep going'); assert.ok(x.settle(OFFER), 'manual + trigger -> on');
x = make(); x.start(); await x.cmd('off'); x.say('fix it');
assert.equal(x.settle(OFFER), undefined, '/auto off holds');
x = make(); x.start(); x.say('fix it');
assert.equal(x.settle('Done.\n\nShould I delete the production table? I\'d pick yes.'), undefined, 'user-only stops');
for (const t of ['Should I switch to the €21/month plan? I\'d pick yes.', 'Should I upgrade it (21 EUR a month)? I\'d pick yes.', 'Should I take the 500 Kč tier? I\'d pick yes.', 'Should I move to the 20/month plan? I\'d pick yes.', 'Should I check the pricing page? I\'d pick yes.']) {
  x = make(); x.start(); x.say('fix it');
  assert.equal(x.settle(`Done.\n\n${t}`), undefined, `money stops: ${t}`);
}
x = make(); x.start(); x.say('fix it');
assert.ok(x.settle('Done.\n\nShould I bump the retry limit to 5 per run? I\'d pick yes.'), 'plain numbers still continue');
const c = mod.classifyEnding;
assert.equal(c('A.\n\nIf you want the real answer, I can look on disk.'), 'offer');
assert.equal(c('A.\n\nShould I fix it now or wait for Monday? I\'d pick the fix.'), 'offer');
assert.equal(c('A.\n\nWhen W39 lands on Monday, I will review it.'), 'none');
assert.equal(c('A.\n\nShould I add it? My pick is to leave it until Monday.'), 'none');
assert.equal(c('Should I apply it? My pick is yes.\n\nYour stash is intact.'), 'offer');
assert.equal(c('Report done.\n\nNext: open the PR page to check the tables.'), 'none');
console.log('auto-continue: all flows pass');
