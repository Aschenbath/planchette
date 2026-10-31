"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { messageWeights, SpiritPhysics, createGlyphs, detectDwell } = require("../app.js");

const glyphs = createGlyphs();
const glyph = key => glyphs.find(g => g.key === key);
const vote = text => [...messageWeights(text).keys()];
for (const [text, expected] of [[" h ", "H"], ["...a!!!", "A"], ["(9)", "9"], ["YES!", "YES"], ["no", "NO"], ["bye", "GOODBYE"], ["GoodBye", "GOODBYE"], ["👻 i 👻", "I"]]) {
  assert.deepEqual(vote(text), [expected], text);
}
for (const text of ["hello", "say yes", "yesterday", "A Z", "aaa", "OOO", "www", "222", "HAH", "Kappa", "", "!seance"]) assert.deepEqual(vote(text), [], text);

function replay(rows, end, hz = 120) {
  const p = new SpiritPhysics();
  const state = { spoken: null, dwellKey: null, dwellStart: 0 };
  const spoken = [];
  let i = 0, travelled = 0, px = p.x, py = p.y;
  for (let frame = 0; frame <= end * hz / 1000; frame++) {
    const t = frame * 1000 / hz;
    while (i < rows.length && rows[i].t <= t) {
      const row = rows[i++]; p.addMessage(row.user, row.text, t);
    }
    const crowd = p.step(1 / hz, t);
    const key = detectDwell(state, p, crowd, t);
    if (key) spoken.push({ key, t: Math.round(t) });
    travelled += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y;
  }
  return { p, spoken, travelled: Math.round(travelled) };
}

const sort = rows => rows.sort((a, b) => a.t - b.t);
function groupVotes(start, duration, choose) {
  const rows = [];
  for (let t = start; t <= start + duration; t += 1000) {
    for (let i = 0; i < 8; i++) rows.push({ t, user: `synthetic_${i}`, text: choose(t - start, i) });
  }
  return rows;
}

for (const name of ["kaicenat", "summit1g"]) {
  const rows = fs.readFileSync(path.join(__dirname, "fixtures", `${name}.jsonl`), "utf8").trim().split(/\r?\n/).map(JSON.parse);
  const end = rows.at(-1).t + 8000;
  const baseline = replay(sort([...rows]), end);
  assert.deepEqual(baseline.spoken.map(s => s.key), name === "kaicenat" ? ["O", "W", "YES"] : [], `${name}: only the sparse real votes should speak`);
  const driftOnly = replay(rows.filter(r => !messageWeights(r.text).size), end);
  assert.equal(driftOnly.spoken.length, 0, `${name}: ordinary chatter must stay silent`);
  assert(baseline.travelled > 100, "An empty-vote board should wander");
  console.log(`${name}: ${rows.length} messages, spoken ${JSON.stringify(baseline.spoken)}, path ${baseline.travelled}px`);
  // Try the beginning, middle and end of each recording, at two frame rates.
  for (const start of [0, Math.floor(rows.at(-1).t / 2), Math.max(0, rows.at(-1).t - 14000)]) {
    for (const hz of [60, 120]) {
      const mixed = sort([...rows, ...groupVotes(start, 14000, t => t < 6000 ? "H" : "I")]);
      const result = replay(mixed, start + 15000, hz);
      assert.deepEqual(result.spoken.filter(s => s.t >= start).map(s => s.key), ["H", "I"], `${name} + HI at ${start}ms / ${hz}Hz`);
      assert(result.spoken.at(-1).t - start <= 15000);
      if (start === 0 && hz === 120) console.log(`${name} + 8 voters: ${JSON.stringify(result.spoken)}`);
    }
  }
  const majority = replay(sort([...rows, ...groupVotes(0, 14000, (_, i) => i < 5 ? "A" : "Z")]), 15000);
  assert.deepEqual(majority.spoken.map(s => s.key), ["A"]);
  const distance = Math.hypot(majority.p.x - glyph("A").x, majority.p.y - glyph("A").y);
  assert(distance < glyph("A").radius);
  console.log(`${name} + 5 A / 3 Z: A, distance from A ${distance.toFixed(2)}px`);
}

const p = new SpiritPhysics();
p.addMessage("one", "A", 0); p.addMessage("one", "Z", 10);
assert.deepEqual([...p.aggregate(10).weights], [["Z", 1]], "Latest vote replaces, rather than stacks");
p.addMessage("one", "ordinary chatter", 100);
assert(p.aggregate(100).weights.has("Z"), "Chatter leaves the deliberate vote to decay");
assert(p.aggregate(7001).weights.has("Z"));
assert.equal(p.aggregate(7011).total, 0);

for (let i = 0; i < 5000; i++) p.addMessage(`drift_${i}`, "the wood moves", 8000);
const drift = p.aggregate(8000);
assert.equal(drift.total, 0); assert.equal(p.drifters.size, 700);
assert(Math.hypot(drift.driftX, drift.driftY) <= 0.120001);
// Put a still window directly on a glyph: drift still cannot authorize speech.
p.x = glyph("H").x; p.y = glyph("H").y;
const state = { spoken: null, dwellKey: null, dwellStart: 0 };
for (let t = 8000; t < 12000; t += 100) assert.equal(detectDwell(state, p, p.aggregate(t), t), null);
assert.equal(p.drifters.size, 0);
// A vote that expires halfway through a dwell must not finish speaking.
p.addMessage("one", "H", 0);
detectDwell(state, p, p.aggregate(6500), 6500);
assert.equal(detectDwell(state, p, p.aggregate(8200), 8200), null);

// Hysteresis keeps an equal split steady, but lets a decisive new group win.
p.clear();
for (let i = 0; i < 8; i++) p.addMessage(`user_${i}`, i < 4 ? "A" : "Z", 0);
assert.equal(p.aggregate(0).winner, "A");
p.addMessage("user_0", "Z", 100); assert.equal(p.aggregate(100).winner, "Z");
p.clear(); assert.equal(p.aggregate(100).total, 0);

let minimum = Infinity, closest;
for (let i = 0; i < glyphs.length; i++) {
  const a = glyphs[i];
  assert(a.x - a.radius >= 17 && a.x + a.radius <= 1583 && a.y - a.radius >= 17 && a.y + a.radius <= 843);
  for (const b of glyphs.slice(i + 1)) {
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const gap = distance - a.radius - b.radius;
    assert(gap > 0, `${a.key}/${b.key} windows overlap by ${-gap}px`);
    if (gap < minimum) { minimum = gap; closest = `${a.key}/${b.key}`; }
  }
}
console.log(`Glyph windows: minimum gap ${minimum.toFixed(2)}px (${closest}); all ${glyphs.length} centres checked`);
console.log("Replay, parsing, replacement, decay, drift bounds, dwell eligibility, plurality and layout checks passed.");
