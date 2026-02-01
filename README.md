# UTAU Voicebank Manager

**Create your own singing voice for UTAU/OpenUTAU - the easy way!**

A web app that helps you record, organize, and configure voicebanks for [UTAU](https://en.wikipedia.org/wiki/Utau) and [OpenUTAU](https://www.openutau.com/). Instead of manually editing `oto.ini` files line by line, use our visual editor with AI-powered suggestions!

---

## What Can It Do?

- **Guided Recording** - Follow on-screen prompts to record all the sounds you need
- **Visual Oto Editor** - See your audio waveforms and drag markers to set timing
- **AI Phoneme Detection** - Let the computer find where sounds start and end
- **Multi-Style Support** - Works with CV, VCV, CVVC, and ARPAsing voicebanks
- **Preview Your Work** - Listen to samples with your oto settings applied

---

## Quick Start (3 Steps!)

### Step 1: Install the Requirements

You need these programs installed first:

| Program | What it's for | How to get it |
|---------|---------------|---------------|
| **Python 3.11+** | Runs the backend | [python.org/downloads](https://www.python.org/downloads/) |
| **Node.js 20+** | Runs the frontend | [nodejs.org](https://nodejs.org/) (choose LTS) |
| **uv** | Installs Python packages fast | See below |
| **Git** | Downloads the project | [git-scm.com](https://git-scm.com/downloads) |
| **eSpeak NG** *(Windows only)* | AI phoneme detection | [github.com/espeak-ng/espeak-ng/releases](https://github.com/espeak-ng/espeak-ng/releases) |

**Installing uv** (the Python package manager):
```bash
# Windows (PowerShell)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# Mac/Linux
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Step 2: Download and Set Up

Open a terminal (Command Prompt, PowerShell, or Terminal) and run:

```bash
# Download the project
git clone https://github.com/yourusername/utau_voicebank_manager.git
cd utau_voicebank_manager

# Set everything up (this may take a few minutes)
./script/setup
```

**Windows users:** If `./script/setup` doesn't work, try:
```bash
bash script/setup
```

### Step 3: Start the App

```bash
./script/server
```

Then open your web browser and go to: **http://localhost:5173**

That's it! You should see the app running.

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

## Troubleshooting

### "Command not found" errors
- Make sure Python, Node.js, and uv are installed
- Try closing and reopening your terminal after installing

### The app won't start
- Check if another program is using port 5173 or 8000
- Try running `./script/setup` again

### Audio doesn't work
- Allow microphone access when your browser asks
- Check your browser's audio settings

### AI Detect doesn't work (Windows)
- Install **eSpeak NG** from [github.com/espeak-ng/espeak-ng/releases](https://github.com/espeak-ng/espeak-ng/releases)
- Download the `.msi` installer and run it
- Restart the server after installing

### Something else is broken
Open an issue on GitHub with:
- What you were trying to do
- What happened instead
- Any error messages you saw

---

## For Developers

<details>
<summary>Click to expand technical details</summary>

### Project Structure

```
utau_voicebank_manager/
├── src/
│   ├── backend/          # Python/FastAPI server
│   │   ├── api/routers/  # REST endpoints
│   │   ├── domain/       # Pydantic models
│   │   ├── services/     # Business logic
│   │   └── ml/           # ML model integrations
│   └── frontend/         # TypeScript/Lit web app
│       └── src/components/
├── script/               # Helper scripts
├── data/                 # User data (gitignored)
└── models/               # ML models (gitignored)
```

### Scripts

| Script | What it does |
|--------|--------------|
| `script/setup` | First-time setup |
| `script/server` | Start dev servers |
| `script/test` | Run tests |
| `script/cibuild` | Full CI build |
| `script/models` | Download ML models |
| `script/console` | Python REPL |

### Tech Stack

**Backend:** Python 3.11+, FastAPI, Pydantic, PyTorch
**Frontend:** TypeScript, Lit, Shoelace, Tailwind CSS
**ML:** Wav2Vec2, WhisperX (optional), SOFA (optional)

### ML Model Setup

The app uses AI models for phoneme detection. Basic models download automatically on first use, but you can pre-download them:

```bash
./script/models
```

**Optional: SOFA for Singing Voice**

[SOFA (Singing-Oriented Forced Aligner)](https://github.com/qiuqiao/SOFA) provides better detection for sustained vowels in singing samples. Setup requires manual steps:

1. Clone SOFA: `git clone https://github.com/qiuqiao/SOFA`
2. Download models from [SOFA GitHub Discussions](https://github.com/qiuqiao/SOFA/discussions/categories/pretrained-model-sharing)
3. Place checkpoints in `models/sofa/checkpoints/`
4. Place dictionaries in `models/sofa/dictionary/`
5. Set environment variable: `export SOFA_PATH=/path/to/SOFA`

Run `./script/models` for detailed setup instructions.

### Running Tests

```bash
./script/test
```

### API Documentation

When the server is running, visit: http://localhost:8000/docs

</details>

---

## Credits

- [UTAU](http://utau2008.xrea.jp/) by Ameya/Ayame
- [OpenUTAU](https://github.com/stakira/OpenUtau) by stakira
- [Shoelace](https://shoelace.style/) for UI components
- [Lit](https://lit.dev/) for web components

---

## License

MIT License - do whatever you want with it!
