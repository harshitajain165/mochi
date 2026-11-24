// Mochi's still poses (from the character sheet) + a light "rig" for each so
// tails and heads stay alive while resting. Movement uses video frames instead. Each pose is a cut-out PNG from the character sheet
// (art-reference.png), drawn as a deformable mesh by gl.js.
//
// Coordinates are normalised to the image: u = 0 left … 1 right,
// v = 0 top … 1 bottom, in the drawing's own facing.
//   face   : which way the drawing looks ('left' | 'right' | 'front')
//   anchor : horizontal centre of mass (keeps the body steady between poses)
//   parts  : bendable regions. box = [u0, v0, u1, v1], pivot = [u, v]

const Cat = (() => {
  const POSES = {
    sit: {
      file: 'sit.png', face: 'front', anchor: 0.658,
      parts: {
        tail: { box: [0.0, 0.55, 0.44, 1.02], pivot: [0.44, 0.95] },
        head: { box: [0.3, -0.02, 1.0, 0.47], pivot: [0.64, 0.47] },
      },
    },
    meow: {
      file: 'meow.png', face: 'front', anchor: 0.368,
      parts: {
        tail: { box: [0.56, 0.72, 1.02, 1.02], pivot: [0.58, 0.95] },
        head: { box: [0.0, -0.02, 0.8, 0.47], pivot: [0.4, 0.47] },
      },
    },
    back: {
      file: 'back.png', face: 'front', anchor: 0.341,
      parts: {
        tail: { box: [0.32, 0.68, 1.02, 1.02], pivot: [0.36, 0.95] },
        head: { box: [0.05, -0.02, 0.62, 0.36], pivot: [0.36, 0.36] },
      },
    },
    bow: {
      file: 'bow.png', face: 'left', anchor: 0.56,
      parts: {
        tail: { box: [0.44, -0.02, 0.98, 0.42], pivot: [0.6, 0.42] },
        head: { box: [-0.02, 0.33, 0.42, 0.96], pivot: [0.38, 0.56] },
      },
    },
    sleep: {
      file: 'sleep.png', face: 'left', anchor: 0.561,
      parts: {
        tail: { box: [0.3, 0.62, 1.02, 1.02], pivot: [0.42, 0.88] },
      },
    },
    play: {
      file: 'play.png', face: 'left', anchor: 0.562,
      parts: {
        tail: { box: [0.55, 0.52, 1.02, 1.02], pivot: [0.6, 0.6] },
        paws: { box: [0.28, -0.02, 0.78, 0.42], pivot: [0.55, 0.42] },
      },
    },
    reach: {
      file: 'reach.png', face: 'right', anchor: 0.484,
      parts: {
        tail: { box: [-0.02, -0.02, 0.42, 0.72], pivot: [0.3, 0.7] },
        head: { box: [0.4, 0.08, 0.86, 0.47], pivot: [0.55, 0.47] },
      },
    },
  };

  // Images arrive as ImageBitmaps (read through the main process, so WebGL
  // can use them without file:// cross-origin trouble).
  // Sheet poses live in cats/, video frames (see anim/manifest.js) in anim/.
  const images = {};   // sheet poses by name
  const frames = {};   // video frames by index
  async function loadBitmap(rel) {
    let blob;
    const type = rel.endsWith('.webp') ? 'image/webp' : 'image/png';
    if (window.petBridge && window.petBridge.readAsset) {
      const bytes = await window.petBridge.readAsset(rel);
      blob = new Blob([bytes], { type });
    } else {
      blob = await (await fetch(rel)).blob();
    }
    return createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
  }
  const jobs = [
    ...Object.entries(POSES).map(async ([n, p]) => {
      try { images[n] = await loadBitmap(`cats/${p.file}`); } catch (e) { console.error('pose', n, e); }
    }),
    ...Object.entries(ANIM.frames).map(async ([i, f]) => {
      try { frames[i] = await loadBitmap(`anim/${f.file}`); } catch (e) { console.error('frame', i, e); }
    }),
  ];
  const ready = Promise.all(jobs);

  return { POSES, images, frames, ready };
})();
