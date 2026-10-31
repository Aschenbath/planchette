/* Planchette — no libraries, no assets, no secrets. */
(() => {
  "use strict";

  const WIDTH = 1600;
  const HEIGHT = 860;
  const MAX_THREADS = 80;
  const MAX_PULLERS = 700;
  const PULL_LIFETIME = 7000;
  const MAX_MESSAGE = 120;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const random = (min, max) => min + Math.random() * (max - min);

  function readOptions(search = "") {
    const params = new URLSearchParams(search);
    const numeric = (key, fallback, min, max) => {
      const raw = params.get(key);
      const value = raw === null || raw.trim() === "" ? NaN : Number(raw);
      return Number.isFinite(value) ? clamp(value, min, max) : fallback;
    };
    const rawChannel = (params.get("channel") || "").trim().replace(/^#/, "").toLowerCase();
    const channel = /^[a-z0-9_]{1,25}$/.test(rawChannel) ? rawChannel : "";
    return {
      channel,
      demo: params.get("demo") === "1" || !channel,
      dwell: numeric("dwell", 1600, 400, 10000),
      strength: numeric("strength", 1, 0.1, 5),
      theme: params.get("theme") === "parchment" ? "parchment" : "dark",
      sound: params.get("sound") !== "0",
      transparent: params.get("bg") === "0"
    };
  }

  function createGlyphs() {
    const glyphs = [];
    const arc = (letters, baseline) => {
      [...letters].forEach((key, index) => {
        const offset = index / 6 - 1;
        glyphs.push({ key, x: 300 + index * (1000 / 12), y: baseline - 174 * (1 - offset * offset), radius: 31, size: 65 });
      });
    };
    arc("ABCDEFGHIJKLM", 463);
    arc("NOPQRSTUVWXYZ", 581);
    [..."1234567890"].forEach((key, index) => glyphs.push({ key, x: 405 + index * 88, y: 655, radius: 27, size: 47 }));
    glyphs.push(
      { key: "YES", x: 345, y: 198, radius: 48, size: 46 },
      { key: "NO", x: 1255, y: 198, radius: 43, size: 46 },
      { key: "GOODBYE", x: 800, y: 756, radius: 66, size: 41 }
    );
    return glyphs;
  }

  const GLYPHS = createGlyphs();
  const GLYPH_MAP = new Map(GLYPHS.map(glyph => [glyph.key, glyph]));

  function messageWeights(message) {
    const weights = new Map();
    const add = key => weights.set(key, (weights.get(key) || 0) + 1);
    // Consume whole-word destinations first; "yesterday" still pulls its letters.
    const remaining = String(message).slice(0, 500).toUpperCase().replace(/\b(YES|NO|GOODBYE|BYE)\b/g, word => {
      add(word === "BYE" ? "GOODBYE" : word);
      return " ";
    });
    for (const character of remaining) if (GLYPH_MAP.has(character)) add(character);
    return weights;
  }

  function unescapeTag(value) {
    const escapes = { s: " ", ":": ";", r: "\r", n: "\n", "\\": "\\" };
    return value.replace(/\\(.)/g, (_, character) => escapes[character] ?? character).replace(/\\$/, "");
  }

  function parseIRC(line) {
    let rest = line;
    const tags = Object.create(null);
    let prefix = "";
    if (rest.startsWith("@")) {
      const end = rest.indexOf(" ");
      if (end < 0) return null;
      for (const entry of rest.slice(1, end).split(";")) {
        const split = entry.indexOf("=");
        tags[split < 0 ? entry : entry.slice(0, split)] = split < 0 ? "" : unescapeTag(entry.slice(split + 1));
      }
      rest = rest.slice(end + 1).trimStart();
    }
    if (rest.startsWith(":")) {
      const end = rest.indexOf(" ");
      if (end < 0) return null;
      prefix = rest.slice(1, end);
      rest = rest.slice(end + 1).trimStart();
    }
    const trailingIndex = rest.indexOf(" :");
    const trailing = trailingIndex >= 0 ? rest.slice(trailingIndex + 2) : "";
    const parts = (trailingIndex >= 0 ? rest.slice(0, trailingIndex) : rest).trim().split(/\s+/);
    const command = parts.shift();
    if (!command) return null;
    return { tags, prefix, command: command.toUpperCase(), params: parts, trailing, nick: prefix.split("!")[0] };
  }

  function isModerator(tags) {
    return (tags.badges || "").split(",").some(badge => /^(broadcaster|moderator)\//.test(badge));
  }

  class SpiritPhysics {
    constructor(strength = 1) {
      this.strength = strength;
      this.x = 800;
      this.y = 552;
      this.vx = 0;
      this.vy = 0;
      this.angle = -0.08;
      this.spin = 0;
      this.pullers = new Map();
    }

    addPull(user, weights, now) {
      if (!weights.size) return;
      // A chatter may refresh their hand, but cannot stack hundreds of hands.
      this.pullers.delete(user);
      const total = [...weights.values()].reduce((sum, count) => sum + count, 0);
      const normalized = [...weights].map(([key, count]) => [key, count / total * Math.min(3, Math.sqrt(total))]);
      this.pullers.set(user, { weights: normalized, time: now, phase: random(0, Math.PI * 2) });
      if (this.pullers.size > MAX_PULLERS) this.pullers.delete(this.pullers.keys().next().value);
    }

    aggregate(now) {
      const weights = new Map();
      let total = 0;
      for (const [user, pull] of this.pullers) {
        const age = now - pull.time;
        if (age > PULL_LIFETIME) { this.pullers.delete(user); continue; }
        const decay = Math.exp(-age / 1900);
        for (const [key, count] of pull.weights) {
          const weight = count * decay;
          weights.set(key, (weights.get(key) || 0) + weight);
          total += weight;
        }
      }
      return { weights, total };
    }

    step(dt, now) {
      const crowd = this.aggregate(now);
      if (crowd.total > 0.01) {
        let targetX = 0;
        let targetY = 0;
        for (const [key, weight] of crowd.weights) {
          const glyph = GLYPH_MAP.get(key);
          targetX += glyph.x * weight;
          targetY += glyph.y * weight;
        }
        targetX /= crowd.total;
        targetY /= crowd.total;
        // More agreement means a stiffer spring. Capping it keeps large raids stable.
        const spring = Math.min(19, 2 + Math.sqrt(crowd.total) * 2.2) * this.strength;
        this.vx += (targetX - this.x) * spring * dt;
        this.vy += (targetY - this.y) * spring * dt;
      }
      const friction = Math.exp(-5.4 * dt);
      this.vx *= friction;
      this.vy *= friction;
      const speed = Math.hypot(this.vx, this.vy);
      if (speed > 800) { this.vx *= 800 / speed; this.vy *= 800 / speed; }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      if (this.x < 190 || this.x > 1410) { this.x = clamp(this.x, 190, 1410); this.vx *= -0.2; }
      if (this.y < 148 || this.y > 770) { this.y = clamp(this.y, 148, 770); this.vy *= -0.2; }
      const desiredAngle = clamp(this.vx * 0.00065, -0.22, 0.22) + Math.sin(now / 1900) * Math.min(speed / 2000, 0.02);
      this.spin += ((desiredAngle - this.angle) * 24 - this.spin * 5) * dt;
      this.angle += this.spin * dt;
      return crowd;
    }
  }

  // These pure pieces can be checked in Node without pretending a DOM exists.
  if (typeof module !== "undefined" && module.exports) module.exports = { readOptions, createGlyphs, messageWeights, parseIRC, isModerator, SpiritPhysics };
  if (typeof document === "undefined") return;

  const $ = id => document.getElementById(id);
  let options = readOptions(location.search);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  if (!ctx) { $("connection-status").textContent = "Canvas is unavailable in this browser."; return; }
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const physics = new SpiritPhysics(options.strength);
  const state = {
    message: "", history: [], session: 1, dwellKey: null, dwellStart: 0, spoken: null,
    pulseKey: null, pulseTime: -Infinity, particles: [], recentMessages: [], chatters: new Map(),
    rateBucket: 0, bucketCount: 0, dirtyStats: true, paused: false, clock: 0,
    demoTarget: null, demoNext: 0, demoAdvance: Infinity, demoIndex: 0, demoPhrase: 0,
    demoStarted: 0, audio: null, audioReady: false, socket: null, generation: 0,
    reconnectTimer: null, watchdog: null, reconnectAttempt: 0, connected: false,
    lastTraffic: 0, awaitingPong: false, buffer: "", displayScale: 1
  };
  const DEMO_PHRASES = ["HELLO", "IS ANYONE THERE", "YES", "STAY AWHILE", "WE SEE YOU", "NO", "BOO", "GOOD VIBES"];
  const DEMO_USERS = ["velvet_moth", "candlekeeper", "little_omen", "ghost_in_chat", "midnighttea", "moonmilk", "the_last_lantern", "mossandbones", "soft_static", "hauntedtoast", "hushhush", "sleepy_spectre", "wisp_13", "cryptid_cutie", "old_soul", "lost_in_the_fog", "the_oracle", "coppermoon", "echoes", "not_a_ghost", "seance_enjoyer", "mothman_lives", "spookybeans", "nocturne"];

  let palette;
  let staticBoard;
  let pixelRatio = 1;
  const serif = '"Board Serif", "Palatino Linotype", "Book Antiqua", Georgia, serif';

  function path(context, points) {
    context.beginPath();
    for (const segment of points) context[segment[0]](...segment.slice(1));
  }

  function star(context, x, y, radius, points = 4) {
    context.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = i * Math.PI / points - Math.PI / 2;
      const length = i % 2 ? radius * 0.23 : radius;
      context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    }
    context.closePath();
    context.fill();
  }

  function lettering(context, text, x, y, size, tracking = 0) {
    context.font = `${size}px ${serif}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    if (!tracking) { context.fillText(text, x, y); return; }
    const widths = [...text].map(letter => context.measureText(letter).width);
    let left = x - (widths.reduce((sum, width) => sum + width, 0) + tracking * (text.length - 1)) / 2;
    [...text].forEach((letter, index) => { context.fillText(letter, left + widths[index] / 2, y); left += widths[index] + tracking; });
  }

  function ornament(context, x, y, direction) {
    context.save();
    context.translate(x, y);
    context.scale(direction, 1);
    context.strokeStyle = palette.trim;
    context.lineWidth = 1.4;
    path(context, [["moveTo", 0, 58], ["bezierCurveTo", 4, 25, 28, 7, 66, 0], ["moveTo", 4, 43], ["bezierCurveTo", 14, 10, 54, 9, 54, 24], ["bezierCurveTo", 54, 42, 28, 41, 28, 25], ["bezierCurveTo", 29, 16, 45, 17, 41, 27], ["moveTo", 17, 53], ["bezierCurveTo", 60, 61, 68, 38, 93, 34]]);
    context.stroke();
    context.fillStyle = palette.trim;
    star(context, 76, 15, 7);
    context.restore();
  }

  function sun(context, x, y) {
    context.save();
    context.translate(x, y);
    context.strokeStyle = palette.trim;
    context.fillStyle = palette.trim;
    context.lineWidth = 1.25;
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      context.beginPath();
      context.moveTo(Math.cos(angle) * 34, Math.sin(angle) * 34);
      context.lineTo(Math.cos(angle + 0.025) * (i % 2 ? 45 : 56), Math.sin(angle + 0.025) * (i % 2 ? 45 : 56));
      context.stroke();
    }
    context.beginPath(); context.arc(0, 0, 28, 0, Math.PI * 2); context.stroke();
    context.beginPath(); context.arc(0, 0, 31, 0, Math.PI * 2); context.stroke();
    path(context, [["moveTo", -15, -5], ["quadraticCurveTo", -9, -11, -4, -5], ["moveTo", 4, -5], ["quadraticCurveTo", 9, -11, 15, -5], ["moveTo", 0, -3], ["lineTo", -3, 8], ["lineTo", 3, 8], ["moveTo", -8, 14], ["quadraticCurveTo", 0, 19, 8, 14]]); context.stroke();
    context.restore();
  }

  function moon(context, x, y) {
    context.save(); context.translate(x, y);
    context.strokeStyle = palette.trim; context.fillStyle = palette.trim; context.lineWidth = 1.4;
    path(context, [["moveTo", 9, -38], ["bezierCurveTo", -53, -35, -47, 44, 12, 37], ["bezierCurveTo", -17, 24, -22, -11, 9, -38]]); context.stroke();
    path(context, [["moveTo", -4, -17], ["quadraticCurveTo", -13, -10, -9, -6], ["lineTo", -3, -3], ["lineTo", -10, 1], ["moveTo", -8, 11], ["quadraticCurveTo", -13, 16, -17, 11]]); context.stroke();
    star(context, 29, -21, 9); star(context, 44, 9, 5); star(context, 20, 33, 5);
    context.restore();
  }

  function drawStaticBoard() {
    const parchment = options.theme === "parchment";
    palette = parchment ? {
      board: "#d9c49a", center: "#eeddbc", edge: "#bca174", ink: "#4b3524", trim: "#79582d", faint: "#937246", thread: "128,80,29", light: "#9b6221", wood: "#88602d"
    } : {
      board: "#20221b", center: "#292d22", edge: "#151812", ink: "#d7c590", trim: "#9c8652", faint: "#665e3c", thread: "224,195,116", light: "#eed497", wood: "#9d713d"
    };
    staticBoard = document.createElement("canvas");
    staticBoard.width = canvas.width; staticBoard.height = canvas.height;
    const context = staticBoard.getContext("2d");
    context.scale(pixelRatio, pixelRatio);
    context.beginPath(); context.roundRect(0, 0, WIDTH, HEIGHT, 18); context.clip();
    const background = context.createRadialGradient(800, 360, 20, 800, 430, 880);
    background.addColorStop(0, palette.center); background.addColorStop(0.63, palette.board); background.addColorStop(1, palette.edge);
    context.fillStyle = background; context.fillRect(0, 0, WIDTH, HEIGHT);
    // Seeded grain is baked once, never generated in the animation loop.
    let seed = 41;
    const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 14500; i++) {
      context.fillStyle = i % 3 ? "rgba(255,225,170,.028)" : "rgba(0,0,0,.065)";
      context.fillRect(noise() * WIDTH, noise() * HEIGHT, noise() * 2 + 0.3, noise() + 0.4);
    }
    for (let i = 0; i < 75; i++) {
      context.strokeStyle = parchment ? "rgba(94,63,28,.025)" : "rgba(167,151,103,.018)";
      context.lineWidth = random(0.3, 1);
      const y = noise() * HEIGHT;
      path(context, [["moveTo", 0, y], ["bezierCurveTo", 500, y - 15, 1100, y + 15, WIDTH, y]]); context.stroke();
    }
    context.strokeStyle = palette.trim;
    context.lineWidth = 1.3;
    context.beginPath(); context.roundRect(17, 17, 1566, 826, 9); context.stroke();
    context.globalAlpha = 0.55; context.lineWidth = 0.7;
    context.beginPath(); context.roundRect(25, 25, 1550, 810, 5); context.stroke();
    context.beginPath(); context.roundRect(45, 45, 1510, 770, 2); context.stroke();
    context.globalAlpha = 1;
    for (const [x, y, rotation] of [[64, 64, 0], [1536, 64, Math.PI / 2], [1536, 796, Math.PI], [64, 796, -Math.PI / 2]]) {
      context.save(); context.translate(x, y); context.rotate(rotation); ornament(context, 0, 0, 1); context.restore();
    }
    context.fillStyle = palette.trim;
    lettering(context, "THE SPIRIT BOARD", 800, 92, 17, 6);
    context.strokeStyle = palette.faint; context.lineWidth = 0.8;
    path(context, [["moveTo", 514, 91], ["lineTo", 616, 91], ["moveTo", 984, 91], ["lineTo", 1086, 91]]); context.stroke();
    star(context, 498, 91, 5); star(context, 1102, 91, 5);

    // The engraved eye sits above the two alphabet arcs.
    context.save(); context.translate(800, 184);
    context.strokeStyle = palette.trim; context.lineWidth = 1.25;
    path(context, [["moveTo", -41, 0], ["quadraticCurveTo", 0, -37, 41, 0], ["quadraticCurveTo", 0, 37, -41, 0]]); context.stroke();
    context.beginPath(); context.arc(0, 0, 12, 0, Math.PI * 2); context.stroke();
    context.fillStyle = palette.trim; context.beginPath(); context.arc(0, 0, 4, 0, Math.PI * 2); context.fill();
    for (let i = 0; i < 7; i++) {
      const angle = -Math.PI + 0.25 + i / 6 * (Math.PI - 0.5);
      path(context, [["moveTo", Math.cos(angle) * 51, Math.sin(angle) * 34], ["lineTo", Math.cos(angle) * 67, Math.sin(angle) * 49]]); context.stroke();
    }
    context.restore();
    context.fillStyle = palette.faint;
    lettering(context, "LET THE UNSEEN BE HEARD", 800, 242, 12, 3.5);

    sun(context, 154, 335); moon(context, 1446, 335);
    context.fillStyle = palette.trim;
    lettering(context, "AS ABOVE", 154, 412, 11, 2);
    lettering(context, "SO BELOW", 1446, 412, 11, 2);
    for (const [x, y, r] of [[185, 195, 5], [1415, 195, 5], [175, 543, 6], [1430, 534, 6], [218, 664, 4], [1382, 664, 4], [626, 754, 6], [974, 754, 6]]) star(context, x, y, r);
    ornament(context, 254, 723, 1); ornament(context, 1346, 723, -1);
    context.strokeStyle = palette.faint; context.lineWidth = 0.6;
    path(context, [["moveTo", 470, 713], ["quadraticCurveTo", 800, 699, 1130, 713]]); context.stroke();
    for (const glyph of GLYPHS) {
      context.fillStyle = palette.ink;
      context.shadowColor = parchment ? "#fff5" : "#000a";
      context.shadowBlur = 0; context.shadowOffsetY = parchment ? -0.7 : 1.4;
      lettering(context, glyph.key, glyph.x, glyph.y, glyph.size, glyph.key.length > 1 ? 5 : 0);
      context.shadowOffsetY = 0;
    }
    context.fillStyle = palette.faint;
    lettering(context, "MANY HANDS · ONE SPIRIT", 800, 802, 10, 3);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const scale = clamp(bounds.width / WIDTH * (window.devicePixelRatio || 1), 0.5, 2);
    if (staticBoard && Math.abs(scale - pixelRatio) < 0.03) return;
    pixelRatio = scale;
    canvas.width = Math.round(WIDTH * pixelRatio); canvas.height = Math.round(HEIGHT * pixelRatio);
    state.displayScale = bounds.width / WIDTH;
    drawStaticBoard();
  }

  function drawThreads(now) {
    ctx.lineWidth = 1;
    let count = 0;
    const recent = [...physics.pullers.values()];
    for (let i = recent.length - 1; i >= 0 && count < MAX_THREADS; i--) {
      const pull = recent[i];
      const age = now - pull.time;
      if (age > PULL_LIFETIME) continue;
      const alpha = Math.exp(-age / 2100) * 0.24;
      const strongest = pull.weights.reduce((best, next) => next[1] > best[1] ? next : best);
      const glyph = GLYPH_MAP.get(strongest[0]);
      const offset = Math.sin(pull.phase) * 18;
      const bend = Math.sin(now / 1900 + pull.phase) * (reducedMotion ? 0 : 24);
      ctx.strokeStyle = `rgba(${palette.thread},${alpha})`;
      path(ctx, [["moveTo", physics.x, physics.y], ["quadraticCurveTo", (physics.x + glyph.x) / 2 + offset, (physics.y + glyph.y) / 2 + bend, glyph.x + Math.cos(pull.phase) * 9, glyph.y + Math.sin(pull.phase) * 9]]);
      ctx.stroke();
      if (age < 1100 && !reducedMotion) {
        const t = clamp(age / 1100, 0, 1);
        const x = glyph.x * (1 - t) + physics.x * t;
        const y = glyph.y * (1 - t) + physics.y * t;
        ctx.fillStyle = `rgba(${palette.thread},${alpha * 2})`;
        ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill();
      }
      count++;
    }
  }

  const woodPath = new Path2D("M 0 -106 C -23 -111 -113 11 -113 49 C -113 127 113 127 113 49 C 113 11 23 -111 0 -106 Z M 32 0 A 32 32 0 1 0 -32 0 A 32 32 0 1 0 32 0 Z");
  const woodRim = new Path2D("M 0 -95 C -19 -96 -102 15 -102 49 C -102 114 102 114 102 49 C 102 15 19 -96 0 -95 Z");
  let woodenToken;

  function bakePlanchette() {
    woodenToken = document.createElement("canvas");
    woodenToken.width = 560; woodenToken.height = 540;
    const context = woodenToken.getContext("2d");
    context.scale(2, 2); context.translate(140, 126);
    const wood = context.createLinearGradient(-100, -80, 108, 110);
    wood.addColorStop(0, "#bc955c"); wood.addColorStop(0.22, "#9d753f"); wood.addColorStop(0.55, "#795126"); wood.addColorStop(0.76, "#a47a42"); wood.addColorStop(1, "#684622");
    context.fillStyle = wood;
    context.fill(woodPath, "evenodd");
    context.save(); context.clip(woodPath, "evenodd");
    for (let i = 0; i < 105; i++) {
      const x = -120 + i * 2.4;
      context.strokeStyle = i % 3 ? "rgba(41,22,6,.14)" : "rgba(243,207,137,.12)";
      context.lineWidth = i % 3 ? 0.65 : 0.4;
      path(context, [["moveTo", x, -120], ["bezierCurveTo", x + Math.sin(i) * 16, -20, x - Math.cos(i) * 19, 50, x + Math.sin(i) * 14, 125]]); context.stroke();
    }
    context.restore();
    context.strokeStyle = "#e5c38b99"; context.lineWidth = 1.8; context.stroke(woodRim);
    context.strokeStyle = "#332310aa"; context.lineWidth = 3; context.beginPath(); context.arc(0, 0, 35, 0, Math.PI * 2); context.stroke();
    context.strokeStyle = "#ebd098bb"; context.lineWidth = 1.3; context.beginPath(); context.arc(0, 0, 32.5, 0, Math.PI * 2); context.stroke();
    context.strokeStyle = "#dfb67866"; context.lineWidth = 0.8; context.beginPath(); context.arc(0, 0, 40, 0, Math.PI * 2); context.stroke();
    context.fillStyle = "#e2c58a"; star(context, 0, -66, 10);
    context.strokeStyle = "#e2c58a99"; context.lineWidth = 0.9;
    path(context, [["moveTo", -18, 56], ["quadraticCurveTo", 0, 43, 18, 56], ["quadraticCurveTo", 0, 70, -18, 56]]); context.stroke();
    context.beginPath(); context.arc(0, 56, 5, 0, Math.PI * 2); context.stroke();
    lettering(context, "P", -52, 66, 13); lettering(context, "S", 52, 66, 13);
    context.strokeStyle = "#d4b17766";
    path(context, [["moveTo", -76, 32], ["quadraticCurveTo", -61, 41, -53, 28], ["moveTo", 76, 32], ["quadraticCurveTo", 61, 41, 53, 28]]); context.stroke();
  }

  function drawPlanchette(now) {
    ctx.save(); ctx.translate(physics.x, physics.y); ctx.rotate(physics.angle);
    const aura = ctx.createRadialGradient(0, 0, 14, 0, 0, 100);
    aura.addColorStop(0, `rgba(${palette.thread},.07)`); aura.addColorStop(1, `rgba(${palette.thread},0)`);
    ctx.fillStyle = aura; ctx.fillRect(-110, -110, 220, 220);
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 17; ctx.shadowOffsetY = 10; ctx.shadowOffsetX = 2;
    ctx.drawImage(woodenToken, -140, -126, 280, 270);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowOffsetX = 0;
    // A subtle glass reflection leaves the selected letter completely visible.
    ctx.strokeStyle = "rgba(255,235,185,.3)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 28, Math.PI * 1.05, Math.PI * 1.48); ctx.stroke();
    if (state.dwellKey) {
      const progress = clamp((now - state.dwellStart) / options.dwell, 0, 1);
      ctx.strokeStyle = palette.light; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.arc(0, 0, 36.5, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }

  function draw(now) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticBoard, 0, 0);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    if (!options.transparent && !reducedMotion) {
      const candle = ctx.createRadialGradient(130, 580, 0, 130, 580, 540);
      candle.addColorStop(0, `rgba(225,155,67,${0.032 + Math.sin(now / 811) * 0.006})`); candle.addColorStop(1, "rgba(225,155,67,0)");
      ctx.fillStyle = candle; ctx.fillRect(0, 0, 900, HEIGHT);
    }
    drawThreads(now);
    const pulseAge = now - state.pulseTime;
    if (state.pulseKey && pulseAge < 1600) {
      const glyph = GLYPH_MAP.get(state.pulseKey);
      const opacity = (1 - pulseAge / 1600) * 0.55;
      ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = palette.light;
      ctx.shadowColor = palette.light; ctx.shadowBlur = reducedMotion ? 0 : 23;
      lettering(ctx, glyph.key, glyph.x, glyph.y, glyph.size, glyph.key.length > 1 ? 5 : 0); ctx.restore();
      if (!reducedMotion) {
        ctx.strokeStyle = `rgba(${palette.thread},${opacity * 0.7})`; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(glyph.x, glyph.y, glyph.radius + pulseAge / 36, 0, Math.PI * 2); ctx.stroke();
      }
    }
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const particle = state.particles[i];
      const age = now - particle.time;
      if (age > particle.life) { state.particles.splice(i, 1); continue; }
      const t = age / particle.life;
      ctx.fillStyle = `rgba(${palette.thread},${(1 - t) * 0.65})`;
      star(ctx, particle.x + particle.vx * t, particle.y + particle.vy * t - t * 12, particle.size * (1 - t * 0.6));
    }
    drawPlanchette(now);
  }

  function updateMessage(animate = false) {
    $("message").textContent = state.message;
    $("message-placeholder").hidden = Boolean(state.message);
    $("message-count").textContent = `${String(state.message.length).padStart(2, "0")} / ${MAX_MESSAGE}`;
    if (animate && !reducedMotion) {
      $("message").classList.remove("arrived");
      void $("message").offsetWidth;
      $("message").classList.add("arrived");
    }
    const line = $("message").parentElement;
    line.scrollLeft = line.scrollWidth;
  }

  function updateHistory() {
    $("history-wrap").hidden = state.history.length === 0;
    $("history").replaceChildren(...state.history.map(message => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }));
  }

  function endSeance() {
    const message = state.message.trim();
    if (message) { state.history.unshift(message); state.history.length = Math.min(3, state.history.length); }
    state.message = "";
    state.session++;
    state.dwellKey = null;
    physics.pullers.clear();
    $("session-number").textContent = `SESSION ${String(state.session).padStart(3, "0")}`;
    updateMessage(); updateHistory();
    $("announcement").textContent = message ? `Séance complete. Message: ${message}` : "A new séance begins.";
  }

  function startSeance() {
    state.message = ""; state.dwellKey = null;
    physics.pullers.clear();
    state.session++;
    $("session-number").textContent = `SESSION ${String(state.session).padStart(3, "0")}`;
    updateMessage();
    $("announcement").textContent = "The circle is open. A new séance begins.";
  }

  function unlockAudio() {
    if (!options.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      if (!state.audio) state.audio = new Audio();
      const ready = () => { state.audioReady = state.audio.state === "running"; updateSoundButton(); };
      state.audio.resume().then(ready).catch(() => { state.audioReady = false; updateSoundButton(); });
    } catch (_) { state.audioReady = false; }
    updateSoundButton();
  }

  function updateSoundButton() {
    const enabled = options.sound && state.audioReady;
    $("sound-toggle").setAttribute("aria-pressed", String(enabled));
    $("sound-toggle").setAttribute("aria-label", enabled ? "Mute sound" : "Enable sound");
    $("sound-toggle").title = enabled ? "Mute sound (M)" : "Enable sound (M)";
  }

  function playChime(key) {
    if (!options.sound || !state.audioReady || state.audio.state !== "running") return;
    const audio = state.audio;
    const now = audio.currentTime;
    const index = GLYPHS.findIndex(glyph => glyph.key === key);
    const note = key === "GOODBYE" ? 220 : [261.63, 293.66, 329.63, 392, 440][index % 5];
    [1, 2.002].forEach((multiple, i) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(note * multiple, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(i ? 0.012 : 0.045, now + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
      oscillator.connect(gain); gain.connect(audio.destination);
      oscillator.start(now); oscillator.stop(now + 1.6);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    });
  }

  function speak(key, now) {
    state.spoken = key; state.pulseKey = key; state.pulseTime = now;
    playChime(key);
    const glyph = GLYPH_MAP.get(key);
    if (!reducedMotion) {
      for (let i = 0; i < 16; i++) state.particles.push({ x: glyph.x, y: glyph.y, vx: random(-75, 75), vy: random(-55, 55), size: random(1, 3.5), time: now, life: random(800, 1800) });
      state.particles = state.particles.slice(-96);
    }
    if (key === "GOODBYE") endSeance();
    else {
      const addition = key.length > 1 ? `${state.message && !state.message.endsWith(" ") ? " " : ""}${key} ` : key;
      state.message = (state.message + addition).slice(0, MAX_MESSAGE);
      updateMessage(true);
    }
    if (options.demo && key === state.demoTarget) state.demoAdvance = now + (key === "GOODBYE" ? 2600 : 1300);
  }

  function updateDwell(now) {
    const speed = Math.hypot(physics.vx, physics.vy);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const glyph of GLYPHS) {
      const distance = Math.hypot(physics.x - glyph.x, physics.y - glyph.y);
      if (distance < glyph.radius && distance < nearestDistance) { nearest = glyph; nearestDistance = distance; }
    }
    // Hysteresis prevents jitter on a window edge from re-speaking the same glyph.
    if (state.spoken) {
      const last = GLYPH_MAP.get(state.spoken);
      if (Math.hypot(physics.x - last.x, physics.y - last.y) > last.radius + 14) state.spoken = null;
    }
    if (!nearest || speed > 25 || state.spoken === nearest.key) { state.dwellKey = null; return; }
    if (state.dwellKey !== nearest.key) { state.dwellKey = nearest.key; state.dwellStart = now; }
    if (now - state.dwellStart >= options.dwell) { speak(nearest.key, now); state.dwellKey = null; }
  }

  function receiveChat(user, message, tags = {}) {
    const wallNow = performance.now();
    const bucket = Math.floor(wallNow / 1000);
    const latest = state.recentMessages[state.recentMessages.length - 1];
    if (latest && latest.second === bucket) latest.count++;
    else state.recentMessages.push({ second: bucket, count: 1 });
    if (!state.chatters.has(user) && state.chatters.size >= 10000) state.chatters.delete(state.chatters.keys().next().value);
    state.chatters.set(user, wallNow);
    state.dirtyStats = true;
    const command = message.trim().toLowerCase();
    if (command === "!seance" || command === "!goodbye") {
      if (isModerator(tags)) {
        if (command === "!seance") startSeance();
        else { playChime("GOODBYE"); endSeance(); }
      }
      return;
    }
    if (state.rateBucket !== bucket) { state.rateBucket = bucket; state.bucketCount = 0; }
    // Count all traffic; bound physics ingestion during unusually large raids.
    if (++state.bucketCount > 300) return;
    physics.addPull(user, messageWeights(message), state.clock);
  }

  function updateStats(wallNow) {
    const second = Math.floor(wallNow / 1000);
    while (state.recentMessages.length && second - state.recentMessages[0].second >= 60) state.recentMessages.shift();
    for (const [user, time] of state.chatters) if (wallNow - time > 30000) state.chatters.delete(user);
    $("chatter-count").textContent = state.chatters.size >= 10000 ? "10,000+" : state.chatters.size.toLocaleString();
    $("message-rate").textContent = state.recentMessages.reduce((sum, entry) => sum + entry.count, 0).toLocaleString();
    if (state.paused) $("dwell-indicator").textContent = "THE CIRCLE IS STILL";
    else if (state.dwellKey) $("dwell-indicator").textContent = `${state.dwellKey} · ${Math.min(100, Math.floor((state.clock - state.dwellStart) / options.dwell * 100))}% MANIFESTED`;
    else $("dwell-indicator").textContent = state.spoken ? `${state.spoken} · A SIGN RECEIVED` : "WAITING FOR A SIGN";
    state.dirtyStats = false;
  }

  function demoTokens() {
    const phrase = DEMO_PHRASES[state.demoPhrase % DEMO_PHRASES.length];
    return phrase === "YES" || phrase === "NO" ? [phrase, "GOODBYE"] : [...phrase, "GOODBYE"];
  }

  function advanceDemo(now) {
    let tokens = demoTokens();
    state.demoIndex++;
    if (state.demoIndex >= tokens.length) { state.demoIndex = 0; state.demoPhrase++; tokens = demoTokens(); }
    // Word boundaries are typographic spaces, not extra destinations on the board.
    while (tokens[state.demoIndex] === " ") {
      if (state.message && !state.message.endsWith(" ")) { state.message = (state.message + " ").slice(0, MAX_MESSAGE); updateMessage(); }
      state.demoIndex++;
    }
    const next = tokens[state.demoIndex];
    if (next === state.demoTarget) {
      // Repeated letters must leave the window and return, just like live chat.
      state.demoTarget = "__wander";
      state.demoAdvance = now + 2200;
      state.demoIndex--;
    } else {
      state.demoTarget = next;
      state.demoAdvance = Infinity;
    }
    state.demoStarted = now;
  }

  function runDemo(now) {
    if (now >= state.demoAdvance) advanceDemo(now);
    if (!state.demoTarget) { state.demoTarget = demoTokens()[0]; state.demoStarted = now; }
    if (now < state.demoNext) return;
    state.demoNext = now + random(95, 185);
    const convergence = clamp((now - state.demoStarted) / 2100, 0.12, 1);
    const letter = state.demoTarget === "__wander" ? "AZ" : Math.random() < convergence ? state.demoTarget : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(random(0, 26))];
    const user = DEMO_USERS[Math.floor(random(0, DEMO_USERS.length))];
    const message = letter.length > 1 ? letter.toLowerCase() : letter.repeat(Math.floor(random(1, 4)));
    receiveChat(user, message);
  }

  function setConnection(label, kind = "connected") {
    $("connection-status").textContent = label;
    $("connection-dot").className = `connection-dot${kind === "connected" ? "" : ` ${kind}`}`;
  }

  function stopChat() {
    state.generation++;
    clearTimeout(state.reconnectTimer); clearInterval(state.watchdog);
    state.reconnectTimer = null; state.watchdog = null;
    state.connected = false;
    if (state.socket) { state.socket.onclose = null; state.socket.close(); state.socket = null; }
    state.buffer = "";
  }

  function connectChat() {
    if (options.demo) return;
    const generation = ++state.generation;
    const channel = options.channel;
    state.connected = false; state.buffer = ""; state.awaitingPong = false;
    setConnection(`Opening the circle · #${channel}`, "pending");
    const current = () => generation === state.generation && !options.demo;
    const retry = () => {
      if (!current()) return;
      clearInterval(state.watchdog);
      state.connected = false;
      const wait = Math.min(30000, 1000 * 2 ** Math.min(state.reconnectAttempt++, 5)) + random(0, 600);
      setConnection(`Reconnecting · #${channel} · ${Math.ceil(wait / 1000)}s`, "pending");
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = setTimeout(connectChat, wait);
    };
    let socket;
    try { socket = new WebSocket("wss://irc-ws.chat.twitch.tv:443"); }
    catch (_) { setConnection("WebSocket unavailable; retrying…", "error"); retry(); return; }
    state.socket = socket;
    const nick = `justinfan${Math.floor(random(10000, 999999))}`;
    const openedAt = performance.now();
    const joined = () => {
      state.connected = true; state.reconnectAttempt = 0;
      setConnection(`Connected · #${channel}`);
    };
    state.watchdog = setInterval(() => {
      if (!current()) return;
      const now = performance.now();
      if ((!state.connected && now - openedAt > 20000) || (state.awaitingPong && now - state.lastTraffic > 15000)) { socket.close(); return; }
      if (socket.readyState === WebSocket.OPEN && now - state.lastTraffic > 60000) {
        socket.send("PING :planchette\r\n"); state.awaitingPong = true; state.lastTraffic = now;
      }
    }, 5000);
    socket.onopen = () => {
      if (!current()) { socket.close(); return; }
      state.lastTraffic = performance.now();
      socket.send(`CAP REQ :twitch.tv/tags twitch.tv/commands\r\nPASS SCHMOOPIIE\r\nNICK ${nick}\r\nJOIN #${channel}\r\n`);
      setConnection(`Joining · #${channel}`, "pending");
    };
    socket.onmessage = event => {
      if (!current() || typeof event.data !== "string") return;
      state.lastTraffic = performance.now(); state.awaitingPong = false;
      state.buffer += event.data;
      if (state.buffer.length > 262144) { state.buffer = ""; socket.close(); return; }
      const lines = state.buffer.split("\r\n");
      state.buffer = lines.pop();
      for (const line of lines) {
        const message = parseIRC(line);
        if (!message) continue;
        if (message.command === "PING") { socket.send(`PONG :${message.trailing || message.params[0] || "tmi.twitch.tv"}\r\n`); continue; }
        if (message.command === "RECONNECT") { socket.close(); continue; }
        if ((message.command === "JOIN" && message.nick === nick) || (message.command === "366" && message.params.includes(`#${channel}`))) joined();
        if (message.command === "PRIVMSG" && message.params[0] === `#${channel}`) {
          if (!state.connected) joined();
          receiveChat(message.tags["user-id"] || message.nick, message.trailing, message.tags);
        }
        if (message.command === "NOTICE") {
          const id = message.tags["msg-id"] || "";
          if (/suspended|login_authentication_failed|msg_banned|msg_room_not_found/.test(id) || /authentication failed/i.test(message.trailing)) {
            setConnection(`Cannot join #${channel}. Check the channel in settings.`, "error");
            state.generation++; clearInterval(state.watchdog); socket.close();
          }
        }
      }
    };
    socket.onerror = () => { if (current()) setConnection(`Connection interrupted · #${channel}`, "error"); };
    socket.onclose = retry;
  }

  function refreshAppearance() {
    document.body.dataset.theme = options.theme;
    document.body.classList.toggle("transparent", options.transparent);
    document.querySelector('meta[name="theme-color"]').content = options.theme === "parchment" ? "#e2d6bc" : "#11120f";
    $("mode-label").textContent = options.demo ? "DEMO SÉANCE" : `LIVE SÉANCE · #${options.channel.toUpperCase()}`;
    $("pause-toggle").hidden = !options.demo;
    $("footer-hint").textContent = options.demo ? "An imaginary crowd. A very real pull." : "Chat a letter. Follow the threads.";
    updateSoundButton();
  }

  function saveURL() {
    const params = new URLSearchParams();
    if (options.channel) params.set("channel", options.channel);
    if (options.demo) params.set("demo", "1");
    if (options.dwell !== 1600) params.set("dwell", String(options.dwell));
    if (options.strength !== 1) params.set("strength", String(options.strength));
    if (options.theme !== "dark") params.set("theme", options.theme);
    if (!options.sound) params.set("sound", "0");
    if (options.transparent) params.set("bg", "0");
    try { history.replaceState(null, "", `${location.pathname}?${params}${location.hash}`); } catch (_) { /* Some file:// browser sources disallow replacing history. */ }
  }

  function toggleSound() {
    if (options.sound && state.audioReady) { options.sound = false; updateSoundButton(); }
    else { options.sound = true; unlockAudio(); }
    saveURL();
  }

  function togglePause() {
    if (!options.demo) return;
    state.paused = !state.paused;
    $("pause-toggle").setAttribute("aria-pressed", String(state.paused));
    $("pause-toggle").setAttribute("aria-label", state.paused ? "Resume demo" : "Pause demo");
    $("pause-toggle").title = state.paused ? "Resume demo (Space)" : "Pause demo (Space)";
    $("pause-icon").setAttribute("d", state.paused ? "m8 5 10 7-10 7Z" : "M8 5v14M16 5v14");
    setConnection(state.paused ? "Demo paused · the spirits are resting" : "Offline demo · the spirits are here", state.paused ? "pending" : "connected");
  }

  function openSettings() {
    $("channel").value = options.demo ? "" : options.channel;
    $("theme").value = options.theme;
    if (![...$("dwell").options].some(option => Number(option.value) === options.dwell)) {
      const option = document.createElement("option"); option.value = String(options.dwell); option.textContent = `${options.dwell / 1000} seconds`; $("dwell").append(option);
    }
    $("dwell").value = String(options.dwell);
    $("strength").min = String(Math.min(0.2, options.strength));
    $("strength").max = String(Math.max(3, options.strength));
    $("strength").value = String(options.strength);
    $("strength-value").value = `${options.strength.toFixed(1)}×`;
    $("setting-sound").checked = options.sound;
    $("setting-bg").checked = options.transparent;
    $("settings").showModal();
  }

  $("settings-open").addEventListener("click", openSettings);
  $("settings-close").addEventListener("click", () => $("settings").close());
  $("settings").addEventListener("click", event => { if (event.target === $("settings")) { const r = $("settings").getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $("settings").close(); } });
  $("strength").addEventListener("input", () => { $("strength-value").value = `${Number($("strength").value).toFixed(1)}×`; });
  $("settings-form").addEventListener("submit", event => {
    event.preventDefault();
    const channel = $("channel").value.trim().toLowerCase();
    const sourceChanged = options.demo !== !channel || (!options.demo && options.channel !== channel);
    options = { channel, demo: !channel, theme: $("theme").value, dwell: Number($("dwell").value), strength: Number($("strength").value), sound: $("setting-sound").checked, transparent: $("setting-bg").checked };
    physics.strength = options.strength;
    if (sourceChanged) {
      stopChat(); state.reconnectAttempt = 0;
      physics.pullers.clear(); state.chatters.clear(); state.recentMessages = [];
      state.demoTarget = null; state.demoIndex = 0; state.demoPhrase = 0; state.demoAdvance = Infinity;
      state.paused = false;
      $("pause-toggle").setAttribute("aria-pressed", "false");
      $("pause-toggle").setAttribute("aria-label", "Pause demo");
      $("pause-icon").setAttribute("d", "M8 5v14M16 5v14");
      startSeance();
      if (options.demo) setConnection("Offline demo · the spirits are here"); else connectChat();
    }
    refreshAppearance(); drawStaticBoard(); saveURL(); unlockAudio();
    $("settings").close();
  });
  $("sound-toggle").addEventListener("click", toggleSound);
  $("pause-toggle").addEventListener("click", togglePause);
  $("end-session").addEventListener("click", () => {
    playChime("GOODBYE"); endSeance();
    if (options.demo) { state.demoPhrase++; state.demoIndex = 0; state.demoTarget = null; state.demoAdvance = Infinity; }
  });
  document.addEventListener("pointerdown", event => { if (event.target.closest && !event.target.closest("#sound-toggle")) unlockAudio(); }, { passive: true });
  document.addEventListener("keydown", event => {
    if (event.target.matches("input,select,textarea,button,a") || $("settings").open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.toLowerCase() === "m") { toggleSound(); event.preventDefault(); }
    if (event.code === "Space" && options.demo) { togglePause(); event.preventDefault(); }
  });
  window.addEventListener("resize", resize);
  window.addEventListener("offline", () => { if (!options.demo) setConnection("Offline · waiting for a connection", "error"); });
  window.addEventListener("online", () => { if (!options.demo && !state.connected) { stopChat(); state.reconnectAttempt = 0; connectChat(); } });
  window.addEventListener("pagehide", stopChat);
  window.addEventListener("pageshow", event => { if (event.persisted && !options.demo) connectChat(); });

  let previousFrame = performance.now();
  let lastStats = -Infinity;
  function frame(wallNow) {
    // Fixed small steps make damping independent of frame rate and recover from OBS pauses.
    let remaining = Math.min((wallNow - previousFrame) / 1000, 0.1);
    previousFrame = wallNow;
    if (!state.paused) {
      while (remaining > 0.00001) {
        const dt = Math.min(remaining, 1 / 120);
        state.clock += dt * 1000;
        if (options.demo) runDemo(state.clock);
        physics.step(dt, state.clock); updateDwell(state.clock);
        remaining -= dt;
      }
    }
    draw(state.clock);
    if (wallNow - lastStats >= 250) { updateStats(wallNow); lastStats = wallNow; }
    requestAnimationFrame(frame);
  }

  refreshAppearance(); resize(); bakePlanchette(); updateMessage();
  if (document.fonts) document.fonts.ready.then(drawStaticBoard);
  if (options.demo) setConnection("Offline demo · the spirits are here"); else connectChat();
  requestAnimationFrame(frame);
})();
