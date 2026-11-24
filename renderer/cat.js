// Mochi's illustrated poses. Each pose is a cut-out PNG from the art sheet
// (art-reference.png). `face` is which way the drawing looks: 'left',
// 'right', or 'front' (front/back views never get mirrored).

const Cat = (() => {
  const POSES = {
    sit:     { file: 'sit.png',     face: 'front' },
    meow:    { file: 'meow.png',    face: 'front' },
    back:    { file: 'back.png',    face: 'front' },
    stand:   { file: 'stand.png',   face: 'left' },
    walk:    { file: 'walk.png',    face: 'left' },
    jump:    { file: 'jump.png',    face: 'left' },
    stretch: { file: 'stretch.png', face: 'left' },
    bow:     { file: 'bow.png',     face: 'left' },
    sleep:   { file: 'sleep.png',   face: 'left' },
    play:    { file: 'play.png',    face: 'left' },
    reach:   { file: 'reach.png',   face: 'right' },
  };

  const images = {};
  const ready = Promise.all(
    Object.entries(POSES).map(([name, p]) => new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { images[name] = img; resolve(); };
      img.onerror = () => resolve();
      img.src = `cats/${p.file}`;
    })),
  );

  return { POSES, images, ready };
})();
