# Mochi: a fluffy cat that listens 🐈

A hand-drawn fluffy cat that lives along the bottom of your screen and does what you tell it, using **Smallest AI Pulse** real-time speech-to-text.

Built to show off Pulse on **short utterances**: commands fire on *interim* transcripts, so the cat often moves before you've finished the word.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer and a Smallest AI API key ([get one here](https://app.smallest.ai/dashboard/api-keys)).

```bash
git clone https://github.com/harshitajain165/mochi.git
cd mochi
cp .env.example .env        # then open .env and paste your key into SMALLEST_API_KEY
npm install
npm start
```

The cat appears along the bottom of your screen. macOS asks for microphone access the first time: allow it for Terminal (or Electron). To quit, use the cat icon in the menu bar (macOS) or system tray (Windows).

**Troubleshooting**

- *Status says "API key rejected":* check the key in `.env`, then use **Reconnect** in the tray menu.
- *No reaction when you talk:* check System Settings → Privacy & Security → Microphone and make sure Terminal is allowed, then restart the app.
- *Wrong language:* set `PET_LANGUAGE` in `.env` (e.g. `hi`).

## Talk to it

| Say | It does |
|---|---|
| **sit** | sits |
| **stand** / **up** | stands |
| **run** | runs across the screen (turns around if it's already at the edge) |
| **left** / **right** | runs that way |
| **walk** | wanders a few steps |
| **stop** / **stay** | stops where it is |
| **jump** | hops |
| **lie down** / **down** | gets low with her head on her paws |
| **sleep** / **wake up** | naps (Zzz) / wakes up |
| **come here** | runs to your mouse cursor and sits |
| **turn around** | flips direction (shows you her back if she's sitting) |
| **stretch** | big stretch |
| **play** / **roll over** | rolls onto her back |
| **catch** / **high five** | paws at a butterfly |
| **dance** | does a little dance |
| **meow** / **speak** | meows |
| **good kitty** | rolls over with hearts |

If you say more than one command, the last one wins ("sit… no, run!" → it runs). Click the cat to pet it. The rest of the window is click-through, so it never blocks your apps.

**Tray / menu-bar icon:**** mute, hide the HUD, reconnect, quit. **⌘/Ctrl+Shift+M** mutes the mic.

## How it works

- `main.js` opens the WebSocket to `wss://api.smallest.ai/waves/v1/stt/live?model=pulse` (16 kHz linear16) with your key in the `Authorization` header. The key never reaches the page.
- `renderer/pcm-worklet.js` captures the mic at 16 kHz and sends 50 ms PCM chunks to the main process over IPC.
- `renderer/commands.js` holds the command words. Edit it to add tricks.
- `renderer/anim/` holds Mochi's animation frames, cut from a reference animation of the character: getting up from a sit and walking off, a full walk stride, crouch and take-off, a bounding run, landing and settling, sitting back down, and easing into a stretch. `anim/manifest.js` records where each frame sits so they line up on the ground.
- `renderer/cat.js` lists the still poses from the character sheet (`art-reference.png`) used for resting and tricks, with a small rig so tails and heads stay alive.
- `renderer/pet.js` is the state machine. It decides which clip leads into which, so every change plays its in-between frames: sit → get up → walk, walk → crouch → run, run → land → stand → sit down. Speed comes from the clips, so feet don't slide.
- `renderer/gl.js` draws everything with WebGL.

## Demo tips

- Use short, sharp commands: "sit." pause, "run!" pause, "jump!" Short words are the point.
- Background talk can trigger common words like "up", "down", "go" and "right". Mute with ⌘⇧M while you explain, or remove those words from `commands.js`.
