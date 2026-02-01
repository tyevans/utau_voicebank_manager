# UTAU Voicebank Manager

**Create your own singing voice for UTAU/OpenUTAU - the easy way!**

A web app that helps you record, organize, and configure voicebanks for [UTAU](https://en.wikipedia.org/wiki/Utau) and [OpenUTAU](https://www.openutau.com/). Instead of manually editing `oto.ini` files line by line, use our visual editor with AI-powered suggestions!

---

## Quick Start

The fastest way to get running is with Docker:

```bash
git clone https://github.com/yourusername/utau_voicebank_manager.git
cd utau_voicebank_manager
docker compose up --build
```

> **Note:** The first build can take up to 5 minutes while Python and model dependencies are installed. Subsequent starts are much faster.

Open **http://localhost:8989** in your browser.

Your data persists in local folders:
- `./data` - Voicebank projects
- `./models` - Downloaded ML models

---

## What Can It Do?

- **Guided Recording** - Follow on-screen prompts to record all the sounds you need
- **Visual Oto Editor** - See your audio waveforms and drag markers to set timing
- **AI Phoneme Detection** - Let the computer find where sounds start and end
- **Multi-Style Support** - Works with CV, VCV, CVVC, and ARPAsing voicebanks
- **Preview Your Work** - Listen to samples with your oto settings applied

---

## How to Use It

### Creating a New Voicebank

1. Click **"New Voicebank"** on the welcome screen
2. Give it a name (like your character's name)
3. Choose your recording style:
   - **CV** - Simple consonant-vowel (good for beginners!)
   - **VCV** - Smoother vowel transitions
   - **CVVC** - For English voices
   - **ARPAsing** - English with ARPABET phonemes

### Recording Samples

1. Open your voicebank project
2. Go to the **Recording** tab
3. Follow the prompts - the app shows you what to say/sing
4. Press the record button and speak clearly
5. Review and re-record if needed

### Editing Oto (Timing Settings)

1. Open the **Editor** tab
2. Click on a sample to see its waveform
3. Drag the colored markers to adjust timing:
   - **Blue** = Offset (where sound starts)
   - **Green** = Consonant end
   - **Red** = Cutoff (where sound ends)
   - **Yellow** = Preutterance
   - **Purple** = Overlap
4. Use **AI Detect** button for automatic suggestions
5. Click **Save** when you're happy with it

---

## Development Setup

For local development without Docker:

### Requirements

| Program | What it's for | How to get it |
|---------|---------------|---------------|
| **Python 3.11+** | Runs the backend | [python.org/downloads](https://www.python.org/downloads/) |
| **Node.js 20+** | Runs the frontend | [nodejs.org](https://nodejs.org/) (choose LTS) |
| **uv** | Installs Python packages fast | See below |
| **eSpeak NG** *(Windows only)* | AI phoneme detection | [github.com/espeak-ng/espeak-ng/releases](https://github.com/espeak-ng/espeak-ng/releases) |

**Installing uv:**
```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Mac/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Setup and Run

```bash
git clone https://github.com/yourusername/utau_voicebank_manager.git
cd utau_voicebank_manager

./script/setup    # First-time setup
./script/server   # Start dev servers
```

Open **http://localhost:5173** (frontend dev server with hot reload).

### Scripts

| Script | What it does |
|--------|--------------|
| `script/setup` | First-time setup |
| `script/server` | Start dev servers |
| `script/test` | Run tests |
| `script/cibuild` | Full CI build |
| `script/models` | Download ML models |
| `script/console` | Python REPL |

### ML Models

Basic models download automatically on first use. Pre-download with:

```bash
./script/models
```

**SOFA (Singing-Oriented Forced Aligner)** provides better detection for singing samples:

```bash
git submodule update --init
./script/models
```

### API Documentation

When the server is running: http://localhost:8000/docs

---

## Troubleshooting

### "Command not found" errors
- Make sure Python, Node.js, and uv are installed
- Try closing and reopening your terminal after installing

### The app won't start
- Check if another program is using the required ports
- Try running `./script/setup` again

### Audio doesn't work
- Allow microphone access when your browser asks
- Check your browser's audio settings

### AI Detect doesn't work (Windows)
- Install **eSpeak NG** from [github.com/espeak-ng/espeak-ng/releases](https://github.com/espeak-ng/espeak-ng/releases)
- Restart the server after installing

---

## Credits

- [UTAU](http://utau2008.xrea.jp/) by Ameya/Ayame
- [OpenUTAU](https://github.com/stakira/OpenUtau) by stakira
- [Shoelace](https://shoelace.style/) for UI components
- [Lit](https://lit.dev/) for web components

---

## License

MIT License - do whatever you want with it!
