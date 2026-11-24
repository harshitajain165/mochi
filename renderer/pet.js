// Mochi — renderer: mic capture → main (→ Smallest Pulse), command
// handling, the cat's little state machine, and drawing.

(() => {
  const bridge = window.petBridge;
  const S = 0.85;                        // art scale (sheet px → screen px)
  const GROUND = 12;                     // px from window bottom to paws
  const RUN_SPEED = 560;                 // px/s
  const WALK_SPEED = 95;
  const TEMP_MS = 2600;                  // how long one-off tricks last

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
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- pet state ----------
  // pose: stand | sit | lie | sleep | walk | run | stretch | play | reach | back
  const pet = {
    x: VW * 0.62,
    dir: -1,             // 1 = facing right, -1 = left
    pose: 'sit',
    rest: 'sit',         // pose to return to after a one-off trick
    temp: null,          // { pose, until }
    target: null,
    after: 'stand',
    y: 0, vy: 0,
    t: 0,
    lastCmdAt: performance.now(),
    meowUntil: 0,
    dance: null,
  };
  const particles = [];
  const RESTING = new Set(['stand', 'sit', 'lie', 'sleep']);

  const halfW = () => ((Cat.images[currentImage()] || {}).width || 200) * S / 2;
  const clampX = (x) => Math.max(110, Math.min(VW - 110, x));

  function setPose(p) {
    pet.temp = null;
    pet.pose = p;
    if (RESTING.has(p)) pet.rest = p;
  }

  function trick(p, ms = TEMP_MS) {
    pet.target = null;
    pet.temp = { pose: p, until: performance.now() + ms };
  }

  function moveTo(x, speedPose, after = 'stand') {
    pet.temp = null;
    pet.target = clampX(x);
    pet.dir = pet.target >= pet.x ? 1 : -1;
    pet.pose = speedPose;
    pet.after = after;
  }

  function runAcross(dir) {
    const margin = 110;
    if (dir == null) {
      dir = pet.dir;
      if ((dir > 0 && pet.x > VW - margin - 150) || (dir < 0 && pet.x < margin + 150)) dir = -dir;
    }
    moveTo(dir > 0 ? VW - margin : margin, 'run');
  }

  function hop(power = 560) {
    if (pet.y > 0) return;
    pet.vy = power;
    pet.y = 0.01;
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

  // ---------- command execution ----------
  async function execute(cmd) {
    pet.lastCmdAt = performance.now();
    pet.dance = null;
    const moving = pet.pose === 'run' || pet.pose === 'walk';
    switch (cmd) {
      case 'sit': pet.target = null; setPose('sit'); break;
      case 'stand':
      case 'wake': pet.target = null; setPose('stand'); break;
      case 'lie': pet.target = null; setPose('lie'); break;
      case 'sleep': pet.target = null; setPose('sleep'); break;
      case 'stop': pet.target = null; if (moving || pet.temp) setPose('stand'); break;
      case 'run': runAcross(); break;
      case 'run_left': runAcross(-1); break;
      case 'run_right': runAcross(1); break;
      case 'walk': moveTo(pet.x + pet.dir * 380, 'walk'); break;
      case 'jump': if (!moving) setPose('stand'); hop(); break;
      case 'stretch': trick('stretch'); break;
      case 'play': trick('play'); burst('sparkle', 3); break;
      case 'reach': trick('reach'); break;
      case 'turn':
        pet.dir = -pet.dir;
        if (pet.target != null) runAcross(pet.dir);
        else if (pet.pose === 'sit' || pet.pose === 'stand') trick('back', 1600);
        break;
      case 'dance': pet.target = null; setPose('stand'); pet.dance = { t: 0, step: 0 }; break;
      case 'meow':
        if (pet.pose === 'sleep') setPose('sit');
        pet.meowUntil = performance.now() + 1200;
        meowSound();
        break;
      case 'good':
        trick('play', 1800);
        burst('heart', 5);
        burst('sparkle', 2);
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

  // ---------- which drawing to show ----------
  function currentImage(now = performance.now()) {
    if (pet.temp) return pet.temp.pose;
    if (pet.pose === 'run' || pet.y > 0) return 'jump';
    if (pet.pose === 'walk') return 'walk';
    if (pet.pose === 'lie') return 'bow';
    if (pet.pose === 'sleep') return 'sleep';
    if (pet.pose === 'sit' && now < pet.meowUntil) return 'meow';
    return pet.pose;               // stand | sit
  }
  const currentHeight = () => ((Cat.images[currentImage()] || {}).height || 180) * S;

  // ---------- update loop ----------
  let last = performance.now();
  function update(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pet.t += dt;

    if (pet.temp && now > pet.temp.until) { pet.temp = null; pet.pose = pet.rest; }

    if (pet.dance) {
      pet.dance.t += dt;
      if (pet.dance.t > 0.45) {
        pet.dance.t = 0;
        pet.dance.step++;
        const seq = ['reach', 'play', 'reach', 'stand'];
        pet.dir = -pet.dir;
        pet.temp = { pose: seq[pet.dance.step % seq.length], until: now + 450 };
        if (pet.dance.step % 2 === 0) hop(360);
        if (pet.dance.step === 4) burst('sparkle', 4);
        if (pet.dance.step >= 8) { pet.dance = null; pet.temp = null; setPose('sit'); }
      }
    }

    if (pet.target != null) {
      const speed = pet.pose === 'walk' ? WALK_SPEED : RUN_SPEED;
      const d = pet.target - pet.x;
      const step = speed * dt;
      if (Math.abs(d) <= step) {
        pet.x = pet.target;
        pet.target = null;
        setPose(pet.after);
      } else {
        pet.dir = Math.sign(d);
        pet.x += pet.dir * step;
      }
    }

    if (pet.y > 0) {
      pet.vy -= 1900 * dt;
      pet.y += pet.vy * dt;
      if (pet.y <= 0) { pet.y = 0; pet.vy = 0; }
    }

    const idle = now - pet.lastCmdAt;
    if (pet.target == null && !pet.dance && !pet.temp && idle > 150000 && pet.pose !== 'sleep') setPose('sleep');

    if (pet.pose === 'sleep' && !pet.temp && Math.random() < dt * 0.8) burst('zed', 1);

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.age > p.life) particles.splice(i, 1);
    }
  }

  // ---------- draw ----------
  let shownImg = null, prevImg = null, changedAt = 0, prevFlip = false;

  function drawCat(name, alpha, pop, now) {
    const img = Cat.images[name];
    if (!img) return null;
    const meta = Cat.POSES[name];
    const w = img.width * S, h = img.height * S;
    const flip = (meta.face === 'left' && pet.dir > 0) || (meta.face === 'right' && pet.dir < 0);

    // per-pose life: breathing, bobbing, bounding
    let lift = pet.y, rot = 0, sx = 1, sy = 1;
    const t = pet.t;
    if (pet.pose === 'run' && !pet.temp) {
      const ph = Math.abs(Math.sin(t * 10));
      lift += ph * 18;
      rot = (Math.cos(t * 10) * 0.05) * (flip ? -1 : 1);
      sy = 0.96 + ph * 0.06; sx = 1.04 - ph * 0.05;
    } else if (name === 'walk') {
      lift += Math.abs(Math.sin(t * 7)) * 3;
      rot = Math.sin(t * 7) * 0.018;
    } else if (name === 'play') {
      rot = Math.sin(t * 7) * 0.09;
    } else if (name === 'sleep') {
      sy = 1 + Math.sin(t * 1.5) * 0.025; sx = 1 - Math.sin(t * 1.5) * 0.01;
    } else if (name === 'reach') {
      lift += Math.abs(Math.sin(t * 3)) * 4;
    } else {
      sy = 1 + Math.sin(t * 2.2) * 0.012;
    }
    sx *= pop; sy *= pop;

    const baseY = VH - GROUND - lift;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(pet.x, baseY);
    ctx.rotate(rot);
    ctx.scale(flip ? -sx : sx, sy);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
    return { w, h };
  }

  function star(x, y, r, color, a, spin) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    ctx.rotate(spin * 0.15);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 === 0 ? r : r * 0.22;
      const ang = (i * Math.PI) / 4 - Math.PI / 2;
      ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function heart(x, y, s, a) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#ec7fb0';
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-7, -2, -4, -9, 0, -5);
    ctx.bezierCurveTo(4, -9, 7, -2, 0, 4);
    ctx.fill();
    ctx.restore();
  }

  function draw(now) {
    ctx.clearRect(0, 0, VW, VH);
    const name = currentImage(now);
    if (name !== shownImg) { prevImg = shownImg; shownImg = name; changedAt = now; }
    const k = Math.min(1, (now - changedAt) / 170);
    const ease = 1 - Math.pow(1 - k, 3);

    // soft lavender shadow, like the sheet's
    const img = Cat.images[name];
    const w = img ? img.width * S : 160;
    const shrink = Math.max(0.45, 1 - pet.y / 260);
    ctx.fillStyle = 'rgba(120, 100, 160, 0.16)';
    ctx.beginPath();
    ctx.ellipse(pet.x, VH - GROUND - 1, w * 0.38 * shrink, 6 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();

    if (prevImg && k < 1) drawCat(prevImg, 1 - ease, 1, now);
    drawCat(name, prevImg ? ease : 1, 0.94 + 0.06 * ease, now);

    for (const p of particles) {
      const a = Math.max(0, 1 - p.age / p.life);
      const sy = VH - GROUND - p.y;
      if (p.kind === 'heart') heart(p.x, sy, 1.6, a);
      else if (p.kind === 'sparkle') star(p.x, sy, 9 + 4 * Math.sin(p.age * 6), '#ec7fb0', a, p.spin + p.age * 4);
      else {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = '#7a6aa8';
        ctx.font = `600 ${14 + p.age * 8}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
        ctx.fillText('z', p.x + pet.dir * 40, sy - 10);
        ctx.restore();
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

  // ---------- speech bubble ----------
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const bubbleMeta = document.getElementById('bubble-meta');
  let bubbleTimer = null;

  function positionBubble() {
    const x = Math.max(170, Math.min(VW - 170, pet.x));
    bubble.style.left = `${x}px`;
    bubble.style.bottom = `${GROUND + currentHeight() + 16 + pet.y}px`;
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
  let lastVoiceAt = 0;     // last time the mic heard speech energy
  let speaking = false;

  bridge.onTranscript((m) => {
    const text = (m.transcript || '').trim();
    if (text) {
      const hit = Commands.findLast(text);
      if (hit) {
        const key = `${hit.cmd}@${hit.start}`;
        if (key !== firedKey) {
          firedKey = key;
          execute(hit.cmd);
          const now = performance.now();
          const gap = Math.round(now - lastVoiceAt);
          const meta = !lastVoiceAt || gap > 5000 ? 'powered by Smallest Pulse'
            : speaking || gap < 40
            ? '⚡ reacted while you were still talking'
            : `⚡ ${gap} ms after you stopped talking`;
          showBubble(highlight(hit), meta);
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
  // 50 ms chunks of Int16 PCM and reports their loudness for the meter/VAD.
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
        // simple energy VAD, only used for the latency readout + meter
        const rms = data.rms;
        if (rms < noiseFloor * 2) noiseFloor = noiseFloor * 0.98 + rms * 0.02;
        const isVoice = rms > Math.max(0.02, noiseFloor * 3);
        if (isVoice) lastVoiceAt = performance.now();
        speaking = isVoice;
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
    const h = currentHeight();
    const top = VH - GROUND - h - pet.y;
    const inside = Math.abs(e.clientX - pet.x) < halfW() * 0.75 && e.clientY > top + h * 0.15 && e.clientY < top + h;
    if (inside !== overCat) {
      overCat = inside;
      bridge.setIgnoreMouse(!inside);
      document.body.style.cursor = inside ? 'pointer' : 'default';
    }
  });
  window.addEventListener('mousedown', () => {
    if (!overCat) return;
    if (pet.pose === 'sleep') setPose('sit');
    burst('heart', 4);
    showBubble('purrrr ♥', '', 1200);
  });

  // say hi
  setTimeout(() => showBubble('Hi, I\'m Mochi! Try <span class="cmd">sit</span>, <span class="cmd">run</span>, <span class="cmd">stretch</span>…', 'powered by Smallest Pulse', 4200), 700);
})();
