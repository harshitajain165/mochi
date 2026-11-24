// Mochi — renderer: mic capture → main (→ Smallest Pulse), command
// handling, Mochi's animation state machine, and drawing.
//
// Movement and transitions are real animation frames cut from the reference
// video (anim/manifest.js): getting up from a sit and walking off, a walk
// cycle, crouch + take-off, a bounding run, landing and settling, sitting
// back down, and easing into a stretch. Resting poses and tricks come from
// the character sheet (cat.js) with a light rig so tails and heads stay alive.
// A small graph decides which clip leads into which, so every change of
// state plays its in-between frames instead of snapping.

(() => {
  const bridge = window.petBridge;
  const S = 0.85;                 // sheet px → screen px
  const GROUND = 12;              // px from window bottom to paws
  const MARGIN = 190;
  const WALK_V = 68;              // px/s, matches the video's walk (no foot slide)
  const RUN_V = 430;              // px/s average for the bounding run
  const VIDEO_FPS = 24;
  const RUN_FPS = 30;
  const TEMP_MS = 2600;

  // ---------- clips (video frame indices) ----------
  const R = (a, b) => {
    const o = [];
    if (a <= b) for (let i = a; i <= b; i++) o.push(i); else for (let i = a; i >= b; i--) o.push(i);
    return o.filter((i) => ANIM.frames[i]);
  };
  const CLIP = {
    getUp: R(12, 39),                    // sit → rise → first steps (flows into walk)
    rise: R(12, 30),                     // sit → up, quicker, before a sprint
    standUp: R(12, 26),                  // sit → standing
    sitDown: R(26, 12),                  // standing → sit
    walk: R(40, 65),                     // one full stride, loops
    takeoff: R(66, 75),                  // gather + crouch + push
    bound: [...R(71, 75), ...R(81, 100)],// push → flight → land → gather, loops
    land: R(93, 119),                    // touch down, settle low, walk out, stand
    pounce: [...R(66, 75), ...R(81, 119)],
    stretchIn: R(160, 173),
    stretchOut: R(173, 160),
  };
  const STAND = 119;

  function frameSpeed(f, ctx) {
    switch (ctx) {
      case 'walk': return WALK_V;
      case 'getUp': return f < 22 ? 0 : WALK_V * Math.min(1, (f - 21) / 8);
      case 'takeoff': return f <= 70 ? WALK_V : RUN_V * 0.55;
      case 'bound': case 'land': case 'pounce': {
        const k = ctx === 'pounce' ? 0.7 : 1;
        if (f <= 70) return WALK_V;
        if (f <= 75) return RUN_V * 0.6 * k;
        if (f <= 92) return RUN_V * 1.25 * k;
        if (f <= 100) return RUN_V * 0.55 * k;
        if (f <= 112) return RUN_V * 0.55 * k * (1 - (f - 100) / 12);
        return 0;
      }
      default: return 0;
    }
  }
  const LAND_DIST = CLIP.land.reduce((s, f) => s + frameSpeed(f, 'land') / RUN_FPS, 0);
  const POUNCE_DIST = CLIP.pounce.reduce((s, f) => s + frameSpeed(f, 'pounce') / RUN_FPS, 0);

  // ---------- canvases: shadow (2D) < cat (WebGL) < fx (2D) ----------
  const shadowCv = document.getElementById('shadow');
  const glCv = document.getElementById('stage');
  const fxCv = document.getElementById('fx');
  const sctx = shadowCv.getContext('2d');
  const fctx = fxCv.getContext('2d');
  const mesh = MeshGL.create(glCv);
  let VW = 0, VH = 0, DPR = 1;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    VW = window.innerWidth; VH = window.innerHeight;
    for (const cv of [shadowCv, glCv, fxCv]) {
      cv.width = Math.round(VW * DPR);
      cv.height = Math.round(VH * DPR);
    }
    sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- state ----------
  const pet = {
    x: VW * 0.62,
    facing: -1,           // 1 = right, -1 = left
    rest: 'sit',          // stand | sit | lie | sleep  (when no clip is playing)
    anim: null,           // { frames, i, acc, fps, loop, ctx, done }
    gait: null,           // walk | run while travelling
    target: null,
    after: 'stand',       // what to do on arrival: a rest pose, 'stretch' or 'trick:<pose>'
    braking: false,
    turnAfterLand: null,
    hold: null,           // { frame, until, then }  (stretch hold)
    temp: null,           // { pose, until }  sheet trick
    queue: [],            // dance steps
    t: 0,
    lastCmdAt: performance.now(),
    meowUntil: 0,
    pendingRest: null,
  };
  const particles = [];
  let wobbleAt = -1e9;
  let lastKey = '';
  let advanced = false;

  const groundY = () => VH - GROUND;
  const clampX = (x) => Math.max(MARGIN, Math.min(VW - MARGIN, x));
  const moving = () => !!pet.gait;

  // ---------- clip player ----------
  function play(name, opts = {}) {
    pet.anim = {
      frames: CLIP[name], i: 0, acc: 0,
      fps: opts.fps || VIDEO_FPS, loop: !!opts.loop,
      ctx: opts.ctx || name, done: opts.done || null,
    };
  }
  const curFrame = () => pet.anim && pet.anim.frames[pet.anim.i];

  function advance() {
    const A = pet.anim;
    advanced = true;
    if (A.ctx === 'bound' && pet.braking && A.frames[A.i] === 92) {
      play('land', { fps: RUN_FPS, done: landed });
      return;
    }
    if (A.i < A.frames.length - 1) { A.i++; return; }
    if (A.loop) { A.i = 0; return; }
    pet.anim = null;
    if (A.done) A.done();
    // a rest command that arrived mid-transition
    if (!pet.anim && !pet.gait && !pet.hold && pet.pendingRest) {
      const r = pet.pendingRest; pet.pendingRest = null; settle(r);
    }
  }

  // ---------- transitions ----------
  function standFromRest(then) {
    pet.temp = null;
    if (pet.rest === 'stand') return then();
    if (pet.rest === 'lie' || pet.rest === 'sleep') pet.rest = 'sit';
    play('standUp', { done: () => { pet.rest = 'stand'; then(); } });
  }

  function settle(what) {
    pet.after = 'stand';
    if (!what || what === 'stand') { pet.rest = 'stand'; return; }
    if (what === 'stretch') return doStretch();
    if (what.startsWith('trick:')) { pet.rest = 'stand'; return trick(what.slice(6)); }
    // sit / lie / sleep: sit down first (real in-between frames), then the pose
    if (pet.rest === 'stand') {
      play('sitDown', { done: () => { pet.rest = what; } });
    } else {
      pet.rest = what;
    }
  }

  function arrive() {
    pet.gait = null; pet.target = null; pet.braking = false; pet.anim = null;
    pet.rest = 'stand';
    const t = pet.turnAfterLand; pet.turnAfterLand = null;
    if (t) { pet.facing = -pet.facing; startMove(t.gait, t.x, t.after); return; }
    settle(pet.after);
  }
  function landed() { arrive(); }

  function startMove(gait, x, after = 'stand') {
    pet.temp = null; pet.hold = null; pet.queue = [];
    const tx = clampX(x);
    const dir = tx >= pet.x ? 1 : -1;
    if (moving()) {
      if (dir !== pet.facing) {
        if (pet.gait === 'run') { pet.braking = true; pet.turnAfterLand = { gait, x: tx, after }; return; }
        pet.facing = dir;
      }
      pet.target = tx; pet.after = after;
      if (gait === 'run' && pet.gait === 'walk') {
        pet.gait = 'run';
        play('takeoff', { fps: RUN_FPS, done: () => play('bound', { loop: true, fps: RUN_FPS }) });
      } else if (gait === 'walk' && pet.gait === 'run') {
        pet.braking = true; pet.after = after;
      }
      return;
    }
    if (Math.abs(tx - pet.x) < 12) return settle(after);
    pet.target = tx; pet.after = after; pet.gait = gait; pet.braking = false;
    if (dir !== pet.facing) pet.facing = dir;
    const sprint = () => play('takeoff', { fps: RUN_FPS, done: () => play('bound', { loop: true, fps: RUN_FPS }) });
    if (pet.rest === 'stand') {
      if (gait === 'walk') play('walk', { loop: true }); else sprint();
      return;
    }
    if (pet.rest === 'lie' || pet.rest === 'sleep') pet.rest = 'sit';
    if (gait === 'walk') play('getUp', { done: () => play('walk', { loop: true }) });
    else play('rise', { ctx: 'getUp', fps: RUN_FPS, done: sprint });
  }

  function stop(after = 'stand') {
    if (!moving()) return settle(after);
    pet.after = after;
    pet.turnAfterLand = null;
    if (pet.gait === 'run') pet.braking = true;
    else arrive();
  }

  function runAcross(dir) {
    if (dir == null) {
      dir = pet.facing;
      if ((dir > 0 && pet.x > VW - MARGIN - 200) || (dir < 0 && pet.x < MARGIN + 200)) dir = -dir;
    }
    startMove('run', dir > 0 ? VW - MARGIN : MARGIN);
  }

  function pounce() {
    if (pet.gait === 'run') return;
    pet.temp = null; pet.hold = null;
    // face away from a nearby edge
    if (pet.x + pet.facing * (POUNCE_DIST + 40) > VW - 140 || pet.x + pet.facing * (POUNCE_DIST + 40) < 140) pet.facing = -pet.facing;
    pet.gait = null; pet.target = null;
    const go = () => play('pounce', { fps: RUN_FPS, done: () => { pet.rest = 'stand'; settle(pet.after); } });
    if (pet.anim && (pet.anim.ctx === 'walk')) return go();
    if (pet.rest === 'stand') return go();
    if (pet.rest === 'lie' || pet.rest === 'sleep') pet.rest = 'sit';
    play('rise', { ctx: 'still', fps: RUN_FPS, done: go });
  }

  function doStretch() {
    pet.temp = null;
    play('stretchIn', { fps: 16, ctx: 'still', done: () => {
      pet.hold = { frame: 173, until: performance.now() + 2200, then: () => {
        play('stretchOut', { fps: 20, ctx: 'still', done: () => { pet.rest = 'sit'; } });
      } };
    } });
  }

  function trick(pose, ms = TEMP_MS) {
    if (moving()) return stop('trick:' + pose);
    pet.anim = null; pet.hold = null;
    pet.temp = { pose, until: performance.now() + ms };
  }

  function burst(kind, n) {
    const top = currentHeight();
    for (let i = 0; i < n; i++) {
      particles.push({
        kind,
        x: pet.x + (Math.random() - 0.5) * 90,
        y: top * (0.55 + Math.random() * 0.35),
        vx: (Math.random() - 0.5) * 30,
        vy: 35 + Math.random() * 40,
        life: 1.5 + Math.random() * 0.8,
        age: 0,
        spin: Math.random() * Math.PI,
      });
    }
  }

  // ---------- commands ----------
  async function execute(cmd) {
    pet.lastCmdAt = performance.now();
    if (cmd !== 'dance') pet.queue = [];
    switch (cmd) {
      case 'sit': case 'lie': case 'sleep':
        if (moving()) stop(cmd);
        else if (pet.anim || pet.hold) { pet.pendingRest = cmd; }
        else { pet.temp = null; settle(cmd); }
        break;
      case 'stand': case 'wake':
        if (moving()) stop('stand');
        else { pet.temp = null; standFromRest(() => {}); }
        break;
      case 'stop':
        if (moving()) stop('stand'); else { pet.temp = null; }
        break;
      case 'run': runAcross(); break;
      case 'run_left': runAcross(-1); break;
      case 'run_right': runAcross(1); break;
      case 'walk': startMove('walk', pet.x + pet.facing * 420); break;
      case 'jump': pounce(); break;
      case 'stretch':
        if (moving()) stop('stretch'); else if (!pet.anim) doStretch();
        break;
      case 'play': trick('play'); burst('sparkle', 3); break;
      case 'reach': trick('reach'); break;
      case 'turn':
        if (moving()) startMove(pet.gait, pet.facing > 0 ? MARGIN : VW - MARGIN, pet.after);
        else if (pet.rest === 'sit' && !pet.anim) { pet.facing = -pet.facing; trick('back', 1500); }
        else if (!pet.anim) pet.facing = -pet.facing;
        break;
      case 'dance':
        if (moving()) stop('stand');
        pet.queue = [];
        for (let i = 0; i < 6; i++) pet.queue.push({ pose: i % 2 ? 'play' : 'reach', ms: 420, flip: true });
        break;
      case 'meow':
        if (!moving() && !pet.anim && pet.rest !== 'sit') settle('sit');
        pet.meowUntil = performance.now() + 1200;
        meowSound();
        break;
      case 'good':
        if (!moving()) trick('play', 1800);
        burst('heart', 5);
        burst('sparkle', 2);
        break;
      case 'come': {
        let x = VW / 2;
        try { x = (await bridge.getCursor()).x; } catch (_) {}
        startMove(Math.abs(x - pet.x) < 260 ? 'walk' : 'run', x, 'sit');
        break;
      }
    }
  }

  // ---------- tiny synthesized meow (no audio files) ----------
  let actx = null;
  function meowSound() {
    try {
      actx = actx || new AudioContext();
      const now = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      const f = actx.createBiquadFilter();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, now);
      o.frequency.linearRampToValueAtTime(820, now + 0.12);
      o.frequency.linearRampToValueAtTime(420, now + 0.45);
      f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      o.connect(f).connect(g).connect(actx.destination);
      o.start(now); o.stop(now + 0.55);
    } catch (_) {}
  }

  // ---------- what's on screen ----------
  function visual() {
    if (pet.anim) return { frame: curFrame() };
    if (pet.hold) return { frame: pet.hold.frame };
    if (pet.temp) return { pose: pet.temp.pose };
    if (pet.rest === 'stand') return { frame: STAND };
    if (pet.rest === 'lie') return { pose: 'bow' };
    if (pet.rest === 'sit' && performance.now() < pet.meowUntil) return { pose: 'meow' };
    return { pose: pet.rest };
  }
  function bounds(vis = visual()) {
    if (vis.frame != null) {
      const m = ANIM.frames[vis.frame], st = ANIM.strips[m.strip];
      return { w: m.w * st.K, h: (st.floor - m.oy) * st.K, lift: Math.max(0, (st.floor - (m.oy + m.h)) * st.K) };
    }
    const b = Cat.images[vis.pose];
    return b ? { w: b.width * S, h: b.height * S, lift: 0 } : { w: 180, h: 160, lift: 0 };
  }
  const currentHeight = () => bounds().h;
  const imgSize = () => bounds();

  // ---------- update ----------
  let last = performance.now();
  function update(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pet.t += dt;
    advanced = false;

    if (pet.anim) {
      const A = pet.anim;
      A.acc += dt * A.fps;
      while (pet.anim === A && A.acc >= 1) { A.acc -= 1; advance(); }
      if (pet.anim) {
        const f = curFrame();
        pet.x += pet.facing * frameSpeed(f, pet.anim.ctx) * dt;
      }
    }

    // steering while travelling
    if (pet.gait && pet.anim && pet.target != null) {
      const ahead = (pet.target - pet.x) * pet.facing;
      if (pet.gait === 'walk' && pet.anim.ctx === 'walk' && ahead <= 2) arrive();
      if (pet.gait === 'run' && pet.anim.ctx === 'bound' && !pet.braking) {
        // distance still to cover before frame 92 ends, then the landing slide
        const A = pet.anim;
        let d = 0, k = A.i;
        for (let n = 0; n < A.frames.length; n++) {
          const f = A.frames[k];
          d += frameSpeed(f, 'bound') / RUN_FPS;
          if (f === 92) break;
          k = (k + 1) % A.frames.length;
        }
        if (ahead <= d + LAND_DIST) pet.braking = true;
      }
    }
    // never leave the screen
    const EDGE = 140;
    if (pet.x < EDGE || pet.x > VW - EDGE) {
      pet.x = Math.max(EDGE, Math.min(VW - EDGE, pet.x));
      if (pet.gait === 'run') pet.braking = true;
      if (pet.gait === 'walk') arrive();
    }

    if (pet.hold && now > pet.hold.until) { const h = pet.hold; pet.hold = null; h.then(); }
    if (pet.hold && pet.pendingRest) pet.hold.until = Math.min(pet.hold.until, now);
    if (pet.temp && now > pet.temp.until) pet.temp = null;
    if (!pet.temp && pet.queue.length && !moving() && !pet.anim) {
      const q = pet.queue.shift();
      if (q.flip) pet.facing = -pet.facing;
      pet.temp = { pose: q.pose, until: now + q.ms };
      if (!pet.queue.length) setTimeout(() => burst('sparkle', 4), q.ms);
    }

    const idle = now - pet.lastCmdAt;
    if (!moving() && !pet.anim && !pet.hold && !pet.temp && idle > 150000 && pet.rest !== 'sleep') settle('sleep');
    if (pet.rest === 'sleep' && !pet.anim && !pet.temp && Math.random() < dt * 0.8) burst('zed', 1);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.age > p.life) particles.splice(i, 1);
    }
  }

  // ---------- drawing ----------
  const sstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function weight(u, v, part) {
    const [u0, v0, u1, v1] = part.box, f = 0.05;
    const m = sstep(u0 - f, u0 + f, u) * (1 - sstep(u1 - f, u1 + f, u)) * sstep(v0 - f, v0 + f, v) * (1 - sstep(v1 - f, v1 + f, v));
    return m * sstep(0.0, 0.16, Math.hypot(u - part.pivot[0], v - part.pivot[1]));
  }

  function squash(now) {
    let sx = 1, sy = 1;
    const w = (now - wobbleAt) / 1000;
    if (w < 0.5) {
      const e = Math.exp(-7 * w) * Math.cos(12 * w);
      sy *= 1 - 0.06 * e; sx *= 1 + 0.035 * e;
    }
    return { sx, sy };
  }

  function placeFrame(f, now) {
    const m = ANIM.frames[f], st = ANIM.strips[m.strip], K = st.K;
    const flip = pet.facing > 0 ? -1 : 1;   // video frames face left
    let { sx, sy } = squash(now);
    if (!pet.anim && !pet.hold && f === STAND) sy *= 1 + 0.01 * Math.sin(pet.t * 2.1);
    if (pet.hold) sy *= 1 + 0.012 * Math.sin(pet.t * 2.4);
    const gy = groundY();
    return (u, v) => {
      const vx = m.ox + u * m.w, vy = m.oy + v * m.h;
      return [pet.x + (vx - m.bx) * K * flip * sx, gy + (vy - st.floor) * K * sy];
    };
  }

  function placePose(name, now) {
    const bmp = Cat.images[name], P = Cat.POSES[name];
    const W = bmp.width, H = bmp.height, ax = P.anchor * W;
    const flip = (P.face === 'left' && pet.facing > 0) || (P.face === 'right' && pet.facing < 0);
    const t = pet.t, A = {};
    let lift = 0, rot = 0, sx = 1, sy = 1;
    if (name === 'sleep') {
      A.tail = 0.03 * Math.sin(t * 0.8);
      sy = 1 + 0.025 * Math.sin(t * 1.3); sx = 1 - 0.008 * Math.sin(t * 1.3);
    } else if (name === 'play') {
      A.paws = 0.2 * Math.sin(t * 7); A.tail = 0.16 * Math.sin(t * 5); rot = 0.06 * Math.sin(t * 3.5);
    } else if (name === 'reach') {
      A.tail = 0.12 * Math.sin(t * 2.4); A.head = 0.04 * Math.sin(t * 2.4 + 1); lift = 3 * Math.abs(Math.sin(t * 2.4));
    } else {
      const flick = Math.pow(Math.max(0, Math.sin(t * 0.45)), 24) * 0.25;
      A.tail = 0.08 * Math.sin(t * 1.6) + 0.03 * Math.sin(t * 3.3) + flick * Math.sin(t * 9);
      A.head = 0.035 * Math.sin(t * 0.8 + 1);
      if (name === 'meow') A.head = -0.09 * Math.sin(Math.min(1, (pet.meowUntil - now) / 1200) * Math.PI);
      sy = 1 + 0.012 * Math.sin(t * 2.1);
    }
    const q = squash(now); sx *= q.sx; sy *= q.sy;
    const parts = Object.entries(P.parts || {}).filter(([k]) => A[k]);
    const baseY = groundY() - lift;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    return (u, v) => {
      let X = u * W, Y = v * H;
      for (const [k, part] of parts) {
        const wgt = weight(u, v, part);
        if (wgt <= 0) continue;
        const a = A[k] * wgt, px = part.pivot[0] * W, py = part.pivot[1] * H;
        const dx = X - px, dy = Y - py, c = Math.cos(a), s = Math.sin(a);
        X = px + dx * c - dy * s; Y = py + dx * s + dy * c;
      }
      let lx = (X - ax) * S * sx, ly = (Y - H) * S * sy;
      if (flip) lx = -lx;
      return [pet.x + lx * cr - ly * sr, baseY + lx * sr + ly * cr];
    };
  }

  function star(x, y, r, a, spin) {
    fctx.save();
    fctx.globalAlpha = a; fctx.translate(x, y); fctx.rotate(spin * 0.15);
    fctx.fillStyle = '#ec7fb0';
    fctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.22, ang = (i * Math.PI) / 4 - Math.PI / 2;
      fctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    fctx.closePath(); fctx.fill(); fctx.restore();
  }
  function heart(x, y, s, a) {
    fctx.save();
    fctx.globalAlpha = a; fctx.translate(x, y); fctx.scale(s, s);
    fctx.fillStyle = '#ec7fb0';
    fctx.beginPath();
    fctx.moveTo(0, 4);
    fctx.bezierCurveTo(-7, -2, -4, -9, 0, -5);
    fctx.bezierCurveTo(4, -9, 7, -2, 0, 4);
    fctx.fill(); fctx.restore();
  }

  function draw(now) {
    const vis = visual();
    const key = vis.frame != null ? 'f' + vis.frame : 'p' + vis.pose;
    if (key !== lastKey) { if (!advanced && lastKey) wobbleAt = now; lastKey = key; }

    mesh.begin(VW, VH);
    if (vis.frame != null && Cat.frames[vis.frame]) mesh.draw(Cat.frames[vis.frame], placeFrame(vis.frame, now));
    else if (vis.pose && Cat.images[vis.pose]) mesh.draw(Cat.images[vis.pose], placePose(vis.pose, now));

    const b = bounds(vis);
    const shrink = Math.max(0.45, 1 - b.lift / 220);
    sctx.clearRect(0, 0, VW, VH);
    sctx.fillStyle = 'rgba(120, 100, 160, 0.16)';
    sctx.beginPath();
    sctx.ellipse(pet.x, groundY() - 1, Math.min(b.w, 260) * 0.36 * shrink, 6 * shrink, 0, 0, Math.PI * 2);
    sctx.fill();

    fctx.clearRect(0, 0, VW, VH);
    for (const p of particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      const sy = groundY() - p.y;
      if (p.kind === 'heart') heart(p.x, sy, 1.6, a);
      else if (p.kind === 'sparkle') star(p.x, sy, 9 + 4 * Math.sin(p.age * 6), a, p.spin + p.age * 4);
      else {
        fctx.save();
        fctx.globalAlpha = a; fctx.fillStyle = '#7a6aa8';
        fctx.font = `600 ${14 + p.age * 8}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
        fctx.fillText('z', p.x + pet.facing * 40, sy - 10);
        fctx.restore();
      }
    }
    positionBubble();
  }

  function loop(now) {
    update(now);
    draw(now);
    requestAnimationFrame(loop);
  }
  Cat.ready.then(() => requestAnimationFrame(loop));

  // for the test harness
  window.__mochi = { pet, execute };

  // ---------- speech bubble ----------
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const bubbleMeta = document.getElementById('bubble-meta');
  let bubbleTimer = null;

  function positionBubble() {
    const x = Math.max(170, Math.min(VW - 170, pet.x));
    bubble.style.left = `${x}px`;
    bubble.style.bottom = `${GROUND + currentHeight() + 16}px`;
  }

  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  function showBubble(html, meta, holdMs = 2200) {
    bubbleText.innerHTML = html;
    bubbleMeta.textContent = meta || '';
    bubble.classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.add('hidden'), holdMs);
  }

  function highlight(hit) {
    return hit.words
      .map((w, i) => (i >= hit.start && i < hit.end ? `<span class="cmd">${esc(w)}</span>` : esc(w)))
      .join(' ');
  }

  // ---------- HUD ----------
  const hud = document.getElementById('hud');
  const dot = document.getElementById('dot');
  const hudStatus = document.getElementById('hud-status');
  const hudHeard = document.getElementById('hud-heard');
  const meterFill = document.getElementById('meter-fill');
  let muted = false;

  function renderStatus(s) {
    dot.className = '';
    if (muted || s.state === 'muted') { dot.classList.add('muted'); hudStatus.textContent = 'Muted · ⌘/Ctrl+Shift+M'; return; }
    switch (s.state) {
      case 'listening': dot.classList.add('listening'); hudStatus.textContent = 'Listening · Smallest Pulse STT'; break;
      case 'connecting': hudStatus.textContent = 'Connecting to Smallest…'; break;
      case 'reconnecting': hudStatus.textContent = 'Reconnecting…'; break;
      case 'error': dot.classList.add('error'); hudStatus.textContent = s.msg || 'Error'; break;
      default: hudStatus.textContent = 'Starting…';
    }
  }
  let lastStatus = { state: 'starting' };
  bridge.onStatus((s) => { lastStatus = s; renderStatus(s); });
  bridge.onSettings((s) => {
    muted = s.muted;
    hud.classList.toggle('hidden', !s.showHud);
    renderStatus(lastStatus);
  });

  // ---------- transcripts → commands ----------
  // Commands fire on INTERIM results, as soon as the word shows up, so the
  // cat reacts while you're still finishing the sentence. Each command
  // fires once per segment; the segment resets when Pulse marks it final.
  let firedKey = null;

  bridge.onTranscript((m) => {
    const text = (m.transcript || '').trim();
    if (text) {
      const hit = Commands.findLast(text);
      if (hit) {
        const key = `${hit.cmd}@${hit.start}`;
        if (key !== firedKey) {
          firedKey = key;
          execute(hit.cmd);
          showBubble(highlight(hit));
          hudHeard.innerHTML = 'heard: ' + hit.words
            .map((w, i) => (i >= hit.start && i < hit.end ? `<b>${esc(w)}</b>` : esc(w)))
            .join(' ');
        }
      } else if (m.is_final) {
        hudHeard.textContent = `heard: ${text}`;
        showBubble(esc(text), '🤔 not a command I know', 1600);
      }
    }
    if (m.is_final || m.is_last) firedKey = null;
  });

  // ---------- microphone ----------
  // AudioContext at 16 kHz lets Chromium resample for us; the worklet packs
  // 50 ms chunks of Int16 PCM and reports their loudness for the level meter.
  let noiseFloor = 0.01;
  async function startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mic = new AudioContext({ sampleRate: 16000 });
      const src = mic.createMediaStreamSource(stream);
      const sink = mic.createGain();
      sink.gain.value = 0;
      sink.connect(mic.destination);
      let onChunk = () => {};
      try {
        // preferred: AudioWorklet (off the main thread)
        await mic.audioWorklet.addModule('pcm-worklet.js');
        const tap = new AudioWorkletNode(mic, 'pcm-tap');
        src.connect(tap).connect(sink);
        tap.port.onmessage = ({ data }) => onChunk(data);
      } catch (_) {
        // fallback: ScriptProcessor, same 50 ms-ish Int16 chunks
        const sp = mic.createScriptProcessor(1024, 1, 1);
        src.connect(sp).connect(sink);
        sp.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(ch.length);
          let sq = 0;
          for (let k = 0; k < ch.length; k++) {
            let v = ch[k]; sq += v * v;
            v = v < -1 ? -1 : v > 1 ? 1 : v;
            pcm[k] = v < 0 ? v * 0x8000 : v * 0x7fff;
          }
          onChunk({ pcm: pcm.buffer, rms: Math.sqrt(sq / ch.length) });
        };
      }

      onChunk = (data) => {
        if (!muted) bridge.sendAudio(data.pcm);
        // level meter: brighter green when it sounds like speech
        const rms = data.rms;
        if (rms < noiseFloor * 2) noiseFloor = noiseFloor * 0.98 + rms * 0.02;
        const isVoice = rms > Math.max(0.02, noiseFloor * 3);
        meterFill.style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
        meterFill.style.background = isVoice ? '#3ddc84' : '#6b8f7a';
      };
    } catch (err) {
      renderStatus({ state: 'error', msg: `Mic: ${err.message}` });
    }
  }
  startMic();

  // ---------- mouse: click-through except over the cat ----------
  let overCat = false;
  window.addEventListener('mousemove', (e) => {
    const { w, h } = imgSize();
    const top = groundY() - h;
    const inside = Math.abs(e.clientX - pet.x) < Math.min(w, 260) * 0.38 && e.clientY > top + h * 0.15 && e.clientY < groundY();
    if (inside !== overCat) {
      overCat = inside;
      bridge.setIgnoreMouse(!inside);
      document.body.style.cursor = inside ? 'pointer' : 'default';
    }
  });
  window.addEventListener('mousedown', () => {
    if (!overCat) return;
    if (pet.rest === 'sleep' && !pet.anim) settle('sit');
    burst('heart', 4);
    showBubble('purrrr ♥', '', 1200);
  });

  // say hi
  setTimeout(() => showBubble('Hi, I\'m Mochi! Try <span class="cmd">sit</span>, <span class="cmd">run</span>, <span class="cmd">stretch</span>…', 'powered by Smallest Pulse', 4200), 700);
})();
