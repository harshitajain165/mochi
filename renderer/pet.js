// Pixel Pet — renderer: mic capture → main (→ Smallest Pulse), command
// handling, the cat's little state machine, and drawing.

(() => {
  const bridge = window.petBridge;
  const SCALE = 2;                       // screen pixels per sprite pixel (88×64 grid)
  const CAT_W = Sprite.W * SCALE;
  const CAT_H = Sprite.H * SCALE;
  const GROUND = 10;                     // px from bottom of window to paws
  const RUN_SPEED = 540;                 // px/s
  const WALK_SPEED = 95;

  // ---------- canvas ----------
  const stage = document.getElementById('stage');
  const ctx = stage.getContext('2d');
  let VW = 0, VH = 0, DPR = 1;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    VW = window.innerWidth; VH = window.innerHeight;
    stage.width = Math.round(VW * DPR);
    stage.height = Math.round(VH * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- pet state ----------
  const pet = {
    x: VW * 0.62,        // centre x on screen
    dir: -1,             // 1 = facing right, -1 = left
    pose: 'stand',
    target: null,        // x to move to (run/walk)
    after: 'stand',      // pose to settle into after moving
    y: 0, vy: 0,         // jump height (px, up is positive)
    t: 0,
    frameT: 0, frame: 0,
    lastCmdAt: performance.now(),
    meow: null,
    happyUntil: 0,
    dance: null,
  };
  let blinkUntil = 0, nextBlink = performance.now() + 2500;
  const particles = [];

  const clampX = (x) => Math.max(CAT_W / 2 + 8, Math.min(VW - CAT_W / 2 - 8, x));

  function moveTo(x, speedPose, after = 'stand') {
    pet.target = clampX(x);
    pet.dir = pet.target >= pet.x ? 1 : -1;
    pet.pose = speedPose;
    pet.after = after;
  }

  function runAcross(dir) {
    const margin = CAT_W / 2 + 8;
    if (dir == null) {
      // keep going the way it's facing, unless it's already at that edge
      dir = pet.dir;
      if ((dir > 0 && pet.x > VW - margin - 150) || (dir < 0 && pet.x < margin + 150)) dir = -dir;
    }
    moveTo(dir > 0 ? VW - margin : margin, 'run');
  }

  function hop(power = 525) {
    if (pet.y > 0) return;
    pet.vy = power;
    pet.y = 0.01;
  }

  function burst(kind, n) {
    for (let i = 0; i < n; i++) {
      particles.push({
        kind,
        x: pet.x + (Math.random() - 0.5) * 60 + pet.dir * 30,
        y: CAT_H * 0.75 + Math.random() * 20,
        vx: (Math.random() - 0.5) * 30,
        vy: 40 + Math.random() * 40,
        life: 1.6 + Math.random() * 0.6,
        age: 0,
      });
    }
  }

  // ---------- command execution ----------
  async function execute(cmd) {
    pet.lastCmdAt = performance.now();
    pet.dance = null;
    const moving = pet.pose === 'run' || pet.pose === 'walk';
    switch (cmd) {
      case 'sit': pet.target = null; pet.pose = 'sit'; break;
      case 'stand':
      case 'wake': pet.target = null; pet.pose = 'stand'; break;
      case 'lie': pet.target = null; pet.pose = 'lie'; break;
      case 'sleep': pet.target = null; pet.pose = 'sleep'; break;
      case 'stop': pet.target = null; if (moving || pet.pose === 'jump') pet.pose = 'stand'; break;
      case 'run': runAcross(); break;
      case 'run_left': runAcross(-1); break;
      case 'run_right': runAcross(1); break;
      case 'walk': moveTo(pet.x + pet.dir * 320, 'walk'); break;
      case 'jump': if (pet.pose !== 'run' && pet.pose !== 'walk') pet.pose = 'stand'; hop(); break;
      case 'turn': pet.dir = -pet.dir; if (pet.target != null) runAcross(pet.dir); break;
      case 'dance': pet.target = null; pet.pose = 'stand'; pet.dance = { t: 0, step: 0 }; break;
      case 'meow': doMeow(); break;
      case 'good':
        pet.happyUntil = performance.now() + 1800;
        burst('heart', 6);
        break;
      case 'come': {
        try {
          const c = await bridge.getCursor();
          moveTo(c.x, 'run', 'sit');
        } catch (_) { moveTo(VW / 2, 'run', 'sit'); }
        break;
      }
    }
  }

  // ---------- kitten meow (synthesized, no audio files) ----------
  // A little voice model: a buzzy pitch source shaped by three moving
  // "formant" filters, so it says "m-ia-ow" instead of beeping. The pitch
  // rises and falls with a touch of vibrato, there's a breath of air on top,
  // and each meow picks a variant so it never sounds canned.
  let actx = null;
  const VOWEL = {             // formant frequencies (Hz) for an adult voice
    m: [280, 1700, 2600], i: [330, 2500, 3200], a: [820, 1450, 2700], o: [480, 900, 2500], r: [460, 1250, 1900],
  };
  const MEOWS = {
    mew:  { dur: 0.34, pitch: [880, 1220, 840], path: [['m', 0], ['i', 0.18], ['a', 0.65], ['o', 1]], size: 1.38, mouth: [[0.15, 0.9]], text: 'mew~' },
    meow: { dur: 0.66, pitch: [700, 1060, 560], path: [['m', 0], ['i', 0.14], ['a', 0.5], ['o', 0.88]], size: 1.28, mouth: [[0.12, 0.88]], text: 'meeow ♡' },
    mrrp: { dur: 0.46, pitch: [600, 960, 900], path: [['r', 0], ['r', 0.4], ['i', 0.7], ['a', 1]], size: 1.32, trill: 0.45, mouth: [[0.45, 0.95]], text: 'mrrp?' },
  };

  function voice(v, t0, out) {
    const ctx = actx, d = v.dur;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    const [p0, p1, p2] = v.pitch.map((p) => p * (0.94 + Math.random() * 0.12));
    src.frequency.setValueAtTime(p0, t0);
    src.frequency.linearRampToValueAtTime(p1, t0 + d * 0.35);
    src.frequency.exponentialRampToValueAtTime(p2, t0 + d);
    // vibrato that blooms in after the onset
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 6.5 + Math.random();
    lfoG.gain.setValueAtTime(0, t0);
    lfoG.gain.linearRampToValueAtTime(p1 * 0.025, t0 + d * 0.6);
    lfo.connect(lfoG).connect(src.frequency);
    // soften the buzz a little
    const soft = ctx.createBiquadFilter();
    soft.type = 'lowpass'; soft.frequency.value = 4200;
    src.connect(soft);

    // three formants following the vowel path
    const amp = ctx.createGain();
    amp.gain.value = 0;
    const gains = [1.0, 0.55, 0.22];
    for (let k = 0; k < 3; k++) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.Q.value = k === 0 ? 5 : 8;
      for (const [name, at] of v.path) {
        const hz = VOWEL[name][k] * v.size;
        if (at === 0) f.frequency.setValueAtTime(hz, t0);
        else f.frequency.linearRampToValueAtTime(hz, t0 + d * at);
      }
      const g = ctx.createGain(); g.gain.value = gains[k];
      soft.connect(f).connect(g).connect(amp);
    }

    // breathy air
    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * d), ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    noise.buffer = buf;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
    const ng = ctx.createGain(); ng.gain.value = 0.025;
    noise.connect(hp).connect(ng).connect(amp);

    // loudness: soft nasal "m", open up, fade away
    const A = amp.gain;
    A.setValueAtTime(0.0001, t0);
    A.linearRampToValueAtTime(0.12, t0 + 0.04);
    A.linearRampToValueAtTime(0.42, t0 + d * 0.22);
    A.setValueAtTime(0.42, t0 + d * 0.6);
    A.exponentialRampToValueAtTime(0.0001, t0 + d);
    // "mrrp": a rolled trill at the start
    if (v.trill) {
      const tr = ctx.createOscillator(), trg = ctx.createGain();
      tr.type = 'square'; tr.frequency.value = 26;
      trg.gain.setValueAtTime(0.35, t0);
      trg.gain.linearRampToValueAtTime(0, t0 + d * v.trill);
      tr.connect(trg).connect(A);
      tr.start(t0); tr.stop(t0 + d);
    }
    amp.connect(out);
    for (const n of [src, lfo, noise]) { n.start(t0); n.stop(t0 + d + 0.05); }
  }

  // plays a meow; returns { ms, mouth: [[startMs, endMs]], text }
  function meowSound() {
    const names = ['meow', 'meow', 'mew', 'mrrp'];
    const v = MEOWS[names[Math.floor(Math.random() * names.length)]];
    const twice = v === MEOWS.mew && Math.random() < 0.5;   // sometimes "mew mew"
    const plan = { ms: 0, mouth: [], text: twice ? 'mew mew!' : v.text };
    try {
      actx = actx || new AudioContext();
      if (actx.state === 'suspended') actx.resume();
      const out = actx.createGain();
      out.gain.value = 0.85;
      const comp = actx.createDynamicsCompressor();
      out.connect(comp).connect(actx.destination);
      const t0 = actx.currentTime + 0.02;
      const reps = twice ? 2 : 1;
      for (let r = 0; r < reps; r++) {
        const start = r * (v.dur + 0.09);
        voice(v, t0 + start, out);
        for (const [a, b] of v.mouth) plan.mouth.push([(start + v.dur * a) * 1000, (start + v.dur * b) * 1000]);
        plan.ms = (start + v.dur) * 1000;
      }
    } catch (_) {
      plan.ms = 600; plan.mouth = [[80, 520]];
    }
    return plan;
  }

  function doMeow() {
    if (pet.pose === 'sleep' || pet.pose === 'lie') pet.pose = 'sit';
    const plan = meowSound();
    const now = performance.now();
    pet.meow = { start: now, ...plan };
    pet.happyUntil = Math.max(pet.happyUntil, now + plan.ms + 650);   // happy squint after
    if (pet.target == null && pet.y === 0 && (pet.pose === 'sit' || pet.pose === 'stand')) { hop(170); pet.smallHop = true; }
    // a little note + floating "mew" text, then a heart
    burst('note', 1);
    particles.push({ kind: 'text', text: plan.text, x: pet.x + pet.dir * 85, y: CAT_H * 0.7, vx: pet.dir * 12, vy: 38, life: 1.6, age: 0 });
    setTimeout(() => burst('heart', 1), plan.ms);
  }

  // ---------- update loop ----------
  let last = performance.now();
  function update(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pet.t += dt;

    // dance routine: hop + flip a few times
    if (pet.dance) {
      pet.dance.t += dt;
      if (pet.dance.t > 0.35) {
        pet.dance.t = 0;
        pet.dance.step++;
        pet.dir = -pet.dir;
        if (pet.dance.step % 2 === 0) hop(385);
        if (pet.dance.step === 4) burst('heart', 3);
        if (pet.dance.step >= 8) pet.dance = null;
      }
    }

    // movement
    if (pet.target != null) {
      const speed = pet.pose === 'walk' ? WALK_SPEED : RUN_SPEED;
      const d = pet.target - pet.x;
      const step = speed * dt;
      if (Math.abs(d) <= step) {
        pet.x = pet.target;
        pet.target = null;
        pet.pose = pet.after;
      } else {
        pet.dir = Math.sign(d);
        pet.x += pet.dir * step;
      }
    }

    // jump physics
    if (pet.y > 0) {
      pet.vy -= 1900 * dt;
      pet.y += pet.vy * dt;
      if (pet.y <= 0) { pet.y = 0; pet.vy = 0; pet.smallHop = false; }
    }

    // animation frames
    const fps = pet.pose === 'run' ? 16 : pet.pose === 'walk' ? 10 : 4;
    pet.frameT += dt;
    if (pet.frameT > 1 / fps) { pet.frameT = 0; pet.frame++; }

    // blinking
    if (now > nextBlink) { blinkUntil = now + 140; nextBlink = now + 2200 + Math.random() * 3500; }

    // get bored and nap if nobody talks to it for a while
    const idle = now - pet.lastCmdAt;
    if (pet.target == null && !pet.dance) {
      if (idle > 150000 && pet.pose !== 'sleep') pet.pose = 'sleep';
    }

    // zzz
    if (pet.pose === 'sleep' && Math.random() < dt * 0.9) burst('zed', 1);

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > p.life) particles.splice(i, 1);
    }
  }

  // ---------- draw ----------
  function drawGlyph(rows, x, y, s, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let j = 0; j < rows.length; j++) {
      for (let i = 0; i < rows[j].length; i++) {
        if (rows[j][i] === '#') ctx.fillRect(Math.round(x + i * s), Math.round(y + j * s), s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw(now) {
    ctx.clearRect(0, 0, VW, VH);

    const pose = pet.y > 0 && pet.pose !== 'run' && !pet.smallHop ? 'jump' : pet.pose;
    let mouthOpen = false, tilt = 0;
    if (pet.meow) {
      const e = now - pet.meow.start;
      if (e > pet.meow.ms + 250) pet.meow = null;
      else {
        mouthOpen = pet.meow.mouth.some(([a, b]) => e >= a && e <= b);
        tilt = 0.07 * Math.sin(Math.PI * Math.min(1, e / (pet.meow.ms + 250)));
      }
    }
    const opts = {
      closed: now < blinkUntil && pose !== 'sleep',
      mouthOpen,
      happy: now < pet.happyUntil && !mouthOpen,
    };
    if (opts.happy) opts.closed = false;
    const sprite = Sprite.render(pose, pet.t, pet.frame, opts);

    const left = Math.round(pet.x - CAT_W / 2);
    const top = Math.round(VH - GROUND - CAT_H - pet.y);

    // shadow
    const shrink = Math.max(0.4, 1 - pet.y / 300);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(pet.x, VH - GROUND - 2, 58 * shrink, 7 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    // head-tilt while meowing: rotate a touch around the paws
    ctx.translate(pet.x, top + CAT_H);
    ctx.rotate(-tilt * pet.dir);
    ctx.translate(-pet.x, -(top + CAT_H));
    if (pet.dir < 0) {
      ctx.translate(left + CAT_W, top);
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, 0, 0, CAT_W, CAT_H);
    } else {
      ctx.drawImage(sprite, left, top, CAT_W, CAT_H);
    }
    ctx.restore();

    // particles
    for (const p of particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      const sy = VH - GROUND - p.y;
      if (p.kind === 'heart') drawGlyph(Sprite.HEART, p.x, sy, 3, '#ff5c8a', a);
      else if (p.kind === 'note') drawGlyph(Sprite.NOTE, p.x + pet.dir * 28, sy - 14, 3, '#8a6fd1', a);
      else if (p.kind === 'text') {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.font = '700 13px ui-monospace, "SF Mono", Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.lineWidth = 4; ctx.strokeStyle = '#fffaf3'; ctx.strokeText(p.text, p.x, sy);
        ctx.fillStyle = '#c2457a'; ctx.fillText(p.text, p.x, sy);
        ctx.restore();
      }
      else drawGlyph(Sprite.ZED, p.x + pet.dir * 48, sy - 20, 2 + p.age * 1.2, '#7e7796', a);
    }

    positionBubble();
  }

  function loop(now) {
    update(now);
    draw(now);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  // ---------- speech bubble ----------
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const bubbleMeta = document.getElementById('bubble-meta');
  let bubbleTimer = null;

  function positionBubble() {
    const x = Math.max(170, Math.min(VW - 170, pet.x));
    bubble.style.left = `${x}px`;
    bubble.style.bottom = `${GROUND + CAT_H + 18 + pet.y}px`;
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
    const top = VH - GROUND - CAT_H - pet.y;
    const inside = Math.abs(e.clientX - pet.x) < CAT_W * 0.4 && e.clientY > top + CAT_H * 0.25 && e.clientY < top + CAT_H;
    if (inside !== overCat) {
      overCat = inside;
      bridge.setIgnoreMouse(!inside);
      document.body.style.cursor = inside ? 'pointer' : 'default';
    }
  });
  window.addEventListener('mousedown', () => {
    if (!overCat) return;
    if (pet.pose === 'sleep') pet.pose = 'sit';
    execute('good');
    showBubble('purrrr ♥', '', 1200);
  });

  // say hi
  setTimeout(() => showBubble('Hi! Try <span class="cmd">sit</span>, <span class="cmd">run</span>, <span class="cmd">jump</span>…', 'powered by Smallest Pulse', 4000), 600);
})();
