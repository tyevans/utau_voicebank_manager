# UTAU Voicebank Manager

A modern, AI-assisted voicebank creation and management platform for [UTAU](https://en.wikipedia.org/wiki/Utau) and [OpenUTAU](https://www.openutau.com/) singing voice synthesizers. This application streamlines the traditionally manual process of creating `oto.ini` configuration files by leveraging machine learning for automatic phoneme detection and alignment.

## Vision

Creating UTAU voicebanks has historically been a tedious, manual process requiring creators to painstakingly label phoneme boundaries in thousands of audio samples. This project aims to revolutionize that workflow by:

- **Automating phoneme detection** using state-of-the-art speech recognition models
- **Providing intuitive visual editing** for fine-tuning automatically generated labels
- **Supporting multiple recording styles** (CV, VCV, CVVC, VCCV, ARPAsing)
- **Enabling real-time preview** of configured samples
- **Managing complete voicebank projects** with version control and export capabilities

## Technology Stack

### Backend (Python 3.14 + FastAPI)

Built on [Python 3.14](https://docs.python.org/3/whatsnew/3.14.html), leveraging its latest features:

- **Template String Literals (t-strings)** - PEP 750 for safer string interpolation
- **Deferred Annotation Evaluation** - PEP 649 for cleaner type hints
- **Free-threaded Mode** - PEP 779 for true parallelism in audio processing
- **Experimental JIT Compiler** - Enhanced performance for ML inference
- **Zstandard Compression** - PEP 784 for efficient voicebank packaging

**Core Backend Technologies:**
- [FastAPI](https://fastapi.tiangolo.com/) - High-performance async API framework
- [uv](https://docs.astral.sh/uv/) - Extremely fast Python package manager from [Astral](https://astral.sh/)
- [Pydantic](https://docs.pydantic.dev/) - Data validation with Python type hints
- [SQLAlchemy](https://www.sqlalchemy.org/) - Database ORM with async support

### Frontend (TypeScript + Vite + Lit + Shoelace)

A modern web frontend built with framework-agnostic Web Components:

- [Vite](https://vitejs.dev/) - Lightning-fast build tool and dev server
- [Lit](https://lit.dev/) - Lightweight Web Components library
- [Shoelace](https://shoelace.style/) - Beautiful, accessible UI component library
- [Tailwind CSS](https://tailwindcss.com/) - Utility-first CSS framework
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) - Real-time audio visualization and playback

### ML/AI Models

#### Phoneme Recognition & Forced Alignment

| Model | Purpose | Source |
|-------|---------|--------|
| [Wav2Vec2Phoneme](https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme) | Zero-shot cross-lingual phoneme recognition | Hugging Face |
| [WhisperX](https://github.com/m-bain/whisperX) | Word/phoneme-level timestamps via forced alignment | GitHub |
| [Montreal Forced Aligner](https://montreal-forced-aligner.readthedocs.io/) | High-precision phoneme boundary detection | MFA |
| [pyannote.audio](https://github.com/pyannote/pyannote-audio) | Voice activity detection & speaker diarization | Hugging Face |

#### Voice Synthesis & Analysis

| Model | Purpose | Source |
|-------|---------|--------|
| [NNSVS](https://github.com/nnsvs/nnsvs) | Neural network singing voice synthesis | GitHub |
| [SpeechBrain](https://huggingface.co/speechbrain) | Speech processing toolkit (G2P, enhancement) | Hugging Face |
| Fine-tuned Whisper | Custom phoneme prediction from audio | Custom training |

## Architecture (SOLID Principles)

The application follows SOLID design principles for maintainability and extensibility:

```
utau_voicebank_manager/
├── src/
│   ├── backend/
│   │   ├── api/                    # FastAPI routes (Interface Segregation)
│   │   │   ├── routers/
│   │   │   │   ├── voicebanks.py
│   │   │   │   ├── samples.py
│   │   │   │   ├── oto.py
│   │   │   │   └── ml.py
│   │   │   └── dependencies.py
│   │   ├── core/                   # Core business logic
│   │   │   ├── config.py
│   │   │   └── security.py
│   │   ├── domain/                 # Domain models (Single Responsibility)
│   │   │   ├── voicebank.py
│   │   │   ├── sample.py
│   │   │   ├── oto_entry.py
│   │   │   └── phoneme.py
│   │   ├── services/               # Business services (Open/Closed)
│   │   │   ├── voicebank_service.py
│   │   │   ├── oto_service.py
│   │   │   ├── audio_service.py
│   │   │   └── ml_service.py
│   │   ├── repositories/           # Data access (Dependency Inversion)
│   │   │   ├── base.py
│   │   │   ├── voicebank_repo.py
│   │   │   └── sample_repo.py
│   │   ├── ml/                     # ML model integrations
│   │   │   ├── phoneme_detector.py
│   │   │   ├── forced_aligner.py
│   │   │   └── vad.py
│   │   └── utils/
│   │       ├── audio.py
│   │       └── oto_parser.py
│   └── frontend/
│       ├── src/
│       │   ├── components/         # Lit Web Components
│       │   │   ├── waveform-editor.ts
│       │   │   ├── oto-table.ts
│       │   │   ├── phoneme-marker.ts
│       │   │   └── sample-player.ts
│       │   ├── services/
│       │   ├── stores/
│       │   └── styles/
│       └── index.html
├── models/                         # Pre-trained ML models
├── tests/
├── pyproject.toml
└── README.md
```

### SOLID Implementation

- **Single Responsibility**: Each class has one reason to change (e.g., `OtoEntry` only handles oto data, `AudioService` only handles audio processing)
- **Open/Closed**: Services are open for extension via strategy patterns (e.g., different phoneme detectors)
- **Liskov Substitution**: All repositories implement `BaseRepository` contract
- **Interface Segregation**: API routes are split by domain concern
- **Dependency Inversion**: Services depend on abstract repositories, not concrete implementations

## Features

### Core Features

- **Project Management**
  - Create, import, and manage multiple voicebank projects
  - Support for CV, VCV, CVVC, VCCV, and ARPAsing recording styles
  - Character metadata editing (character.txt, readme.txt)
  - Project templates for common voicebank structures

- **Audio Sample Management**
  - Drag-and-drop sample import
  - Automatic sample organization by recording list
  - Batch renaming and file management
  - Audio normalization and preprocessing

- **Oto.ini Editor**
  - Visual waveform editor with zoom/pan
  - Interactive phoneme boundary markers (offset, consonant, cutoff, preutterance, overlap)
  - Real-time audio preview with current settings
  - Keyboard shortcuts for efficient editing
  - Undo/redo support

- **Alias Management**
  - Automatic alias generation based on recording style
  - Suffix/prefix management for pitch variations
  - Multi-language alias support (Japanese, English, Chinese, Korean)

### AI-Powered Features

- **Automatic Phoneme Detection**
  - One-click phoneme boundary detection using Wav2Vec2
  - Support for multiple languages via pre-trained models
  - Confidence scores for detected boundaries

- **Forced Alignment**
  - Align existing transcriptions to audio with Montreal Forced Aligner
  - WhisperX integration for word-level timestamps
  - Batch processing for entire voicebanks

- **Smart Suggestions**
  - AI-suggested oto parameters based on detected phonemes
  - Learn from manual corrections to improve suggestions
  - Export correction data for model fine-tuning

- **Voice Activity Detection**
  - Automatic silence trimming
  - Sample boundary detection
  - Multi-take separation

### Advanced Features

- **Real-time Collaboration** (planned)
  - WebSocket-based live editing
  - Multiple users can edit different samples simultaneously
  - Conflict resolution for concurrent edits

- **Quality Assurance**
  - Automatic validation of oto entries
  - Detection of common configuration errors
  - Preview synthesis using WORLDLINE-R or NNSVS

- **Export & Integration**
  - Export to standard UTAU/OpenUTAU format
  - Zstandard-compressed voicebank packages
  - Direct upload to voicebank distribution platforms
  - Git-based version control integration

- **Batch Operations**
  - Apply oto templates across multiple samples
  - Batch pitch shifting for multi-pitch voicebanks
  - Bulk export with customizable naming schemes

## Oto.ini Format Reference

The `oto.ini` file defines how UTAU reads audio samples. Each line follows this format:

```
filename.wav=alias,offset,consonant,cutoff,preutterance,overlap
```

| Parameter | Description |
|-----------|-------------|
| **filename** | The WAV file containing the sample |
| **alias** | The phoneme/syllable this entry represents |
| **offset** | Start position (ms) - when playback begins |
| **consonant** | Consonant region end (ms) - the "fixed" portion not stretched |
| **cutoff** | End position (ms, negative = from end) - when playback stops |
| **preutterance** | How much before the note start to begin playing |
| **overlap** | Crossfade region with previous note |

Example entries:
```ini
# CV (Consonant-Vowel)
_あ.wav=- あ,50,100,-150,60,10
_か.wav=- か,45,120,-140,80,15

# VCV (Vowel-Consonant-Vowel)
_あかさ.wav=a か,250,100,-200,70,30
_あかさ.wav=a さ,550,110,-180,75,35
```

## Getting Started

### Prerequisites

- Python 3.14+
- [uv](https://docs.astral.sh/uv/) package manager
- Node.js 20+ (for frontend development)
- FFmpeg (for audio processing)

### Installation

```bash
git clone https://github.com/yourusername/utau_voicebank_manager.git
cd utau_voicebank_manager
script/setup          # Install deps + create data dirs
script/models         # Download ML models (optional)
```

### Development

```bash
script/server         # Start backend (:8000) + frontend (:5173)
script/test           # Run tests
script/console        # Python REPL with project loaded
```

### Production

```bash
script/cibuild        # Full CI: lint, typecheck, test, build
uv run fastapi run src/backend/main.py
```

## Roadmap

### Phase 1: Foundation
- [ ] Project structure and SOLID architecture
- [ ] Basic voicebank CRUD operations
- [ ] Oto.ini parser and serializer
- [ ] Waveform visualization component
- [ ] Manual oto editing interface

### Phase 2: ML Integration
- [ ] Wav2Vec2 phoneme detection integration
- [ ] Montreal Forced Aligner integration
- [ ] Voice activity detection with pyannote
- [ ] Automatic oto suggestion engine

### Phase 3: Advanced Editing
- [ ] Multi-language support (JP, EN, ZH, KO)
- [ ] Recording style templates (CV, VCV, CVVC, ARPAsing)
- [ ] Batch operations and bulk editing
- [ ] Keyboard-driven workflow

### Phase 4: Synthesis & QA
- [ ] NNSVS/ENUNU preview integration
- [ ] Quality validation checks
- [ ] Audio preprocessing pipeline
- [ ] Export to multiple formats

### Phase 5: Collaboration & Cloud
- [ ] User accounts and project sharing
- [ ] Real-time collaborative editing
- [ ] Cloud model inference option
- [ ] Voicebank distribution integration

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- [UTAU](http://utau2008.xrea.jp/) by Ameya/Ayame
- [OpenUTAU](https://github.com/stakira/OpenUtau) by stakira
- [Hugging Face](https://huggingface.co/) for ML model hosting
- [WhisperX](https://github.com/m-bain/whisperX) by Max Bain
- [Montreal Forced Aligner](https://github.com/MontrealCorpusTools/Montreal-Forced-Aligner)
- [NNSVS](https://github.com/nnsvs/nnsvs) by Ryuichi Yamamoto
- [pyannote.audio](https://github.com/pyannote/pyannote-audio) by Hervé Bredin

## Resources & References

### Python & Tooling
- [Python 3.14 What's New](https://docs.python.org/3/whatsnew/3.14.html)
- [uv Documentation](https://docs.astral.sh/uv/)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)

### Frontend
- [Lit Documentation](https://lit.dev/)
- [Shoelace Component Library](https://shoelace.style/)
- [Tailwind CSS](https://tailwindcss.com/)

### UTAU & Voicebanks
- [OpenUTAU GitHub](https://github.com/stakira/OpenUtau)
- [UTAU Voicebank Tutorials](https://utaututorials.neocities.org/voicebank)
- [Base OTO Guide](https://wastelandutau.neocities.org/ref/baseoto)
- [ARPAsing Documentation](https://arpasing.tubs.wtf/)

### ML Models
- [Wav2Vec2Phoneme](https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme)
- [WhisperX GitHub](https://github.com/m-bain/whisperX)
- [Montreal Forced Aligner Docs](https://montreal-forced-aligner.readthedocs.io/)
- [pyannote.audio GitHub](https://github.com/pyannote/pyannote-audio)
- [NNSVS Documentation](https://nnsvs.github.io/)
- [SpeechBrain](https://huggingface.co/speechbrain)
