// Voice command vocabulary. Phrases are matched on word boundaries;
// longer phrases win at the same position, and the LAST command in an
// utterance is the one that counts ("sit… no, run!" → run).

const Commands = (() => {
  const TABLE = {
    sit: ['sit', 'sit down', 'sits', 'sitting'],
    stand: ['stand', 'stand up', 'up', 'get up', 'on your feet'],
    run_left: ['run left', 'go left', 'left'],
    run_right: ['run right', 'go right', 'right'],
    run: ['run', 'go', 'zoom', 'sprint', 'run away', 'go go go'],
    walk: ['walk', 'walk around', 'stroll'],
    stop: ['stop', 'stay', 'freeze', 'halt', 'wait'],
    jump: ['jump', 'hop', 'jump up'],
    lie: ['lie down', 'lay down', 'down', 'lie', 'lay'],
    sleep: ['sleep', 'go to sleep', 'nap', 'take a nap', 'goodnight', 'good night'],
    wake: ['wake up', 'wake', 'wakey wakey'],
    come: ['come', 'come here', 'here', 'come back', 'here kitty'],
    turn: ['turn around', 'turn', 'spin around', 'about face'],
    dance: ['dance', 'spin', 'party'],
    meow: ['meow', 'speak', 'say something', 'talk'],
    good: ['good kitty', 'good cat', 'good boy', 'good girl', 'good job', 'well done', 'i love you'],
  };

  const phrases = [];
  for (const [cmd, list] of Object.entries(TABLE)) {
    for (const p of list) phrases.push({ cmd, words: p.split(' ') });
  }
  phrases.sort((a, b) => b.words.length - a.words.length);

  const normalize = (s) => s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // returns { cmd, start, end, words[] } or null
  function findLast(text) {
    const words = normalize(text).split(' ').filter(Boolean);
    let last = null;
    let i = 0;
    while (i < words.length) {
      let hit = null;
      for (const p of phrases) {
        if (p.words.every((w, k) => words[i + k] === w)) { hit = p; break; }
      }
      if (hit) {
        last = { cmd: hit.cmd, start: i, end: i + hit.words.length, words };
        i += hit.words.length;
      } else {
        i++;
      }
    }
    return last;
  }

  return { findLast, normalize, TABLE };
})();
