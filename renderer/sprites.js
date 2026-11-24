// Procedural pixel-art cat. Every frame is drawn into a tiny 44x32 grid
// (facing right), then an outline pass runs, then it's blown up with
// nearest-neighbour scaling so it stays crisp.

const Sprite = (() => {
  const W = 44;
  const H = 32;

  const C = {
    body: '#f4a259',
    far: '#d98a45',     // far-side legs, a shade darker
    stripe: '#cf6f32',
    cream: '#fff1d6',
    pink: '#f7a1b5',
    ink: '#2a1f2d',
  };

  let grid = new Array(W * H).fill(null);
  const clear = () => grid.fill(null);
  const px = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < W && y < H) grid[y * W + x] = c;
  };
  const rect = (x, y, w, h, c) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(x + i, y + j, c);
  };
  // rectangle with the four corner pixels knocked off
  const rrect = (x, y, w, h, c) => {
    rect(x, y, w, h, c);
    grid[y * W + x] = null;
    grid[y * W + x + w - 1] = null;
    grid[(y + h - 1) * W + x] = null;
    grid[(y + h - 1) * W + x + w - 1] = null;
  };
  // thick line (Bresenham, stamped with a t x t square)
  const line = (x0, y0, x1, y1, c, t = 2) => {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      rect(x0, y0, t, t, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const poly = (pts, c, t = 2) => {
    for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], c, t);
  };

  // ---- parts ----
  // head origin (hx, hy) = top-left of the 11x10 head block
  function head(hx, hy, o = {}) {
    // ears
    px(hx + 1, hy - 3, C.body);
    rect(hx + 1, hy - 2, 2, 1, C.body);
    rect(hx + 1, hy - 1, 3, 1, C.body);
    px(hx + 8, hy - 3, C.body);
    rect(hx + 7, hy - 2, 2, 1, C.body);
    rect(hx + 6, hy - 1, 3, 1, C.body);
    px(hx + 2, hy - 1, C.pink);
    px(hx + 7, hy - 1, C.pink);
    // skull
    rrect(hx, hy, 11, 10, C.body);
    // forehead stripes
    px(hx + 4, hy, C.stripe); px(hx + 4, hy + 1, C.stripe);
    px(hx + 6, hy, C.stripe); px(hx + 6, hy + 1, C.stripe);
    // muzzle + cheeks
    rect(hx + 5, hy + 6, 6, 3, C.cream);
    px(hx + 10, hy + 6, C.body);
    // eyes
    if (o.closed) {
      rect(hx + 2, hy + 4, 2, 1, C.ink);
      rect(hx + 6, hy + 4, 2, 1, C.ink);
    } else if (o.happy) {
      px(hx + 2, hy + 4, C.ink); px(hx + 3, hy + 3, C.ink); px(hx + 4, hy + 4, C.ink);
      px(hx + 6, hy + 4, C.ink); px(hx + 7, hy + 3, C.ink); px(hx + 8, hy + 4, C.ink);
    } else {
      rect(hx + 3, hy + 3, 1, 2, C.ink);
      rect(hx + 7, hy + 3, 1, 2, C.ink);
    }
    // nose + mouth
    px(hx + 10, hy + 5, C.pink);
    if (o.mouthOpen) {
      rect(hx + 8, hy + 7, 2, 2, C.ink);
      px(hx + 8, hy + 8, C.pink);
    } else {
      px(hx + 9, hy + 7, C.ink);
    }
  }

  function leg(x0, y0, x1, y1, far) {
    line(x0, y0, x1, y1 - 1, far ? C.far : C.body, 2);
    rect(x1, y1, 2, 1, C.cream); // paw
  }

  function tail(pts, sway) {
    const p = pts.map((q, i) => [q[0] + (i === pts.length - 1 ? sway : i === pts.length - 2 ? sway * 0.5 : 0), q[1]]);
    poly(p, C.body, 2);
    const tip = p[p.length - 1];
    rect(tip[0], tip[1], 2, 2, C.stripe);
  }

  // ---- poses ----
  // t = time in seconds, f = animation frame index, o = extra flags
  const poses = {
    stand(t, f, o) {
      const sway = Math.round(Math.sin(t * 2.2) * 1.5);
      tail([[12, 18], [8, 15], [6, 11], [7, 7]], sway);
      leg(16, 21, 16, 30, true);
      leg(30, 21, 30, 30, true);
      rrect(11, 15, 21, 8, C.body);
      rect(15, 21, 12, 2, C.cream);
      [15, 19, 23].forEach((x) => rect(x, 15, 1, 2, C.stripe));
      leg(13, 21, 13, 30, false);
      leg(27, 21, 27, 30, false);
      rect(28, 15, 4, 5, C.cream);
      head(27, 7, o);
    },

    sit(t, f, o) {
      const sway = Math.round(Math.sin(t * 1.6) * 1.5);
      tail([[14, 29], [8, 29], [4, 28], [3, 25]], sway);
      rrect(11, 19, 13, 11, C.body);          // haunch
      [13, 16].forEach((x) => rect(x, 20, 1, 2, C.stripe));
      rrect(17, 13, 10, 14, C.body);          // torso
      rect(23, 13, 4, 8, C.cream);            // chest
      rect(21, 30, 3, 1, C.cream);            // back paw
      leg(25, 20, 25, 30, true);
      leg(27, 20, 27, 30, false);
      head(21, 4, o);
    },

    lie(t, f, o) {
      const sway = Math.round(Math.sin(t * 1.2) * 1.5);
      tail([[11, 28], [6, 29], [2, 29], [1, 26]], sway);
      rrect(9, 22, 23, 8, C.body);
      [13, 17, 21].forEach((x) => rect(x, 22, 1, 2, C.stripe));
      rect(30, 28, 8, 2, C.body);             // front paws stretched out
      rect(37, 28, 2, 2, C.cream);
      head(27, 15, o);
    },

    sleep(t, f, o) {
      const breathe = Math.sin(t * 1.4) > 0 ? 1 : 0;
      tail([[11, 29], [6, 30], [2, 30], [1, 28]], 0);
      rrect(9, 22 - breathe, 23, 8 + breathe, C.body);
      [13, 17, 21].forEach((x) => rect(x, 22 - breathe, 1, 2, C.stripe));
      rect(30, 28, 6, 2, C.body);
      rect(34, 28, 2, 2, C.cream);
      head(26, 20, { closed: true });
    },

    run(t, f, o) {
      const i = f % 4;
      const bob = [-2, 0, -1, 0][i];
      const FN = [[35, 28], [31, 30], [24, 29], [28, 30]];
      const BN = [[6, 28], [10, 30], [19, 29], [15, 30]];
      const j = (i + 1) % 4;
      tail([[12, 16 + bob], [7, 13 + bob], [3, 11 + bob], [1, 9 + bob]], 0);
      leg(28, 20 + bob, FN[j][0] - 1, FN[j][1], true);
      leg(14, 20 + bob, BN[j][0] + 1, BN[j][1], true);
      rrect(11, 14 + bob, 22, 7, C.body);
      rect(15, 19 + bob, 12, 2, C.cream);
      [15, 19, 23].forEach((x) => rect(x, 14 + bob, 1, 2, C.stripe));
      leg(28, 20 + bob, FN[i][0], FN[i][1], false);
      leg(14, 20 + bob, BN[i][0], BN[i][1], false);
      head(29, 7 + bob, o);
    },

    walk(t, f, o) {
      const i = f % 4;
      const off = [2, 0, -2, 0][i];
      const bob = i % 2 === 0 ? 0 : -1;
      const sway = Math.round(Math.sin(t * 3) * 1);
      tail([[12, 18 + bob], [8, 15 + bob], [6, 11 + bob], [7, 7 + bob]], sway);
      leg(16, 21 + bob, 16 - off, 30, true);
      leg(30, 21 + bob, 30 + off, 30, true);
      rrect(11, 15 + bob, 21, 8, C.body);
      rect(15, 21 + bob, 12, 2, C.cream);
      [15, 19, 23].forEach((x) => rect(x, 15 + bob, 1, 2, C.stripe));
      leg(13, 21 + bob, 13 + off, 30, false);
      leg(27, 21 + bob, 27 - off, 30, false);
      rect(28, 15 + bob, 4, 5, C.cream);
      head(27, 7 + bob, o);
    },

    jump(t, f, o) {
      tail([[12, 15], [7, 12], [4, 9], [3, 6]], 0);
      leg(28, 20, 34, 26, true);
      leg(14, 20, 8, 27, true);
      rrect(11, 14, 22, 7, C.body);
      rect(15, 19, 12, 2, C.cream);
      [15, 19, 23].forEach((x) => rect(x, 14, 1, 2, C.stripe));
      leg(28, 20, 35, 25, false);
      leg(14, 20, 7, 26, false);
      head(29, 6, o);
    },
  };

  function outline() {
    const out = grid.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y * W + x]) continue;
        const n = (xx, yy) => xx >= 0 && yy >= 0 && xx < W && yy < H && grid[yy * W + xx];
        if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) out[y * W + x] = C.ink;
      }
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

  function render(pose, t, f, opts = {}) {
    clear();
    (poses[pose] || poses.stand)(t, f, opts);
    outline();
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

  return { W, H, render, HEART, ZED, colors: C };
})();
