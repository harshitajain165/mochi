// Mochi's illustrated poses + a light "rig" for each, so the drawings can
// move without new art. Each pose is a cut-out PNG from the character sheet
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
      file: 'sit.png', face: 'front', anchor: 0.59,
      parts: {
        tail: { box: [0.0, 0.55, 0.44, 1.02], pivot: [0.44, 0.95] },
        head: { box: [0.3, -0.02, 1.0, 0.47], pivot: [0.64, 0.47] },
      },
    },
    meow: {
      file: 'meow.png', face: 'front', anchor: 0.405,
      parts: {
        tail: { box: [0.56, 0.72, 1.02, 1.02], pivot: [0.58, 0.95] },
        head: { box: [0.0, -0.02, 0.8, 0.47], pivot: [0.4, 0.47] },
      },
    },
    back: {
      file: 'back.png', face: 'front', anchor: 0.408,
      parts: {
        tail: { box: [0.32, 0.68, 1.02, 1.02], pivot: [0.36, 0.95] },
        head: { box: [0.05, -0.02, 0.62, 0.36], pivot: [0.36, 0.36] },
      },
    },
    stand: {
      file: 'stand.png', face: 'left', anchor: 0.479,
      parts: {
        tail: { box: [0.64, 0.15, 1.02, 0.98], pivot: [0.68, 0.33] },
        head: { box: [-0.02, -0.02, 0.32, 0.42], pivot: [0.27, 0.38] },
      },
    },
    walk: {
      file: 'walk.png', face: 'left', anchor: 0.477,
      parts: {
        tail: { box: [0.66, -0.02, 1.02, 0.58], pivot: [0.7, 0.45] },
        head: { box: [-0.02, -0.02, 0.24, 0.55], pivot: [0.22, 0.45] },
        front: { box: [-0.02, 0.58, 0.33, 1.02], pivot: [0.2, 0.56] },
        hind: { box: [0.47, 0.6, 0.88, 1.02], pivot: [0.66, 0.6] },
      },
    },
    jump: {
      file: 'jump.png', face: 'left', anchor: 0.506,
      parts: {
        tail: { box: [0.6, -0.02, 1.02, 0.52], pivot: [0.66, 0.42] },
        head: { box: [0.06, 0.15, 0.27, 0.66], pivot: [0.26, 0.5] },
        front: { box: [-0.02, 0.68, 0.33, 1.02], pivot: [0.25, 0.66] },
        hind: { box: [0.52, 0.72, 0.9, 1.02], pivot: [0.66, 0.68] },
      },
    },
    stretch: {
      file: 'stretch.png', face: 'left', anchor: 0.572,
      parts: {
        tail: { box: [0.58, -0.02, 1.02, 0.42], pivot: [0.68, 0.4] },
        head: { box: [0.12, 0.38, 0.52, 0.9], pivot: [0.5, 0.62] },
      },
    },
    bow: {
      file: 'bow.png', face: 'left', anchor: 0.547,
      parts: {
        tail: { box: [0.44, -0.02, 0.98, 0.42], pivot: [0.6, 0.42] },
        head: { box: [-0.02, 0.33, 0.42, 0.96], pivot: [0.38, 0.56] },
      },
    },
    sleep: {
      file: 'sleep.png', face: 'left', anchor: 0.538,
      parts: {
        tail: { box: [0.3, 0.62, 1.02, 1.02], pivot: [0.42, 0.88] },
      },
    },
    play: {
      file: 'play.png', face: 'left', anchor: 0.569,
      parts: {
        tail: { box: [0.55, 0.52, 1.02, 1.02], pivot: [0.6, 0.6] },
        paws: { box: [0.28, -0.02, 0.78, 0.42], pivot: [0.55, 0.42] },
      },
    },
    reach: {
      file: 'reach.png', face: 'right', anchor: 0.433,
      parts: {
        tail: { box: [-0.02, -0.02, 0.42, 0.72], pivot: [0.3, 0.7] },
        head: { box: [0.4, 0.08, 0.86, 0.47], pivot: [0.55, 0.47] },
      },
    },
  };

  // Images arrive as ImageBitmaps (read through the main process, so WebGL
  // can use them without file:// cross-origin trouble).
  const images = {};
  async function loadOne(name, file) {
    try {
      let blob;
      if (window.petBridge && window.petBridge.readAsset) {
        const bytes = await window.petBridge.readAsset(file);
        blob = new Blob([bytes], { type: 'image/png' });
      } else {
        blob = await (await fetch(`cats/${file}`)).blob();
      }
      images[name] = await createImageBitmap(blob, { premultiplyAlpha: 'premultiply' });
    } catch (e) {
      console.error('could not load', file, e);
    }
  }
  const ready = Promise.all(Object.entries(POSES).map(([n, p]) => loadOne(n, p.file)));

  return { POSES, images, ready };
})();
