# CLAUDE.md

AI-assisted voicebank creation platform for UTAU/OpenUTAU singing synthesizers.

## Operating Mode: Orchestrator

**The primary Claude Code session operates as an orchestrator only.** Do not directly implement tasks--instead, dispatch work to specialized subagents and manage the beads backlog.

### Orchestrator Responsibilities

1. **Backlog Management**: Use `bd` commands to triage, prioritize, and track issues
2. **Task Dispatch**: Delegate implementation work to appropriate subagents via the Task tool
3. **Coordination**: Manage dependencies between tasks, unblock work, review agent outputs
4. **Session Management**: Run `bd sync --flush-only` before completing sessions

### When to Invoke Each Agent

| Agent | Invoke When... |
|-------|----------------|
| `backend-developer` | Writing Python/FastAPI code (API routes, services, repositories) |
| `frontend-developer` | Creating Lit web components, TypeScript, Tailwind styles |
| `ml-engineer` | Integrating ML models (Wav2Vec2, WhisperX, MFA), audio processing |
| `audio-specialist` | WAV processing, waveform analysis, oto.ini parameter logic |
| `api-designer` | Designing REST endpoints, Pydantic schemas, OpenAPI specs |
| `test-writer` | Writing pytest tests or frontend test files |
| `code-reviewer` | Reviewing code for SOLID principles and patterns (read-only) |
| `beads-helper` | Simple task management queries (uses Haiku for efficiency) |

### Dispatch Workflow

```
1. bd ready                          # Find available work
2. bd show <id>                      # Review task details
3. bd update <id> --status=in_progress  # Claim work
4. Task tool -> appropriate agent    # Dispatch implementation
5. code-reviewer agent (optional)    # Review output
6. bd close <id>                     # Mark complete
7. bd sync --flush-only              # Before session end
```

### Serialized Dispatching

**Dispatch tasks one at a time, not in parallel.** This approach:
- Avoids API throttling, enabling longer uninterrupted work sessions
- Allows learning from each task's output before starting the next
- Reduces context bloat from concurrent agent results
- Gives the orchestrator time to review, adjust, and course-correct

Workflow: dispatch -> wait for completion -> review -> dispatch next task

### Running Notes & Knowledge Transfer

Maintain running notes to pass emergent knowledge across sessions and agents. Notes live in beads (typically at epic level via `--notes` or `--design` fields).

**Before starting work**, subagents should:
- Read notes on the parent epic or related beads
- Check for gotchas, patterns discovered, or decisions made by prior agents

**After completing work**, subagents should update notes with:
- Non-speculative facts that would have eased their work had they known beforehand
- Discovered constraints, edge cases, or library quirks
- Patterns that emerged and should be followed
- NOT speculation, opinions, or "nice to haves"

**Examples of good notes:**
- "WhisperX requires torch 2.0+ and fails silently with older versions"
- "Oto.ini cutoff values are negative when measured from audio end"
- "Shoelace components must be registered before use in Lit templates"

**Orchestrator responsibility:** When reviewing agent output, extract knowledge worth persisting and update the relevant bead's notes field.

### Example Dispatch

```
# User asks to implement oto.ini editor
1. Check bd ready for related tasks
2. Dispatch to api-designer: "Design oto.ini REST endpoints"
3. Dispatch to backend-developer: "Implement OtoEntry Pydantic model and parser"
4. Dispatch to frontend-developer: "Create uvm-oto-editor component"
5. Dispatch to test-writer: "Write tests for oto parser"
6. Review outputs, close beads, sync
```

---

## Quick Reference

```bash
script/setup      # First-time setup (bootstrap + create dirs)
script/server     # Start backend (:8000) + frontend (:5173)
script/test       # Run pytest + frontend lint
script/cibuild    # Full CI: lint, typecheck, test, build
script/models     # Download ML models
script/console    # Python REPL with project loaded
```

## Project Structure

```
utau_voicebank_manager/
├── src/
│   ├── backend/
│   │   ├── api/routers/       # FastAPI routes by domain
│   │   ├── domain/            # Pydantic models (voicebank, sample, oto_entry)
│   │   ├── services/          # Business logic layer
│   │   ├── repositories/      # Data access abstraction
│   │   ├── ml/                # ML model integrations
│   │   └── utils/             # Audio processing, oto parser
│   └── frontend/
│       ├── src/components/    # Lit web components
│       ├── src/services/      # API clients
│       └── src/stores/        # State management
├── models/                    # Downloaded ML models
├── tests/                     # pytest test files
└── pyproject.toml
```

## Architecture

**Backend (SOLID Principles):**
- Services depend on abstract repositories (Dependency Inversion)
- Routes split by domain: voicebanks, samples, oto, ml (Interface Segregation)
- Strategy pattern for swappable phoneme detectors (Open/Closed)

**Frontend:**
- Lit web components with Shoelace UI primitives
- Tailwind for utility styling
- Web Audio API for waveform rendering and playback

## Oto.ini Format

Each line: `filename.wav=alias,offset,consonant,cutoff,preutterance,overlap`

| Param | Description | Units |
|-------|-------------|-------|
| offset | Playback start position | ms (positive) |
| consonant | Fixed region end (not stretched) | ms (positive) |
| cutoff | Playback end position | ms (negative = from end) |
| preutterance | How early to start before note | ms (positive) |
| overlap | Crossfade with previous note | ms (positive) |

```ini
# CV example
_ka.wav=- ka,45,120,-140,80,15

# VCV example (multiple aliases per file)
_akasa.wav=a ka,250,100,-200,70,30
_akasa.wav=a sa,550,110,-180,75,35
```

## ML Model Notes

| Model | Use Case | Memory |
|-------|----------|--------|
| Wav2Vec2Phoneme | Zero-shot phoneme detection | ~2GB |
| WhisperX | Word/phoneme timestamps | ~3GB |
| Montreal Forced Aligner | High-precision alignment | ~1GB |
| pyannote.audio | Voice activity detection | ~500MB |

Models download to `models/` on first use. GPU recommended for inference.

## Recording Styles

| Style | Pattern | Example |
|-------|---------|---------|
| CV | Consonant-Vowel | ka, sa, ta |
| VCV | Vowel-Consonant-Vowel | a ka, i ki |
| CVVC | CV + VC transitions | ka, a k |
| VCCV | English VC-CV | ask, cat |
| ARPAsing | ARPABET phonemes | k ae t |

## Key Patterns

- **Audio files**: Always WAV, 44.1kHz mono preferred for UTAU compatibility
- **Oto validation**: Ensure offset < preutterance < consonant, cutoff is negative
- **API responses**: Use Pydantic models, return proper HTTP status codes
- **Components**: Prefix with `uvm-` (e.g., `uvm-waveform-editor`)

## Conventions

- Python: ruff format, type hints required, async where beneficial
- TypeScript: Lit decorators, Shoelace components, Tailwind classes
- Tests: pytest with fixtures, mock external services
- Commits: Conventional commits (feat:, fix:, docs:)

## Do Not Modify

- `models/` - Downloaded ML weights (gitignored)
- `node_modules/` - Frontend dependencies
- `.venv/` - Python virtual environment
- Generated files: `dist/`, `*.pyc`, `.ruff_cache/`
