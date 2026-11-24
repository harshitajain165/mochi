# Mochi: a chibi pixel cat that listens 🐈

A chibi pixel cat that lives along the bottom of your screen and does what you tell it, using **Smallest AI Pulse** real-time speech-to-text.

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
| **lie down** / **down** | lies down |
| **sleep** / **wake up** | naps (Zzz) / wakes up |
| **come here** | runs to your mouse cursor and sits |
| **turn around** | flips direction |
| **dance** | does a little dance |
| **meow** / **speak** | meows |
| **good kitty** | shows hearts |

If you say more than one command, the last one wins ("sit… no, run!" → it runs). Click the cat to pet it. The rest of the window is click-through, so it never blocks your apps.

**Tray / menu-bar icon:** mute, hide the HUD, reconnect, quit. **⌘/Ctrl+Shift+M** mutes the mic.

## How it works

- `main.js` opens the WebSocket to `wss://api.smallest.ai/waves/v1/stt/live?model=pulse` (16 kHz linear16) with your key in the `Authorization` header. The key never reaches the page.
- `renderer/pcm-worklet.js` captures the mic at 16 kHz and sends 50 ms PCM chunks to the main process over IPC.
- `renderer/commands.js` holds the command words. Edit it to add tricks.
- `renderer/sprites.js` draws Mochi in code: a chibi lilac-grey tabby on an 88×64 pixel grid, built from simple shapes, auto-shaded and outlined (no image files). Colours live in one palette at the top of the file.

## Demo tips

- Use short, sharp commands: "sit." pause, "run!" pause, "jump!" Short words are the point.
- Background talk can trigger common words like "up", "down", "go" and "right". Mute with ⌘⇧M while you explain, or remove those words from `commands.js`.
