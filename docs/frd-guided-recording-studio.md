# Feature Requirements Document: Guided Recording Studio

**Status:** Draft
**Author:** Claude + Ty
**Created:** 2026-01-31

---

## Executive Summary

Transform voicebank creation from a tedious manual process into an intuitive guided experience. Users read carefully designed prompts while the system tracks their speech in real-time, automatically segments phonemes, and generates production-ready voicebanks with minimal manual intervention.

The long-term vision extends to training custom models specifically optimized for singing voice synthesis, potentially creating a new paradigm for voicebank generation.

---

## Problem Statement

Creating a UTAU voicebank today requires:
1. Recording hundreds of individual samples manually
2. Precise timing and consistent pronunciation
3. Hours of tedious oto.ini parameter tuning
4. Deep knowledge of phoneme systems (CV, VCV, CVVC, etc.)

**Result:** Only dedicated enthusiasts create voicebanks. The barrier to entry is prohibitively high.

---

## Vision

> "Read this paragraph, and we'll build your voicebank."

A user opens the app, clicks "Create Voicebank," reads a few paragraphs of text while watching their progress visualized in real-time, and receives a complete, production-ready voicebank minutes later.

---

## Core Features

### 1. Phoneme-Complete Prompt System

**Goal:** Design reading prompts that efficiently capture all phonemes in all relevant contexts.

#### 1.1 Prompt Design Principles
- **Phoneme Coverage Matrix:** Ensure every target phoneme appears in multiple contexts
- **Natural Flow:** Prompts should read naturally, not feel like tongue twisters
- **Progressive Difficulty:** Start simple, build to complex combinations
- **Language-Specific:** Japanese (CV/VCV), English (CVVC/ARPAsing), multilingual

#### 1.2 Prompt Types
| Type | Purpose | Example |
|------|---------|---------|
| Rainbow Passage | Phoneme coverage baseline | Standard phonetics text |
| Singing Phrases | Pitch variation capture | "La la la, do re mi" |
| Sustained Vowels | Pure vowel quality | "Ahhhhh, Eeeee, Ooooo" |
| Consonant Clusters | Transition capture | "Splash, string, glimpsed" |
| Emotional Variants | Expression range | Same phrase: happy/sad/angry |

#### 1.3 Recording Style Mapping
| Voicebank Style | Required Prompts | Est. Time |
|-----------------|------------------|-----------|
| Basic CV | 1 prompt set | 2 min |
| Standard VCV | 3 prompt sets | 8 min |
| Full CVVC | 5 prompt sets | 15 min |
| Multi-expression | 5 × 3 emotions | 45 min |

### 2. Real-Time Speech Tracking

**Goal:** Show users exactly where they are in the script with word-level precision.

#### 2.1 Visual Feedback
```
┌─────────────────────────────────────────────────────┐
│  "The rainbow is a division of white light into    │
│   ▲▲▲▲▲▲▲                                          │
│   [spoken]     [current]    [upcoming...]          │
│                    ↓                               │
│              ┌─────────┐                           │
│              │ RAINBOW │  ← highlighted word       │
│              └─────────┘                           │
│                                                    │
│  ════════════════════════════════════ 34%         │
│  [Waveform visualization of current audio]         │
└─────────────────────────────────────────────────────┘
```

#### 2.2 Tracking Technology Stack
- **Primary:** WebSpeech API for real-time transcription
- **Fallback:** Whisper.cpp (local) for privacy-conscious users
- **Alignment:** Forced alignment maps transcript to audio timestamps
- **Latency Target:** < 200ms word detection

#### 2.3 Error Recovery
- Detect mispronunciations, offer re-record for that segment
- Handle stutters, false starts gracefully
- Allow section-by-section recording, not just all-or-nothing

### 3. Automatic Phoneme Segmentation

**Goal:** Extract precisely-timed phoneme boundaries from continuous speech.

#### 3.1 Pipeline Architecture
```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  Audio   │───▶│  Forced  │───▶│ Phoneme  │───▶│   Oto    │
│  Input   │    │ Alignment│    │  Refine  │    │  Output  │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                     │               │
                     ▼               ▼
              [Word timing]   [Frame-level]
              [from ASR   ]   [boundaries ]
```

#### 3.2 Model Ensemble
| Stage | Model | Purpose |
|-------|-------|---------|
| Transcription | Whisper | Robust speech-to-text |
| Alignment | Montreal Forced Aligner | Word→phoneme timing |
| Refinement | Wav2Vec2-Phoneme | Frame-level boundaries |
| Validation | Custom CNN | Boundary quality check |

#### 3.3 Output Quality Targets
- Boundary accuracy: ±10ms of human annotation
- Phoneme classification: >95% accuracy
- Automatic confidence scoring for manual review flagging

### 4. Intelligent Oto Generation

**Goal:** Generate oto.ini parameters that rival hand-tuned configurations.

#### 4.1 Parameter Inference
```python
# Learned mappings from phoneme characteristics to oto params
class OtoInference:
    def infer_params(self, phoneme_segment):
        return {
            'offset': self.find_onset(segment),      # Attack detection
            'consonant': self.find_stable(segment),  # Steady-state start
            'cutoff': self.find_release(segment),    # Natural decay
            'preutterance': self.estimate_timing(),  # Musical sync
            'overlap': self.compute_crossfade(),     # Smooth transitions
        }
```

#### 4.2 Style-Aware Generation
- Learn from existing high-quality voicebanks
- Adapt parameters based on target singing style
- Generate multiple oto variants (soft, power, whisper)

### 5. Progressive Voicebank Building

**Goal:** Users can create a basic voicebank in minutes, then enhance over time.

#### 5.1 Tiered Completion
```
┌─────────────────────────────────────────────────┐
│  Your Voicebank: "MyVoice"                      │
│                                                 │
│  ████████████████░░░░░░░░░░░░░░  45% Complete  │
│                                                 │
│  ✓ Basic CV phonemes (100%)                    │
│  ✓ Common VCV combinations (80%)               │
│  ◐ Extended VCV (30%)                          │
│  ○ Pitch variations (0%)                       │
│  ○ Expression variants (0%)                    │
│                                                 │
│  [Continue Recording]  [Export Current]         │
└─────────────────────────────────────────────────┘
```

#### 5.2 Smart Gap Detection
- Identify missing phoneme combinations
- Generate targeted prompts to fill gaps
- Prioritize most impactful missing segments

---

## Advanced Features (Phase 2)

### 6. Custom Model Training

**Goal:** Train models specifically optimized for singing voice synthesis.

#### 6.1 Research Foundation
Key papers to study and implement:
- **Wav2Vec 2.0** - Self-supervised speech representations
- **HuBERT** - Hidden-unit BERT for speech
- **XLS-R** - Cross-lingual speech representations
- **VITS** - Variational inference TTS
- **So-VITS-SVC** - Singing voice conversion
- **DiffSinger** - Diffusion-based singing synthesis

#### 6.2 Training Data Pipeline
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Existing   │────▶│  Feature    │────▶│   Model     │
│  Voicebanks │     │  Extraction │     │  Training   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       ▼                   ▼
 [Audio + oto.ini]   [Embeddings, F0,]
                     [phoneme timing ]
```

#### 6.3 Model Architectures to Explore
| Model Type | Input | Output | Use Case |
|------------|-------|--------|----------|
| Phoneme Boundary | Raw audio | Timestamps | Segmentation |
| Oto Predictor | Audio + phoneme | Oto params | Auto-tuning |
| Quality Scorer | Oto + audio | Score 0-1 | Validation |
| Voice Cloner | Embeddings + text | Audio | Preview |

### 7. Lyrics-to-Voicebank

**Goal:** Generate voicebank samples directly from lyrics and melody.

#### 7.1 Concept
```
Input:  Lyrics: "Hello, how are you"
        Notes:  C4 D4 E4 F4 G4
        Timing: [0.5s, 0.3s, 0.4s, 0.3s, 0.8s]

Output: Complete voicebank samples covering all phonemes
        in the input, with oto.ini pre-configured
```

#### 7.2 Why This Matters
- Users record songs they already know
- Natural singing captures real phoneme transitions
- Emotional content is authentic, not performed

### 8. Voice Embedding Space

**Goal:** Create a latent space where voice characteristics can be manipulated.

#### 8.1 Applications
- **Voice Morphing:** Blend characteristics of multiple voices
- **Style Transfer:** Apply one voice's style to another's phonemes
- **Consistency Check:** Ensure recordings match target voice profile
- **Gap Filling:** Synthesize missing phonemes from voice embedding

---

## Technical Requirements

### Infrastructure

| Component | Requirement |
|-----------|-------------|
| Real-time audio | WebAudio API, <50ms latency |
| Speech recognition | WebSpeech or local Whisper |
| ML inference | WebGPU for browser, CUDA for server |
| Storage | IndexedDB for recordings, S3 for persistence |

### Model Hosting
- **Development:** Local inference with quantized models
- **Production:** Cloud GPU inference API (optional)
- **Privacy Mode:** Fully local processing with WASM models

### Data Requirements for Training
| Dataset | Size | Purpose |
|---------|------|---------|
| Existing voicebanks | 100+ | Learn oto patterns |
| Singing datasets | 50+ hours | Voice characteristics |
| Phoneme annotations | 10k+ samples | Boundary training |

---

## Success Metrics

### User Experience
- Time to first voicebank: < 10 minutes
- Manual oto adjustments needed: < 10%
- User satisfaction score: > 4.5/5

### Technical Quality
- Phoneme boundary accuracy: ±10ms
- Oto parameter quality: 90% match to expert-tuned
- Real-time tracking latency: < 200ms

### Adoption
- Voicebank creation rate: 10x increase
- New user retention: > 60% create a voicebank
- Community voicebank submissions: 5x increase

---

## Implementation Phases

### Phase 1: Foundation (4-6 weeks)
- [ ] Phoneme prompt library (Japanese CV/VCV)
- [ ] Basic real-time speech tracking UI
- [ ] Integration with existing segmentation pipeline
- [ ] Guided recording flow MVP

### Phase 2: Intelligence (6-8 weeks)
- [ ] Forced alignment integration
- [ ] Oto parameter inference model
- [ ] Quality scoring and review flagging
- [ ] Progressive voicebank building

### Phase 3: Training Pipeline (8-12 weeks)
- [ ] Research paper implementation
- [ ] Training data collection pipeline
- [ ] Custom model experiments
- [ ] Voice embedding exploration

### Phase 4: Advanced Features (12+ weeks)
- [ ] Lyrics-to-voicebank flow
- [ ] Voice morphing/style transfer
- [ ] Multi-language support
- [ ] Community model sharing

---

## Open Questions

1. **Privacy:** How do we handle voice data? On-device only vs. cloud processing?
2. **Licensing:** Can we use existing voicebanks for training? Under what terms?
3. **Quality Bar:** What's the minimum viable voicebank quality for release?
4. **Languages:** Start with Japanese only, or multilingual from day one?
5. **Model Size:** Browser-deployable models vs. server-side inference?

---

## Appendix: Research Papers

Papers to archive and study for model development:

### Speech Recognition & Alignment
- Wav2Vec 2.0 (Baevski et al., 2020)
- HuBERT (Hsu et al., 2021)
- Whisper (Radford et al., 2022)
- Montreal Forced Aligner (McAuliffe et al., 2017)

### Singing Voice Synthesis
- VITS (Kim et al., 2021)
- DiffSinger (Liu et al., 2022)
- So-VITS-SVC (various contributors)
- NNSVS (Yamamoto et al., 2020)

### Voice Conversion & Embedding
- AutoVC (Qian et al., 2019)
- AdaIN-VC (Chen et al., 2021)
- Speaker Embedding (Wan et al., 2018)

---

## Notes

This FRD captures the spirit of the "wow" feature: making voicebank creation accessible to everyone through intelligent automation. The technical depth is achievable, and the user experience would be genuinely transformative for the UTAU community.

The custom model training aspect opens exciting possibilities for the project to contribute novel research to the singing synthesis field.
