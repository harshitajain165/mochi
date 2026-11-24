// Mochi, chibi edition. Procedural pixel art on an 88×64 grid (facing right):
// round body, big head, huge shiny eyes, stubby legs, chubby tail.
// Every frame is drawn from simple shapes, auto-shaded (light on top edges,
// shadow underneath), outlined, then scaled up with nearest-neighbour so it
// stays crisp.

const Sprite = (() => {
  const W = 88;
  const H = 64;

  const C = {
    body: '#bdb7cc',     // soft lilac-grey
    light: '#dcd8e8',
    shade: '#9b94b0',
    far: '#a59fb9',      // far-side legs
    stripe: '#7e7796',
    cream: '#fffaf3',
    creamShade: '#ece3dc',
    pink: '#f5a3b8',
    blush: '#f8b9c8',
    eye: '#35284a',
    ink: '#2b2433',
    white: '#ffffff',
  };

  let grid = new Array(W * H).fill(null);
  const clear = () => grid.fill(null);
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const px = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (inb(x, y)) grid[y * W + x] = c; };
  const get = (x, y) => (inb(x, y) ? grid[y * W + x] : null);
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c); };
  function ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1.0) px(x, y, c);
      }
    }
  }
  function tri(a, b, c, col) {
    const minx = Math.floor(Math.min(a[0], b[0], c[0])), maxx = Math.ceil(Math.max(a[0], b[0], c[0]));
    const miny = Math.floor(Math.min(a[1], b[1], c[1])), maxy = Math.ceil(Math.max(a[1], b[1], c[1]));
    const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
    for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
      const p = [x, y], d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) px(x, y, col);
    }
  }
  function line(x0, y0, x1, y1, c, t = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      if (t <= 1) px(x, y, c); else ellipse(x, y, t / 2, t / 2, c);
    }
  }
  // smooth chubby tail along a quadratic curve
  function tail(p0, p1, p2, thick, tipC) {
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
      const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
      const r = thick * (0.75 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.2)));
      ellipse(x, y, r, r, t > 0.82 && tipC ? tipC : C.body);
    }
  }

  // ---------- parts ----------
  // big chibi head; (cx, cy) = centre of the skull
  function head(cx, cy, o = {}) {
    const look = o.look || 0;  // shifts the face toward the viewer (sitting)
    // ears (behind skull)
    tri([cx - 17, cy - 8], [cx - 5, cy - 15], [cx - 15, cy - 26], C.body);
    tri([cx + 5, cy - 15], [cx + 17, cy - 8], [cx + 14, cy - 26], C.body);
    tri([cx - 14, cy - 11], [cx - 8, cy - 14], [cx - 14, cy - 21], C.pink);
    tri([cx + 8, cy - 14], [cx + 14, cy - 11], [cx + 13, cy - 21], C.pink);
    // chin shadow + skull + fluffy cheeks
    ellipse(cx, cy + 2, 19, 17, C.shade);
    ellipse(cx, cy, 20, 17, C.body);
    ellipse(cx, cy + 6, 21, 10, C.body);
    px(cx - 21, cy + 9, C.body); px(cx + 21, cy + 9, C.body); px(cx - 20, cy + 11, C.body);
    // forehead stripes + cheek stripes
    for (const dx of [-4, 0, 4]) line(cx + dx, cy - 16, cx + dx * 0.7, cy - 11, C.stripe);
    line(cx - 21, cy + 2, cx - 16, cy + 3, C.stripe); line(cx - 21, cy + 5, cx - 16, cy + 5, C.stripe);
    // muzzle
    const mx = cx + 8 + look, my = cy + 7;
    ellipse(mx, my, 7.5, 5, C.cream);
    // eyes
    const ex1 = cx - 3 + look, ex2 = cx + 10 + look, ey = cy - 1;
    for (const ex of [ex1, ex2]) {
      if (o.closed) {
        px(ex - 3, ey + 1, C.eye); px(ex - 2, ey + 2, C.eye); px(ex - 1, ey + 3, C.eye); px(ex, ey + 3, C.eye);
        px(ex + 1, ey + 3, C.eye); px(ex + 2, ey + 2, C.eye); px(ex + 3, ey + 1, C.eye);
      } else if (o.happy) {
        px(ex - 3, ey + 3, C.eye); px(ex - 2, ey + 2, C.eye); px(ex - 1, ey + 1, C.eye); px(ex, ey, C.eye);
        px(ex + 1, ey + 1, C.eye); px(ex + 2, ey + 2, C.eye); px(ex + 3, ey + 3, C.eye);
        px(ex - 2, ey + 3, C.eye); px(ex + 2, ey + 3, C.eye);
      } else {
        ellipse(ex, ey + 1, 3.3, 4.3, C.eye);
        rect(ex - 2, ey - 2, 2, 2, C.white); px(ex - 1, ey, C.white);
        px(ex + 1, ey + 3, C.white); px(ex + 2, ey + 3, C.white);
      }
    }
    // blush
    rect(ex1 - 5, ey + 6, 3, 1, C.blush);
    rect(ex2 + 3, ey + 6, 3, 1, C.blush);
    // nose + mouth
    rect(mx + 2, my - 3, 3, 2, C.pink); px(mx + 3, my - 1, C.pink);
    if (o.mouthOpen) {
      ellipse(mx + 3, my + 2.5, 2.2, 2.2, C.ink); px(mx + 3, my + 4, C.pink); px(mx + 2, my + 4, C.pink);
    } else {
      px(mx + 1, my, C.ink); px(mx + 2, my + 1, C.ink); px(mx + 3, my, C.ink); px(mx + 4, my + 1, C.ink); px(mx + 5, my, C.ink);
    }
  }

  function whiskers(cx, cy, look = 0) {
    const mx = cx + 8 + look, my = cy + 7;
    // drawn after the outline so they sit on top, outside the face
    for (const [dy, ey] of [[-1, -3], [1, 1]]) line(mx + 8, my + dy, mx + 14, my + ey, C.ink);
  }

  function leg(x, top, bottom, far, w = 6) {
    rect(x, top, w, bottom - top, far ? C.far : C.body);
    ellipse(x + w / 2, bottom - 1, w / 2 + 0.6, 2, far ? C.creamShade : C.cream); // paw
  }
  // angled stubby leg for running: hip → foot
  function legA(hx, hy, fx, fy, far) {
    line(hx, hy, fx, fy - 2, far ? C.far : C.body, 6);
    ellipse(fx, fy - 1, 3.6, 2, far ? C.creamShade : C.cream);
  }

  function backStripes(cx, cy, rx, ry) {
    for (const dx of [-12, -5, 2]) {
      const x = cx + dx, top = cy - ry * Math.sqrt(Math.max(0, 1 - (dx / rx) ** 2));
      line(x, top + 1, x - 1, top + 4, C.stripe);
    }
  }

  // ---------- poses ----------
  const poses = {
    stand(t, f, o) {
      const sway = Math.sin(t * 2.2) * 3;
      tail([20, 50], [8, 48], [8 + sway, 32], 3.8, C.stripe);
      leg(22, 54, 62, true); leg(44, 54, 62, true);
      ellipse(36, 47, 20, 13, C.body);
      ellipse(38, 55, 12, 4.5, C.cream);
      backStripes(36, 47, 20, 13);
      leg(28, 55, 62, false); leg(50, 55, 62, false);
      head(60, 29, o);
    },

    walk(t, f, o) {
      const i = f % 6;
      const off = [-3, -1, 2, 3, 1, -2][i];
      const lift = [0, -1, -2, 0, 0, 0][i];
      const bob = i % 3 === 1 ? -1 : 0;
      const sway = Math.sin(t * 4) * 2;
      tail([20, 50 + bob], [8, 48 + bob], [9 + sway, 32 + bob], 3.8, C.stripe);
      leg(22 - off, 54 + bob, 62 + lift, true); leg(44 + off, 54 + bob, 62, true);
      ellipse(36, 47 + bob, 20, 13, C.body);
      ellipse(38, 55 + bob, 12, 4.5, C.cream);
      backStripes(36, 47 + bob, 20, 13);
      leg(28 + off, 55 + bob, 62, false); leg(50 - off, 55 + bob, 62 + lift, false);
      head(60, 29 + bob, o);
    },

    run(t, f, o) {
      const i = f % 6;
      const bob = [-3, -1, 0, -2, -4, -3][i];
      const FN = [[70, 60], [64, 62], [56, 62], [50, 61], [56, 58], [66, 58]];
      const BN = [[8, 59], [14, 62], [24, 62], [30, 61], [24, 58], [12, 58]];
      const j = (i + 1) % 6;
      tail([20, 46 + bob], [8, 44 + bob], [1, 38 + bob], 3.6, C.stripe);
      legA(50, 53 + bob, FN[j][0] - 3, FN[j][1], true);
      legA(24, 53 + bob, BN[j][0] + 3, BN[j][1], true);
      ellipse(38, 46 + bob, 22, 12, C.body);
      ellipse(40, 53 + bob, 13, 4, C.cream);
      backStripes(38, 46 + bob, 22, 12);
      legA(52, 53 + bob, FN[i][0], FN[i][1], false);
      legA(26, 53 + bob, BN[i][0], BN[i][1], false);
      head(63, 31 + bob, o);
    },

    jump(t, f, o) {
      tail([20, 44], [8, 40], [4, 26], 3.6, C.stripe);
      legA(50, 51, 64, 58, true); legA(24, 51, 10, 58, true);
      ellipse(38, 44, 22, 12, C.body);
      ellipse(40, 51, 13, 4, C.cream);
      backStripes(38, 44, 22, 12);
      legA(52, 51, 68, 56, false); legA(26, 51, 8, 56, false);
      head(63, 29, o);
    },

    sit(t, f, o) {
      const sway = Math.sin(t * 1.6) * 2;
      tail([22, 58], [22, 64], [42 + sway, 62], 3.4, C.stripe);
      ellipse(34, 50, 18, 12, C.body);         // round bottom
      ellipse(40, 53, 10, 7, C.cream);         // chest/belly
      leg(40, 56, 62, true, 5); leg(47, 56, 62, false, 5);
      head(44, 28, { ...o, look: -2 });
    },

    lie(t, f, o) {
      const sway = Math.sin(t * 1.2) * 2;
      tail([14, 58], [3, 63], [3 + sway, 52], 3.4, C.stripe);
      ellipse(34, 55, 24, 8, C.body);          // loaf
      backStripes(32, 55, 24, 8);
      ellipse(70, 61, 5, 2.2, C.cream); ellipse(78, 61, 5, 2.2, C.cream);   // paws peeking out
      head(60, 44, o);
    },

    sleep(t, f, o) {
      const breathe = Math.sin(t * 1.4) > 0 ? 1 : 0;
      tail([14, 60], [28, 64], [52, 62], 3.4, C.stripe);
      ellipse(34, 55 - breathe * 0.5, 24, 8 + breathe * 0.5, C.body);
      backStripes(32, 55, 24, 8);
      head(58, 46, { closed: true });
    },
  };

  // light on top edges, shadow along the bottom: gives the chonk volume
  function shadePass() {
    const g = grid.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = grid[y * W + x];
      if (c !== C.body) continue;
      const up = get(x, y - 1), up2 = get(x, y - 2);
      const dn = get(x, y + 1), dn2 = get(x, y + 2);
      if (!up || !up2) g[y * W + x] = C.light;
      else if (!dn || !dn2) g[y * W + x] = C.shade;
    }
    grid = g;
  }

  function outline() {
    const out = grid.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (grid[y * W + x]) continue;
      if (get(x - 1, y) || get(x + 1, y) || get(x, y - 1) || get(x, y + 1)) out[y * W + x] = C.ink;
    }
    grid = out;
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const rgb = {};
  const toRGB = (hex) => rgb[hex] || (rgb[hex] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16)));

  // where the head sits per pose (for whiskers drawn after the outline)
  const HEADS = {
    stand: () => [60, 29, 0], walk: (f) => [60, 29 + (f % 6 % 3 === 1 ? -1 : 0), 0],
    run: (f) => [63, 31 + [-3, -1, 0, -2, -4, -3][f % 6], 0], jump: () => [63, 29, 0],
    sit: () => [44, 28, -2], lie: () => [60, 44, 0], sleep: () => [58, 46, 0],
  };

  function render(pose, t, f, opts = {}) {
    clear();
    const fn = poses[pose] || poses.stand;
    fn(t, f, opts);
    shadePass();
    outline();
    const h = (HEADS[pose] || HEADS.stand)(f);
    whiskers(h[0], h[1], h[2]);
    const d = img.data;
    for (let k = 0; k < grid.length; k++) {
      const c = grid[k];
      if (c) {
        const [r, g, b] = toRGB(c);
        d[k * 4] = r; d[k * 4 + 1] = g; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
      } else {
        d[k * 4 + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // tiny pixel glyphs for particles
  const HEART = [
    '.##.##.',
    '#######',
    '#######',
    '.#####.',
    '..###..',
    '...#...',
  ];
  const ZED = [
    '#####',
    '...#.',
    '..#..',
    '.#...',
    '#####',
  ];

  const NOTE = [
    '..###',
    '..#.#',
    '..#..',
    '..#..',
    '###..',
    '###..',
  ];

  return { W, H, render, HEART, ZED, NOTE, colors: C };
})();
