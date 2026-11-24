// Mochi — renderer: mic capture → main (→ Smallest Pulse), command
// handling, Mochi's movement + transition state machine, and drawing.
//
// The poses are still drawings, so the motion comes from three things:
//  1. a rig: tails, heads and legs bend on a WebGL mesh (cat.js, gl.js)
//  2. procedural cycles: the run is a gallop (spine flexes, legs gather and
//     reach, suspension arc), the walk swings front/hind legs alternately
//  3. a transition sequencer: hard cuts with squash-and-settle instead of
//     crossfades, crouch before sprinting, braking/skids before stopping,
//     and "via" poses (sleep → sit → stand) so changes read as movement.

(() => {
  const bridge = window.petBridge;
  const S = 0.85;                 // art scale (sheet px → screen px)
  const GROUND = 12;              // px from window bottom to paws
  const RUN = { max: 520, accel: 1500, stride: 170 };
  const WALK = { max: 90, accel: 320, stride: 70 };
  const RUN_LOOK = 170;           // above this speed, show the gallop
  const TEMP_MS = 2600;           // one-off tricks
  const MARGIN = 120;

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
    v: 0,                 // signed speed, px/s
    facing: -1,           // 1 = right, -1 = left
    mode: 'rest',         // 'rest' | 'move'
    rest: 'sit',          // stand | sit | lie | sleep
    gait: 'run',          // run | walk (while moving)
    target: null,
    after: 'stand',
    seq: [],              // queued in-between steps: { img, ms, crouch, flip }
    seqT: 0,
    seqDone: null,
    temp: null,           // one-off trick { pose, until }
    y: 0, vy: 0, air: false,
    t: 0, phase: 0,
    lastCmdAt: performance.now(),
    meowUntil: 0,
  };
  const particles = [];
  let wobbleAt = -1e9;    // when the last hard cut happened (for squash & settle)
  let shownImg = null;
  let lastLift = 0;

  const clampX = (x) => Math.max(MARGIN, Math.min(VW - MARGIN, x));
  const dirTo = (x) => (x >= pet.x ? 1 : -1);

  // ---------- sequencer ----------
  function play(steps, done) {
    pet.seq = steps.slice();
    pet.seqT = 0;
    pet.seqDone = done || null;
  }
  function clearSeq() { pet.seq = []; pet.seqDone = null; }

  // what's on screen right now, before any trick/sequence
  function restImg() {
    if (pet.rest === 'lie') return 'bow';
    if (pet.rest === 'sit' && performance.now() < pet.meowUntil) return 'meow';
    return pet.rest;
  }

  // in-between pose to get up from a resting pose
  function getUpSteps() {
    if (pet.mode === 'move') return [];
    if (pet.rest === 'sleep') return [{ img: 'sit', ms: 170 }, { img: 'stand', ms: 130 }];
    if (pet.rest === 'sit' || pet.rest === 'lie') return [{ img: 'stand', ms: 140 }];
    return [];
  }

  function setRest(pose) {
    clearSeq();
    pet.temp = null;
    const from = pet.rest;
    pet.rest = pose;
    if (pet.mode === 'move') return;
    // via poses so big changes don't teleport
    if (from === 'sleep' && pose === 'stand') play([{ img: 'sit', ms: 160 }]);
    else if (from === 'stand' && pose === 'sleep') play([{ img: 'sit', ms: 200 }, { img: 'bow', ms: 160 }]);
    else if (from === 'sit' && pose === 'sleep') play([{ img: 'bow', ms: 180 }]);
  }

  function trick(pose, ms = TEMP_MS) {
    if (pet.mode === 'move') stopSoon();
    pet.temp = { pose, until: performance.now() + ms };
  }

  function startMove(gait, x, after = 'stand') {
    pet.temp = null;
    pet.after = after;
    const tx = clampX(x);
    if (Math.abs(tx - pet.x) < 8) return;
    if (pet.mode === 'move') {          // already moving: just retarget
      pet.gait = gait;
      pet.target = tx;
      return;
    }
    const d = dirTo(tx);
    const steps = getUpSteps();
    if (d !== pet.facing) steps.push({ img: steps.length ? steps[steps.length - 1].img : (pet.rest === 'stand' ? 'stand' : 'stand'), ms: 90, flip: true });
    if (gait === 'run') steps.push({ img: 'bow', ms: 170, crouch: true });   // wind-up
    play(steps, () => {
      pet.mode = 'move';
      pet.gait = gait;
      pet.target = tx;
      pet.facing = d;
    });
  }

  function runAcross(dir) {
    if (dir == null) {
      dir = pet.facing;
      if ((dir > 0 && pet.x > VW - MARGIN - 150) || (dir < 0 && pet.x < MARGIN + 150)) dir = -dir;
    }
    startMove('run', dir > 0 ? VW - MARGIN : MARGIN);
  }

  // brake to a natural stop from the current speed
  function stopSoon(after = 'stand') {
    if (pet.mode !== 'move') return;
    const g = pet.gait === 'run' ? RUN : WALK;
    const dist = (pet.v * pet.v) / (2 * g.accel);
    pet.target = clampX(pet.x + Math.sign(pet.v || pet.facing) * dist);
    pet.after = after;
  }

  function hop(power = 600) {
    if (pet.air) return;
    const crouchImg = pet.mode === 'move' ? null : (pet.rest === 'stand' ? 'stand' : null);
    const launch = () => { pet.air = true; pet.vy = power; pet.y = 0.01; };
    if (pet.mode === 'move') { launch(); return; }
    const steps = getUpSteps();
    steps.push({ img: crouchImg || 'stand', ms: 110, crouch: true });
    play(steps, () => { pet.rest = 'stand'; launch(); });
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
    switch (cmd) {
      case 'sit': if (pet.mode === 'move') stopSoon('sit'); else setRest('sit'); break;
      case 'stand':
      case 'wake': if (pet.mode === 'move') stopSoon('stand'); else setRest('stand'); break;
      case 'lie': if (pet.mode === 'move') stopSoon('lie'); else setRest('lie'); break;
      case 'sleep': if (pet.mode === 'move') stopSoon('sleep'); else setRest('sleep'); break;
      case 'stop': if (pet.mode === 'move') stopSoon('stand'); else { pet.temp = null; clearSeq(); } break;
      case 'run': runAcross(); break;
      case 'run_left': runAcross(-1); break;
      case 'run_right': runAcross(1); break;
      case 'walk': startMove('walk', pet.x + pet.facing * 380); break;
      case 'jump': hop(); break;
      case 'stretch': trick('stretch'); break;
      case 'play': trick('play'); burst('sparkle', 3); break;
      case 'reach': trick('reach'); break;
      case 'turn':
        if (pet.mode === 'move') startMove(pet.gait, pet.facing > 0 ? MARGIN : VW - MARGIN, pet.after);
        else if (pet.rest === 'sit' || pet.rest === 'stand') { pet.facing = -pet.facing; trick('back', 1500); }
        else pet.facing = -pet.facing;
        break;
      case 'dance': {
        if (pet.mode === 'move') stopSoon('stand');
        pet.temp = null;
        const steps = [];
        for (let i = 0; i < 6; i++) steps.push({ img: i % 2 ? 'play' : 'reach', ms: 420, flip: true });
        play(steps, () => { burst('sparkle', 4); setRest('sit'); });
        break;
      }
      case 'meow':
        if (pet.mode !== 'move' && pet.rest !== 'sit') setRest('sit');
        pet.meowUntil = performance.now() + 1200;
        meowSound();
        break;
      case 'good':
        trick('play', 1800);
        burst('heart', 5);
        burst('sparkle', 2);
        break;
      case 'come': {
        let x = VW / 2;
        try { x = (await bridge.getCursor()).x; } catch (_) {}
        startMove('run', x, 'sit');
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

  // ---------- which drawing ----------
  function currentImage() {
    if (pet.seq.length) return pet.seq[0].img;
    if (pet.air) return 'jump';
    if (pet.temp) return pet.temp.pose;
    if (pet.mode === 'move') return Math.abs(pet.v) > RUN_LOOK ? 'jump' : 'walk';
    return restImg();
  }
  const imgSize = (n) => {
    const b = Cat.images[n || currentImage()];
    return b ? { w: b.width * S, h: b.height * S } : { w: 180, h: 160 };
  };
  const currentHeight = () => imgSize().h;

  // ---------- update ----------
  let last = performance.now();
  let frozen = false;
  function update(now) {
    if (frozen) { last = now; return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pet.t += dt;

    // sequence steps
    if (pet.seq.length) {
      pet.seqT += dt * 1000;
      if (pet.seqT >= pet.seq[0].ms) {
        pet.seqT = 0;
        const step = pet.seq.shift();
        if (step.flip) pet.facing = -pet.facing;
        if (!pet.seq.length && pet.seqDone) { const cb = pet.seqDone; pet.seqDone = null; cb(); }
      }
    }

    if (pet.temp && now > pet.temp.until) pet.temp = null;

    // movement: accelerate, cruise, brake, skid
    if (pet.mode === 'move' && pet.target != null) {
      const g = pet.gait === 'run' ? RUN : WALK;
      const d = pet.target - pet.x;
      const want = Math.sign(d) || pet.facing;
      const sp = Math.abs(pet.v);
      const stopDist = (sp * sp) / (2 * g.accel);
      if (pet.v !== 0 && Math.sign(pet.v) !== want) {
        // skidding: brake hard, then turn around with a squash
        pet.v -= Math.sign(pet.v) * Math.min(sp, g.accel * 1.6 * dt);
        if (pet.v === 0) { pet.facing = want; wobbleAt = now; }
      } else if (Math.abs(d) <= stopDist + 2) {
        pet.v -= want * Math.min(sp, g.accel * dt);
      } else {
        pet.v += want * g.accel * dt;
        if (Math.abs(pet.v) > g.max) pet.v = want * g.max;
      }
      pet.x += pet.v * dt;
      if (Math.abs(pet.v) > 1) pet.facing = Math.sign(pet.v);
      pet.phase += (Math.abs(pet.v) * dt / (Math.abs(pet.v) > RUN_LOOK ? RUN.stride : WALK.stride)) * Math.PI * 2;

      if ((Math.abs(d) < 3 && Math.abs(pet.v) < 25) || (Math.sign(pet.target - pet.x) !== want && Math.abs(pet.v) < 40)) {
        pet.x = Math.abs(d) < 40 ? pet.target : pet.x;
        pet.v = 0;
        pet.target = null;
        pet.mode = 'rest';
        const after = pet.after;
        pet.rest = 'stand';
        if (after !== 'stand') play([{ img: 'stand', ms: 160 }], () => setRest(after));
      }
    }

    // airborne
    if (pet.air) {
      pet.vy -= 1900 * dt;
      pet.y += pet.vy * dt;
      if (pet.y <= 0) { pet.y = 0; pet.vy = 0; pet.air = false; wobbleAt = now; }
    }

    // nap when ignored
    if (pet.mode === 'rest' && !pet.seq.length && !pet.temp && now - pet.lastCmdAt > 150000 && pet.rest !== 'sleep') setRest('sleep');
    if (pet.rest === 'sleep' && pet.mode === 'rest' && !pet.temp && !pet.seq.length && Math.random() < dt * 0.8) burst('zed', 1);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.age > p.life) particles.splice(i, 1);
    }
  }

  // ---------- rig + procedural motion ----------
  const sstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  function weight(u, v, part) {
    const [u0, v0, u1, v1] = part.box, f = 0.05;
    const m = sstep(u0 - f, u0 + f, u) * (1 - sstep(u1 - f, u1 + f, u)) * sstep(v0 - f, v0 + f, v) * (1 - sstep(v1 - f, v1 + f, v));
    const r = Math.hypot(u - part.pivot[0], v - part.pivot[1]);
    return m * sstep(0.0, 0.16, r);
  }

  // per-frame motion parameters for the drawing on screen
  function motion(name, now) {
    const t = pet.t, ph = pet.phase;
    const m = { angles: {}, lift: 0, rot: 0, sx: 1, sy: 1, flex: 0, plant: false };
    const A = m.angles;
    const moving = pet.mode === 'move' && !pet.seq.length && !pet.air;
    if (name === 'jump' && moving) {
      // gallop: g = 0 stretched out (the drawing) … 1 fully gathered
      const g = ((1 - Math.cos(ph)) / 2) * 1.15 - 0.15;
      m.flex = g;
      A.front = -0.62 * g;
      A.hind = 0.5 * g;
      A.tail = 0.2 * Math.sin(ph - 1.2);
      A.head = 0.06 * Math.sin(ph);
      m.lift = 12 * Math.max(0, Math.sin(ph + 0.4));
      m.rot = -0.05 * Math.sin(ph) * pet.facing;
    } else if (name === 'walk' && moving) {
      A.front = 0.24 * Math.sin(ph);
      A.hind = -0.24 * Math.sin(ph);
      m.plant = true;
      A.tail = 0.12 * Math.sin(ph * 0.5 + 0.6);
      A.head = 0.035 * Math.sin(ph * 2);
      m.lift = 2.5 * Math.abs(Math.sin(ph));
    } else if (name === 'jump' && pet.air) {
      const k = Math.max(-1, Math.min(1, pet.vy / 700));
      A.front = -0.35 * k;
      A.hind = 0.3 * k;
      A.tail = -0.2 * k;
      m.rot = -0.22 * k * pet.facing;
    } else if (name === 'sleep') {
      A.tail = 0.03 * Math.sin(t * 0.8);
      m.sy = 1 + 0.025 * Math.sin(t * 1.3);
      m.sx = 1 - 0.008 * Math.sin(t * 1.3);
    } else if (name === 'play') {
      A.paws = 0.2 * Math.sin(t * 7);
      A.tail = 0.16 * Math.sin(t * 5);
      m.rot = 0.06 * Math.sin(t * 3.5);
    } else if (name === 'reach') {
      A.tail = 0.12 * Math.sin(t * 2.4);
      A.head = 0.04 * Math.sin(t * 2.4 + 1);
      m.lift = 3 * Math.abs(Math.sin(t * 2.4));
    } else {
      // resting: slow tail swish with the odd flick, breathing, a head tilt
      const flick = Math.pow(Math.max(0, Math.sin(t * 0.45)), 24) * 0.25;
      A.tail = 0.08 * Math.sin(t * 1.6) + 0.03 * Math.sin(t * 3.3) + flick * Math.sin(t * 9);
      A.head = 0.035 * Math.sin(t * 0.8 + 1);
      if (name === 'meow') A.head = -0.09 * Math.sin(Math.min(1, (pet.meowUntil - now) / 1200) * Math.PI);
      m.sy = 1 + 0.012 * Math.sin(t * 2.1);
    }

    // transition shaping: crouch (wind-up) and squash-and-settle after cuts
    const step = pet.seq[0];
    if (step && step.crouch) {
      const k = sstep(0, 1, pet.seqT / step.ms);
      m.sy *= 1 - 0.13 * k; m.sx *= 1 + 0.07 * k;
    }
    const w = (now - wobbleAt) / 1000;
    if (w < 0.6) {
      const e = Math.exp(-6 * w) * Math.cos(11 * w);
      m.sy *= 1 - 0.1 * e; m.sx *= 1 + 0.06 * e;
    }
    return m;
  }

  function placeFor(name, now) {
    const bmp = Cat.images[name];
    const P = Cat.POSES[name];
    const W = bmp.width, H = bmp.height;
    const ax = P.anchor * W;
    const flip = (P.face === 'left' && pet.facing > 0) || (P.face === 'right' && pet.facing < 0);
    const m = motion(name, now);
    const parts = Object.entries(P.parts || {}).filter(([k]) => m.angles[k]);
    const lift = pet.y + m.lift;
    lastLift = m.lift;
    const baseY = VH - GROUND - lift;
    const cr = Math.cos(m.rot), sr = Math.sin(m.rot);
    return (u, v) => {
      let X = u * W, Y = v * H;
      for (const [k, part] of parts) {
        const wgt = weight(u, v, part);
        if (wgt <= 0) continue;
        const a = m.angles[k] * wgt;
        const px = part.pivot[0] * W, py = part.pivot[1] * H;
        const dx = X - px, dy = Y - py, c = Math.cos(a), s = Math.sin(a);
        X = px + dx * c - dy * s;
        Y = py + dx * s + dy * c;
      }
      if (m.plant) {
        // keep paws + painted ground line on the floor while legs swing
        const k = sstep(0.9, 0.97, v);
        Y = Y + (v * H - Y) * k;
      }
      if (m.flex) {
        // spine gathers (shorter, arched) and stretches with the stride
        X -= (u - 0.45) * W * 0.09 * m.flex;
        Y -= H * 0.05 * Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.08) / 0.78))) * m.flex * (1 - 0.6 * v);
      }
      let lx = (X - ax) * S * m.sx, ly = (Y - H) * S * m.sy;
      if (flip) lx = -lx;
      return [pet.x + lx * cr - ly * sr, baseY + lx * sr + ly * cr];
    };
  }

  // ---------- 2D bits: shadow + particles ----------
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
    const name = currentImage();
    if (name !== shownImg) { if (shownImg) wobbleAt = now; shownImg = name; }

    mesh.begin(VW, VH);
    if (Cat.images[name]) mesh.draw(Cat.images[name], placeFor(name, now));

    const { w } = imgSize(name);
    const air = pet.y + lastLift;
    const shrink = Math.max(0.45, 1 - air / 220);
    sctx.clearRect(0, 0, VW, VH);
    sctx.fillStyle = 'rgba(120, 100, 160, 0.16)';
    sctx.beginPath();
    sctx.ellipse(pet.x, VH - GROUND - 1, w * 0.36 * shrink, 6 * shrink, 0, 0, Math.PI * 2);
    sctx.fill();

    fctx.clearRect(0, 0, VW, VH);
    for (const p of particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      const sy = VH - GROUND - p.y;
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
  window.__mochi = { pet, execute, freeze: (on) => { frozen = on; } };

  // ---------- speech bubble ----------
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const bubbleMeta = document.getElementById('bubble-meta');
  let bubbleTimer = null;

  function positionBubble() {
    const x = Math.max(170, Math.min(VW - 170, pet.x));
    bubble.style.left = `${x}px`;
    bubble.style.bottom = `${GROUND + currentHeight() + 16 + pet.y + lastLift}px`;
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
    const top = VH - GROUND - h - pet.y;
    const inside = Math.abs(e.clientX - pet.x) < w * 0.38 && e.clientY > top + h * 0.15 && e.clientY < top + h;
    if (inside !== overCat) {
      overCat = inside;
      bridge.setIgnoreMouse(!inside);
      document.body.style.cursor = inside ? 'pointer' : 'default';
    }
  });
  window.addEventListener('mousedown', () => {
    if (!overCat) return;
    if (pet.rest === 'sleep' && pet.mode === 'rest') setRest('sit');
    burst('heart', 4);
    showBubble('purrrr ♥', '', 1200);
  });

  // say hi
  setTimeout(() => showBubble('Hi, I\'m Mochi! Try <span class="cmd">sit</span>, <span class="cmd">run</span>, <span class="cmd">stretch</span>…', 'powered by Smallest Pulse', 4200), 700);
})();
