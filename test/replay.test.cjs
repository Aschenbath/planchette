"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { messageWeights, SpiritPhysics, createGlyphs, detectDwell, prepareFrame } = require("../app.js");

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
  let i = 0, travelled = 0, px = p.x, py = p.y, insideBoard = true;
  for (let frame = 0; frame <= end * hz / 1000; frame++) {
    const t = frame * 1000 / hz;
    while (i < rows.length && rows[i].t <= t) {
      const row = rows[i++]; p.addMessage(row.user, row.text, t);
    }
    const crowd = p.step(1 / hz, t);
    insideBoard &&= p.x >= 190 && p.x <= 1410 && p.y >= 148 && p.y <= 770;
    const key = detectDwell(state, p, crowd, t);
    if (key) spoken.push({ key, t: Math.round(t) });
    travelled += Math.hypot(p.x - px, p.y - py); px = p.x; py = p.y;
  }
  return { p, spoken, travelled: Math.round(travelled), insideBoard };
}

const sort = rows => rows.sort((a, b) => a.t - b.t);
function groupVotes(start, duration, choose) {
  const rows = [];
  for (let t = start; t <= start + duration; t += 1000) {
    for (let i = 0; i < 8; i++) rows.push({ t, user: `synthetic_${i}`, text: choose(t - start, i) });
  }
  return rows;
}

for (const hz of [60, 120]) {
  const singleVotes = [
    { t: 0, user: "solo", text: "H" },
    { t: 5000, user: "solo", text: "I" },
    { t: 10000, user: "solo", text: "goodbye" }
  ];
  const single = replay(singleVotes, 18000, hz);
  assert.deepEqual(single.spoken.map(s => s.key), ["H", "I", "GOODBYE"], `One viewer, single messages / ${hz}Hz`);
  single.spoken.forEach((spoken, i) => {
    const delay = spoken.t - singleVotes[i].t;
    assert(delay >= 0 && delay <= 4000, `${spoken.key} must speak within 4 s of its single vote / ${hz}Hz: ${delay}ms`);
  });
  assert(single.insideBoard, `One viewer stays inside the board / ${hz}Hz`);
  console.log(`One viewer / ${hz}Hz: ${JSON.stringify(single.spoken)}`);

  const three = replay([
    { t: 0, user: "small_1", text: "H" },
    { t: 0, user: "small_2", text: "H" },
    { t: 0, user: "small_3", text: "Y" }
  ], 8000, hz);
  assert.deepEqual(three.spoken.map(s => s.key), ["H"], `Two H / one Y must speak H / ${hz}Hz`);
  assert(three.insideBoard, `Three viewers stay inside the board / ${hz}Hz`);
  console.log(`Three viewers, 2 H / 1 Y / ${hz}Hz: ${JSON.stringify(three.spoken)}`);
}

const unanimousRaid = replay(Array.from({ length: 5000 }, (_, i) => ({ t: 0, user: `raid_${i}`, text: "H" })), 8000);
assert.deepEqual(unanimousRaid.spoken.map(s => s.key), ["H"], "A unanimous raid must reach its glyph");
assert(unanimousRaid.spoken[0].t <= 4000);
assert(unanimousRaid.insideBoard, "A unanimous raid stays inside the board");
console.log(`Unanimous raid, 5000 messages: ${JSON.stringify(unanimousRaid.spoken)}`);

const room = new SpiritPhysics();
room.addMessage("voter", "H", 0);
room.addMessage("voter", "chatter", 100);
assert.equal(room.aggregate(100).bystanderWeight, 0, "A live voter is not counted again as a bystander");
room.addMessage("observer", "chatter", 100);
assert.equal(room.aggregate(100).bystanderWeight, 1);
assert.equal(room.aggregate(1700).total, Math.exp(-1700 / 1900), "Room activity does not refresh votes");
assert.equal(room.drifters.size, 0, "Drift expires before room activity");
assert(room.aggregate(1700).bystanderWeight > 0);
room.addMessage("observer", "H", 2000);
assert.equal(room.aggregate(2000).bystanderWeight, 0, "Voting removes a bystander's neutral weight");
room.addMessage("observer", "chatter", 2100);
room.aggregate(9101);
assert.equal(room.bystanders.size, 0, "Room activity expires after seven seconds");
room.addMessage("observer", "chatter", 10000);
room.clear();
assert.equal(room.bystanders.size, 0, "Clearing the room clears neutral activity");

for (const name of ["kaicenat", "summit1g"]) {
  const rows = fs.readFileSync(path.join(__dirname, "fixtures", `${name}.jsonl`), "utf8").trim().split(/\r?\n/).map(JSON.parse);
  const end = rows.at(-1).t + 8000;
  const baseline = replay(sort([...rows]), end);
  assert.deepEqual(baseline.spoken.map(s => s.key), name === "kaicenat" ? ["O", "W", "YES"] : [], `${name}: only the sparse real votes should speak`);
  const driftOnly = replay(rows.filter(r => !messageWeights(r.text).size), end);
  assert.equal(driftOnly.spoken.length, 0, `${name}: ordinary chatter must stay silent`);
  assert(driftOnly.travelled > 100, `${name}: an empty-vote board should wander`);
  assert(driftOnly.insideBoard, `${name}: an empty-vote board should stay inside the board`);
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
assert.equal(p.bystanders.size, 700, "Recent room activity stays bounded during a raid");
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

// A suspended page must expire votes before its capped clock can finish a dwell.
for (const freshVote of [false, true]) {
  const suspended = new SpiritPhysics();
  suspended.x = glyph("H").x; suspended.y = glyph("H").y;
  suspended.addMessage("one", "H", 0);
  const pending = { spoken: null, dwellKey: null, dwellStart: 0, clock: 0 };
  const spoken = [];
  function frame(wallNow, previousFrame) {
    let remaining = prepareFrame(pending, suspended, wallNow, previousFrame);
    while (remaining > 0.00001) {
      const dt = Math.min(remaining, 1 / 120);
      pending.clock += dt * 1000;
      const crowd = suspended.step(dt, wallNow, pending.clock);
      const key = detectDwell(pending, suspended, crowd, pending.clock);
      if (key) spoken.push(key);
      remaining -= dt;
    }
  }
  for (let t = 10; t <= 1590; t += 10) frame(t, t - 10);
  assert.equal(pending.dwellKey, "H", "A dwell is pending just before suspension");
  assert.deepEqual(spoken, []);
  suspended.addMessage("drift", "ordinary chatter", 1590);
  if (freshVote) suspended.addMessage("fresh", "H", 11590);
  const clockBefore = pending.clock;
  frame(11590, 1590);
  assert.deepEqual(spoken, [], "A 10 s suspension must not complete the pending dwell");
  assert(!suspended.pullers.has("one"), "The old vote expires by wall time");
  assert.equal(suspended.drifters.size, 0, "Drift also expires by wall time");
  assert(Math.abs(pending.clock - clockBefore - 100) < 0.000001, "Physics advances by at most 100 ms on resume");
  if (freshVote) assert(pending.dwellStart > clockBefore, "A fresh vote starts a new dwell on resume");
  else assert.equal(pending.dwellKey, null);
}
console.log("Suspension: 10 s gap expires votes and drift, resets dwell, and caps physics at 100 ms.");

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
