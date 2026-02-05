# FRD: Audio Engine v2 - Playback & Pitch-Shifting Architecture

**Status**: Draft
**Author**: Claude Opus 4.5 (research assistant)
**Date**: 2026-02-04
**Epic**: utau_voicebank_manager-4so (Preview & Playback Quality Improvements)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current System Analysis](#current-system-analysis)
3. [Backlog Context](#backlog-context)
4. [State of the Art: Browser-Based Audio Processing](#state-of-the-art)
5. [Functional Requirements](#functional-requirements)
6. [Non-Functional Requirements](#non-functional-requirements)
7. [Recommended Architecture](#recommended-architecture)
8. [Migration Path](#migration-path)
9. [Out of Scope](#out-of-scope)
10. [References](#references)

---

## Executive Summary

The current audio engine in the UTAU Voicebank Manager has evolved organically through incremental feature additions. It now contains two pitch-shifting paths (playback-rate and granular/Tone.js), but only the playback-rate path is active -- the granular system is effectively dead code. The playback-rate path produces audible chipmunk/Darth Vader effects at pitch shifts beyond +/-3 semitones. Meanwhile, the working subsystems (loudness normalization, ADSR envelopes, crossfades, vibrato, vowel-region looping, join correction) are battle-tested and should be preserved.

This FRD proposes a v2 audio engine that:
- Replaces the broken Tone.js granular path with a proper formant-preserving pitch shifter
- Consolidates the three playback consumers under a unified API
- Preserves the working normalization/envelope/crossfade pipeline
- Is implementable incrementally without breaking existing functionality

**Design constraint**: This is a browser-based UTAU preview tool, not a DAW. The engine must prioritize simplicity and maintainability over exhaustive DSP capabilities. Pitch shift range is typically +/-12 semitones, audio sources are short vocal samples (0.5-3 seconds), and quality matters -- but so does shipping.

---

## Current System Analysis

### Architecture Overview

The audio engine consists of these components:

```
Consumers (4 entry points)
  |
  +-- uvm-first-sing.ts ---- "Hear Your Voice" button (5-note do-re-mi)
  +-- uvm-quick-phrase.ts --- Text input -> singing with melody patterns
  +-- uvm-phrase-preview.ts - Demo song player (Furusato, Sakura, Twinkle)
  +-- uvm-sample-card.ts ---- Hover preview (500ms, no pitch shift)
  |
  v
MelodyPlayer (melody-player.ts, ~2282 lines)
  |-- playSequence()          Single-sample note sequences
  |-- playPhrase()            Multi-sample concatenative synthesis
  |-- _schedulePhraseNote()   Dispatcher: routes to granular or playback-rate
  |
  +-- Playback-Rate Path (ACTIVE)
  |     Uses AudioBufferSourceNode.playbackRate + .detune
  |     Formula: rate = 2^(semitones/12)
  |     Pros: Zero latency, simple, native vibrato via detune AudioParam
  |     Cons: Chipmunk effect, formant distortion
  |
  +-- Granular Path (DISABLED - useGranular: false everywhere)
        Uses GranularPitchShifter -> Tone.js GrainPlayer
        Depends on: granular-pitch-shifter.ts (~1126 lines)
                    psola.ts (~731 lines)
        Issues: Tone.js context bridge fragility, no native onended,
                setTimeout-based cleanup, PSOLA buffer cache complexity

Supporting Modules:
  +-- audio-context.ts (54 lines) - SharedAudioContext singleton + Firefox polyfill
  +-- pitch-detection.ts (522 lines) - Autocorrelation pitch detection
  +-- loudness-analysis.ts (885 lines) - RMS normalization, peak limiting, join correction
  +-- spectral-analysis.ts - Spectral distance scoring for dynamic overlap
  +-- demo-songs.ts (547 lines) - 5 demo songs (CV, VCV, ARPAsing)
```

### What Works Well

These subsystems are mature, tested, and should be preserved in v2:

1. **Loudness normalization pipeline** (`loudness-analysis.ts`)
   - Vowel-region-only RMS and peak analysis (fixed VCV bias issue)
   - Target -18dB RMS with soft-knee peak limiting
   - Max 12dB gain cap to prevent noise amplification
   - LRU-eviction analysis cache
   - Join gain correction (conservative 6dB max, pre-computed for all pairs)

2. **ADSR envelope system** (`melody-player.ts: _applyADSREnvelope()`)
   - 4-stage amplitude shaping via `linearRampToValueAtTime`
   - Default: 10ms attack, 50ms decay, 0.8 sustain, 50ms release
   - Per-note envelope override support
   - ADS/release compression to fit within crossfade windows

3. **Equal-power crossfades** (`melody-player.ts: _generateCrossfadeCurve()`)
   - sin/cos curves maintaining constant power: sin^2(t) + cos^2(t) = 1
   - Dynamic overlap from spectral distance scoring
   - Configurable linear fallback

4. **Vibrato system** (`melody-player.ts: _createVibratoLFO()`)
   - Native OscillatorNode -> GainNode -> source.detune connection
   - Sample-accurate modulation with zero polling overhead
   - Configurable delay, rate (Hz), and depth (cents)
   - Smooth ramp-up/ramp-down to avoid abrupt transitions

5. **Vowel-region looping** (`melody-player.ts: _computeLoopParams()`)
   - AudioBufferSourceNode.loop with loopStart/loopEnd
   - Minimum 40ms vowel region required (MIN_LOOP_REGION)
   - Allows sustained notes beyond natural sample length

6. **Pitch detection** (`pitch-detection.ts`)
   - Autocorrelation with parabolic interpolation for sub-sample accuracy
   - 50Hz-1000Hz range, multi-region median for robustness
   - Adaptive grain sizing: 2x pitch period, clamped 20ms-200ms

7. **Shared AudioContext** (`audio-context.ts`)
   - Singleton pattern preventing multiple context creation
   - Firefox polyfill for `cancelAndHoldAtTime`

### What Does Not Work

1. **Granular pitch shifting via Tone.js** - Disabled across all consumers (`useGranular: false`). The Tone.js GrainPlayer integration suffers from:
   - Context bridge fragility (sharing AudioContext between native Web Audio and Tone.js)
   - No native `onended` event, relying on `setTimeout` for cleanup
   - PSOLA buffer cache adds complexity (WeakMap + LRU, 50-entry cap)
   - Output bridge GainNode pattern is a workaround, not a proper integration
   - Tone.js Transport polling for vibrato (polling loop, not sample-accurate)

2. **Playback-rate pitch shifting at wide intervals** - Active path, but audibly distorted beyond +/-3 semitones. The formula `rate = 2^(semitones/12)` shifts all frequencies uniformly, including formants, causing the characteristic chipmunk (pitch up) or Darth Vader (pitch down) effect.

3. **PSOLA processor** (`psola.ts`) - Well-implemented TD-PSOLA with analysis caching, but:
   - Only accessible through the disabled granular path
   - Uses `OfflineAudioContext` for synthesis (not real-time)
   - Synchronous computation on main thread (blocks UI for large buffers)

### Consumer Analysis

| Consumer | Uses MelodyPlayer? | Pitch Shifting? | Key Features Used |
|----------|-------------------|-----------------|-------------------|
| uvm-first-sing | Yes, `playPhrase()` | Yes (do-re-mi scale) | Normalization, dynamic overlap, ADSR |
| uvm-quick-phrase | Yes, `playPhrase()` | Yes (melody patterns) | Normalization, dynamic overlap, ADSR |
| uvm-phrase-preview | Yes, `playPhrase()` | Yes (demo songs) | Normalization, dynamic overlap, ADSR, vibrato |
| uvm-sample-card | No (direct Web Audio) | No (original pitch) | Simple AudioBufferSourceNode + loop |

All three MelodyPlayer consumers call `playPhrase()` with `useGranular: false`, `useDynamicOverlap: true`, and `useLoudnessNormalization: true`. The sample card hover preview is independent -- it creates a bare `AudioBufferSourceNode` with 500ms duration and optional vowel-region looping.

---

## Backlog Context

The open backlog under the Preview & Playback Quality Improvements epic (utau_voicebank_manager-4so) reveals a well-structured roadmap. Here are the audio-related items, organized by priority and dependency:

### P2 - Ready to Implement

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| 8kx | Spectral smoothing at concatenation joins | Open | LPC parameter interpolation for timbre continuity |
| sa5 | Independent time stretching for phrase notes | Open | Decouple tempo from pitch; needs granular or phase vocoder |
| wad | Pitch bend curve support in phrase playback | Open | Portamento/glides via pitchBend keyframes on PhraseNote |

### P3 - Foundational Quality

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| 47m | Formant-preserving pitch shifting | Open | Core v2 requirement; depends on cepstral envelope |
| bao | Cepstral envelope extraction | Open | FFT(log(FFT)) for formant/excitation separation |
| kq8 | Natural formant scaling with pitch | Open | Apply ~15% of pitch shift to formants |
| e1n | WORLD vocoder WASM port | Open | Gold standard; high effort |
| t2i | Real-time spectral envelope visualization | Open | F1/F2/F3 overlay on waveform |

### P4 - Aspirational

| ID | Title | Status | Notes |
|----|-------|--------|-------|
| o9r | RVC-style neural artifact correction | Open | ML post-processing |
| 2wi | HiFi-GAN neural vocoder post-processor | Open | 13.4x real-time on CPU |

### Completed Dependencies (Informing v2 Design)

The following completed items shaped the current architecture and their learnings should carry forward:

- **Adaptive grain sizing** (31a) - Pitch-period detection works; grain sizing formula is solid
- **PSOLA implementation** (604) - TD-PSOLA algorithm is correct but trapped behind Tone.js
- **Dynamic overlap** (cut) - Spectral distance scoring improves crossfade quality
- **Loudness normalization** (zuv) - Vowel-region analysis solved VCV bias
- **ADSR envelopes** (o96) - Unified envelope system works across both paths
- **Vibrato** (xub) - Native LFO approach is superior to Tone.js polling

---

## State of the Art

### Browser-Based Pitch Shifting Approaches

Research into current browser-based audio processing reveals five viable approaches, each with distinct tradeoffs:

#### 1. Playback Rate (Current Active Path)

**How it works**: `AudioBufferSourceNode.playbackRate.value = 2^(semitones/12)`

| Aspect | Assessment |
|--------|-----------|
| Latency | Zero (native Web Audio) |
| CPU | Negligible |
| Quality at +/-3 st | Acceptable |
| Quality at +/-12 st | Poor (formant distortion) |
| Formant preservation | None |
| Time stretch | Cannot decouple from pitch |
| Browser support | Universal |
| Implementation complexity | Trivial |

**Verdict**: Keep as fast fallback for small pitch shifts (+/-2 semitones).

#### 2. TD-PSOLA (Current Implementation, Disabled)

**How it works**: Detect pitch periods via autocorrelation, place pitch marks at period boundaries, extract Hann-windowed frames, overlap-add at modified spacing.

| Aspect | Assessment |
|--------|-----------|
| Latency | Buffer-length (offline processing) |
| CPU | Moderate (pitch detection + OLA) |
| Quality at +/-3 st | Excellent for monophonic voice |
| Quality at +/-12 st | Good (no formant preservation inherent) |
| Formant preservation | Not inherent; must be added separately |
| Time stretch | Yes (frame repetition/skipping) |
| Browser support | Pure JS, universal |
| Implementation complexity | Moderate |

**Verdict**: Strong candidate for the primary path. The existing `psola.ts` implementation is correct. Key improvement needed: move analysis off the main thread (Web Worker or AudioWorklet), and add formant envelope preservation.

#### 3. Phase Vocoder (e.g., Phaze, Superpowered)

**How it works**: FFT-based analysis/synthesis. Convert to frequency domain, modify phase relationships to shift pitch while preserving duration, IFFT back to time domain.

| Aspect | Assessment |
|--------|-----------|
| Latency | FFT window size (typically 2048-4096 samples, ~46-93ms at 44.1kHz) |
| CPU | Moderate-high (FFT/IFFT per frame) |
| Quality at +/-3 st | Good |
| Quality at +/-12 st | Moderate ("phasiness", spectral smearing) |
| Formant preservation | Possible with spectral envelope manipulation |
| Time stretch | Yes (native capability) |
| Browser support | Via AudioWorklet or WASM |
| Implementation complexity | High |

Notable implementations:
- **[Phaze](https://github.com/olvb/phaze)**: AudioWorklet-based phase vocoder, real-time, open source
- **[Superpowered](https://superpowered.com)**: Commercial WASM SDK with improved phase-vocoder algorithm (bypasses IEEE floating-point precision errors)

**Verdict**: Overkill for monophonic vocal samples. Phase vocoders excel at polyphonic material; for single-voice UTAU samples, PSOLA or WORLD produce better results with less complexity.

#### 4. Rubber Band Library (via WebAssembly)

**How it works**: Professional C++ library compiled to WASM. Uses phase vocoder internally with proprietary enhancements for quality.

| Aspect | Assessment |
|--------|-----------|
| Latency | ~46ms (internal windowing) |
| CPU | Moderate (WASM-optimized) |
| Quality at +/-3 st | Excellent |
| Quality at +/-12 st | Very good |
| Formant preservation | Yes (R3 engine mode) |
| Time stretch | Yes (primary use case) |
| Browser support | Via AudioWorklet ([rubberband-web](https://www.npmjs.com/package/rubberband-web)) |
| Implementation complexity | Low (library integration) |

The `rubberband-web` npm package provides a ready-to-use AudioWorklet with `setPitch()` and `setTempo()` methods. The R3 engine supports formant preservation out of the box.

**Verdict**: Strong candidate for "buy vs. build" decision. Provides high quality with minimal implementation effort. However: adds a WASM dependency (~2-4MB), requires AudioWorklet (supported in all modern browsers), and the library is GPL-licensed (or commercial license required).

#### 5. WORLD Vocoder (via WebAssembly)

**How it works**: Decomposes voice into three components -- F0 (pitch), spectral envelope (formants), and aperiodicity (breathiness). Each can be manipulated independently. Reconstruction produces high-quality output.

| Aspect | Assessment |
|--------|-----------|
| Latency | Buffer-length (analysis + synthesis) |
| CPU | High (three-pass analysis) |
| Quality at +/-3 st | Excellent |
| Quality at +/-12 st | Excellent (independent formant control) |
| Formant preservation | Native (core design principle) |
| Time stretch | Yes (frame interpolation) |
| Browser support | Would require C -> WASM compilation |
| Implementation complexity | Very high (no existing browser port) |

WORLD is the gold standard used by OpenUTAU's WORLDLINE-R resampler and the Straycat resampler. However, no browser port currently exists. The C codebase would need WASM compilation and an AudioWorklet or Web Worker bridge.

**Verdict**: Aspirational (P3-P4). Maximum quality but highest implementation cost. Consider as a future upgrade path after PSOLA + formant envelope is working.

### Technology Comparison Matrix

| Approach | Quality | Latency | CPU | Complexity | Formants | License |
|----------|---------|---------|-----|------------|----------|---------|
| Playback rate | Low | 0ms | Minimal | Trivial | No | N/A |
| TD-PSOLA | Good | Buffer | Low-Med | Medium | Add-on | MIT (ours) |
| Phase vocoder | Good | 46-93ms | Med-High | High | Add-on | Varies |
| Rubber Band WASM | Very Good | ~46ms | Medium | Low | Yes (R3) | GPL/Commercial |
| WORLD WASM | Excellent | Buffer | High | Very High | Native | Modified BSD |

### Recommendation

For a browser-based UTAU preview tool with +/-12 semitone range and 0.5-3 second samples:

**Primary path**: TD-PSOLA with cepstral envelope preservation (reuse existing `psola.ts`, add formant extraction, move to Web Worker)

**Rationale**:
- We already have a working PSOLA implementation
- PSOLA is purpose-built for monophonic pitched audio (exactly our use case)
- Adding cepstral envelope preservation addresses the formant issue
- Web Worker offloading eliminates main-thread blocking
- No external dependencies (pure TypeScript)
- Battle-tested in UTAU/Praat/speech synthesis for decades

**Fallback path**: Playback-rate for pitch shifts <= 2 semitones (current path, zero overhead)

**Future upgrade path**: WORLD vocoder WASM (when/if quality demands justify the effort)

---

## Functional Requirements

### FR-1: Pitch Shifting

#### FR-1.1: Primary Pitch Shifting (Formant-Preserving PSOLA)

The engine SHALL provide formant-preserving pitch shifting using TD-PSOLA with spectral envelope correction.

- **FR-1.1.1**: Pitch shifts from -12 to +12 semitones SHALL produce output without audible chipmunk/Darth Vader effects.
- **FR-1.1.2**: The PSOLA analysis phase (pitch mark detection) SHALL execute off the main thread via a Web Worker.
- **FR-1.1.3**: The PSOLA synthesis phase SHALL produce an AudioBuffer that can be played via standard Web Audio nodes.
- **FR-1.1.4**: Formant preservation SHALL use cepstral envelope extraction: compute spectral envelope from source, pitch-shift excitation only, re-apply original envelope to output.
- **FR-1.1.5**: The engine SHALL support optional natural formant scaling (~15% of pitch shift applied to formant frequencies) for more natural results.
- **FR-1.1.6**: PSOLA analysis results SHALL be cached per AudioBuffer to avoid redundant computation (existing `PsolaAnalysisCache` pattern).

#### FR-1.2: Fallback Pitch Shifting (Playback Rate)

The engine SHALL retain playback-rate pitch shifting as a fast fallback.

- **FR-1.2.1**: For pitch shifts of +/-2 semitones or less, the engine MAY use playback-rate shifting to minimize latency and CPU.
- **FR-1.2.2**: The threshold for switching between PSOLA and playback-rate SHALL be configurable (default: 2 semitones).
- **FR-1.2.3**: The fallback path SHALL use the existing `AudioBufferSourceNode.playbackRate` approach.

#### FR-1.3: Pitch Bend Curves (Backlog: wad)

The engine SHALL support continuous pitch modulation within a note.

- **FR-1.3.1**: `PhraseNote` SHALL accept an optional `pitchBend` array of `{time: number, cents: number}` keyframes.
- **FR-1.3.2**: Pitch bends SHALL be applied via `AudioParam.linearRampToValueAtTime` on the `detune` parameter (playback-rate path) or via pre-computed PSOLA buffer segments (PSOLA path).
- **FR-1.3.3**: Pitch bends and vibrato SHALL compose additively.

### FR-2: Volume & Normalization

#### FR-2.1: Loudness Normalization (Preserve Existing)

The engine SHALL preserve the existing loudness normalization pipeline.

- **FR-2.1.1**: Normalization SHALL use vowel-region-only RMS analysis with soft-knee peak limiting (target -18dB, max gain 12dB).
- **FR-2.1.2**: Join gain correction SHALL be pre-computed for all note pairs before scheduling begins.
- **FR-2.1.3**: The effective velocity formula SHALL remain: `effectiveVelocity = baseVelocity * normalizationGain * joinGain`.

#### FR-2.2: Per-Note Velocity

- **FR-2.2.1**: Each note SHALL accept a velocity parameter (0.0-1.0, default 1.0).
- **FR-2.2.2**: Velocity SHALL multiply with normalization gain, not replace it.

### FR-3: Envelope Shaping

#### FR-3.1: ADSR Envelopes (Preserve Existing)

- **FR-3.1.1**: Every note SHALL have an ADSR envelope (per-note or default).
- **FR-3.1.2**: Default envelope: attack=10ms, decay=50ms, sustain=0.8, release=50ms.
- **FR-3.1.3**: ADSR times SHALL be compressed proportionally when they exceed available note duration.
- **FR-3.1.4**: Attack/release SHALL be capped to crossfade timing to prevent overlap with adjacent notes.

#### FR-3.2: Equal-Power Crossfades (Preserve Existing)

- **FR-3.2.1**: Consecutive notes SHALL crossfade using sin/cos equal-power curves.
- **FR-3.2.2**: Dynamic overlap duration SHALL be computed from spectral distance when enabled.
- **FR-3.2.3**: The first note in a phrase SHALL use a short anti-click fade-in (20ms) instead of a full crossfade.

### FR-4: Vibrato

#### FR-4.1: Vibrato Modulation (Preserve Existing)

- **FR-4.1.1**: Vibrato SHALL be implemented via native OscillatorNode -> GainNode -> AudioParam connection for sample-accurate modulation.
- **FR-4.1.2**: Vibrato parameters SHALL include: rate (Hz), depth (cents), delay (ms).
- **FR-4.1.3**: Vibrato SHALL ramp up smoothly after the delay period and ramp down before note end.
- **FR-4.1.4**: On the PSOLA path, vibrato SHALL be applied via the `detune` AudioParam of the output `AudioBufferSourceNode`.

### FR-5: Vowel-Region Looping (Preserve Existing)

- **FR-5.1**: Notes longer than the available sample duration SHALL loop the vowel region (consonant marker to cutoff).
- **FR-5.2**: Looping SHALL require a minimum vowel region of 40ms.
- **FR-5.3**: Loop boundaries SHALL use `AudioBufferSourceNode.loopStart` and `.loopEnd`.

### FR-6: Time Stretching (Backlog: sa5)

#### FR-6.1: Independent Time Stretching

The engine SHALL support stretching note duration independently from pitch.

- **FR-6.1.1**: `PhraseNote` SHALL accept an optional `timeStretch` factor (default 1.0).
- **FR-6.1.2**: Time stretching SHALL be implemented via PSOLA frame repetition/skipping (not playback-rate).
- **FR-6.1.3**: Time-stretched buffers SHALL be pre-computed in the Web Worker alongside pitch shifting.
- **FR-6.1.4**: When a note requires both pitch shift and time stretch, both SHALL be applied in a single PSOLA pass.

### FR-7: Spectral Smoothing at Joins (Backlog: 8kx)

#### FR-7.1: Timbre Continuity

The engine SHALL smooth spectral discontinuities at concatenation boundaries.

- **FR-7.1.1**: At each note boundary, the engine SHALL compute LPC coefficients for the outgoing and incoming regions.
- **FR-7.1.2**: The engine SHALL interpolate LPC parameters across the crossfade region.
- **FR-7.1.3**: Smoothing intensity SHALL scale with spectral distance (more smoothing where timbre mismatch is greater).
- **FR-7.1.4**: Spectral smoothing SHALL compose with amplitude crossfading (applied before the gain envelope).

### FR-8: Sample Card Hover Preview

#### FR-8.1: Simple Preview Playback

- **FR-8.1.1**: Hover preview SHALL play a 500ms excerpt starting from the oto offset.
- **FR-8.1.2**: Preview SHALL support vowel-region looping when available.
- **FR-8.1.3**: Preview SHALL NOT use MelodyPlayer (direct AudioBufferSourceNode is appropriate for this simple case).
- **FR-8.1.4**: Preview SHALL use the shared AudioContext singleton.

### FR-9: Pre-Processing Pipeline

#### FR-9.1: Offline Buffer Preparation

For formant-preserving pitch shifting, audio buffers must be pre-processed before real-time scheduling.

- **FR-9.1.1**: When a phrase is submitted for playback, the engine SHALL pre-process all required pitch-shifted buffers before scheduling begins.
- **FR-9.1.2**: Pre-processing SHALL execute in a Web Worker to avoid blocking the main thread.
- **FR-9.1.3**: Pre-processed buffers SHALL be cached with a key of `(audioBuffer, pitchShift, timeStretch)`.
- **FR-9.1.4**: The cache SHALL use an LRU eviction strategy with a configurable maximum size (default: 100 entries).
- **FR-9.1.5**: Cache entries SHALL be invalidated when oto parameters change.

### FR-10: Playback Control

#### FR-10.1: Transport Controls

- **FR-10.1.1**: The engine SHALL support `play()`, `stop()`, and `dispose()` operations.
- **FR-10.1.2**: `stop()` SHALL immediately halt all active notes and clean up nodes.
- **FR-10.1.3**: `dispose()` SHALL permanently release all resources (the instance becomes unusable).
- **FR-10.1.4**: UTAU-style 2-note polyphony cap SHALL be enforced: each note must reach zero gain before the note-after-next starts.

#### FR-10.2: Playback Events

- **FR-10.2.1**: The engine SHALL emit events for: playback start, note start (with alias), playback end.
- **FR-10.2.2**: Events SHALL enable UI features like progress bars and lyric highlighting.

---

## Non-Functional Requirements

### NFR-1: Latency

- **NFR-1.1**: Time from `play()` call to first audible output SHALL be under 200ms for phrases with up to 20 notes using cached PSOLA buffers.
- **NFR-1.2**: Time from `play()` call to first audible output SHALL be under 500ms for phrases requiring fresh PSOLA processing (up to 20 notes, samples under 3 seconds each).
- **NFR-1.3**: Pre-processing in Web Worker SHALL process a 2-second mono 44.1kHz sample in under 100ms.
- **NFR-1.4**: Hover preview (sample card) SHALL produce audio within 50ms of the hover timer firing (no pre-processing needed since no pitch shift).

### NFR-2: CPU Usage

- **NFR-2.1**: During playback of a 20-note phrase, main-thread CPU usage from audio scheduling SHALL not exceed 5% on a mid-range laptop (2020 era).
- **NFR-2.2**: Web Worker PSOLA processing SHALL not cause audio glitches on the main thread.
- **NFR-2.3**: The engine SHALL not create more than 4 concurrent AudioBufferSourceNode instances (2-note polyphony cap + crossfade overlap).

### NFR-3: Memory

- **NFR-3.1**: The PSOLA buffer cache SHALL not exceed 50MB of AudioBuffer memory.
- **NFR-3.2**: Cache eviction SHALL be automatic via LRU strategy.
- **NFR-3.3**: `dispose()` SHALL release all cached buffers and Web Worker resources.

### NFR-4: Browser Compatibility

- **NFR-4.1**: The engine SHALL work in Chrome 90+, Firefox 90+, Safari 15+, and Edge 90+.
- **NFR-4.2**: AudioWorklet is NOT required (Web Worker + pre-computed buffers avoids the AudioWorklet dependency).
- **NFR-4.3**: The Firefox polyfill for `cancelAndHoldAtTime` SHALL be preserved.
- **NFR-4.4**: The engine SHALL handle suspended AudioContext gracefully (resume on user gesture).

### NFR-5: Code Quality

- **NFR-5.1**: The v2 engine SHALL have no dependency on Tone.js.
- **NFR-5.2**: All audio processing code SHALL be pure TypeScript (no external DSP libraries in the initial version).
- **NFR-5.3**: The Web Worker SHALL communicate via structured-clone-compatible messages (transferable ArrayBuffers for audio data).
- **NFR-5.4**: The engine SHALL follow the existing codebase conventions: ruff-formatted Python, Lit decorators for components, Tailwind for styles.

### NFR-6: Testability

- **NFR-6.1**: PSOLA analysis and synthesis functions SHALL be independently testable with synthetic waveforms.
- **NFR-6.2**: The Web Worker communication layer SHALL be mockable for unit tests.
- **NFR-6.3**: Loudness normalization and gain calculations SHALL remain pure functions.

---

## Recommended Architecture

### High-Level Design

```
                          Main Thread                          Web Worker
                    +-----------------------+           +-------------------+
                    |                       |           |                   |
Consumers -------> |   MelodyPlayer v2      |  postMsg  | AudioProcessor    |
                    |   (Orchestrator)       | -------> |   Worker          |
                    |                       |           |                   |
                    |   1. Collect phrase    |           | 1. PSOLA analysis |
                    |   2. Request buffers   |           | 2. Formant extract|
                    |   3. Schedule playback |  <------- | 3. PSOLA synthesis|
                    |   4. Manage envelopes  | transfer  | 4. Return buffers |
                    |   5. Handle events     |           |                   |
                    +-----------------------+           +-------------------+
                         |        |
              +----------+--------+----------+
              |          |        |          |
          GainNode  ADSR    Vibrato    Crossfade
              |     Envelope   LFO      Curves
              v
      AudioContext.destination
```

### Component Breakdown

#### 1. MelodyPlayer v2 (Main Thread - Orchestrator)

Responsibilities:
- Accept phrase data from consumers
- Dispatch PSOLA processing requests to Web Worker
- Receive processed AudioBuffers via transferable messages
- Schedule playback using standard Web Audio nodes
- Apply ADSR envelopes, crossfades, vibrato, and normalization
- Manage active node lifecycle and cleanup

Key changes from v1:
- Remove all Tone.js / GranularPitchShifter references
- Remove `_useGranular` flag and granular code paths
- Add Web Worker communication for PSOLA pre-processing
- Keep all scheduling and envelope logic on the main thread (where Web Audio API lives)

```typescript
// Simplified API surface
class MelodyPlayerV2 {
  constructor(audioContext: AudioContext);

  // Primary playback methods (same interface as v1)
  playSequence(notes: NoteEvent[], options: SynthesisOptions): void;
  playPhrase(notes: PhraseNote[], sampleDataMap: Map<string, SampleData>, options?: PhraseOptions): void;

  // Transport
  stop(): void;
  dispose(): void;

  // State
  get isPlaying(): boolean;
  get disposed(): boolean;

  // Events
  onNoteStart?: (alias: string, index: number) => void;
  onPlaybackEnd?: () => void;
}
```

#### 2. AudioProcessor Worker (Web Worker)

Responsibilities:
- Receive AudioBuffer channel data + processing parameters
- Execute PSOLA analysis (pitch mark detection)
- Execute cepstral envelope extraction
- Execute PSOLA synthesis with formant preservation
- Return processed Float32Array via transferable message
- Cache analysis results internally

Message protocol:
```typescript
// Main -> Worker
interface ProcessRequest {
  type: 'process';
  id: string;  // Request correlation ID
  channelData: Float32Array;  // Transferable
  sampleRate: number;
  pitchShift: number;  // Semitones
  timeStretch: number;  // Factor
  preserveFormants: boolean;
  formantScale: number;  // 0.0 - 1.0, default 0.15
}

// Worker -> Main
interface ProcessResponse {
  type: 'result';
  id: string;
  channelData: Float32Array;  // Transferable
  sampleRate: number;
  outputLength: number;
}

interface ProcessError {
  type: 'error';
  id: string;
  message: string;
}
```

#### 3. PSOLA Engine (Inside Worker)

Reuses and extends the existing `psola.ts`:

- `analyzePitchMarks()` - Unchanged from current implementation
- `psolaSynthesize()` - Unchanged from current implementation
- NEW: `extractCepstralEnvelope()` - FFT -> log magnitude -> low-pass liftering -> spectral envelope
- NEW: `applyFormantPreservation()` - Shift excitation pitch, re-apply original envelope
- NEW: `psolaSynthesizeWithFormants()` - Combined pitch shift + formant preservation in single pass

#### 4. Processed Buffer Cache (Main Thread)

```typescript
interface CacheKey {
  bufferHash: string;  // Hash of AudioBuffer channel data
  pitchShift: number;
  timeStretch: number;
  preserveFormants: boolean;
}

class ProcessedBufferCache {
  private _cache: Map<string, AudioBuffer>;
  private _maxSize: number;
  private _accessOrder: string[];  // LRU tracking

  get(key: CacheKey): AudioBuffer | undefined;
  set(key: CacheKey, buffer: AudioBuffer): void;
  clear(): void;
}
```

### Data Flow: playPhrase()

```
1. Consumer calls playPhrase(notes, sampleDataMap, options)
2. MelodyPlayer:
   a. Compute loudness analysis for all samples (existing pipeline)
   b. Compute join gain corrections for all note pairs (existing pipeline)
   c. For each unique (sample, pitchShift) pair:
      - Check ProcessedBufferCache
      - If miss: post ProcessRequest to Worker (transfer channelData)
      - Collect Promise<AudioBuffer> for each
   d. await Promise.all(processingPromises)
   e. For each note in sequence:
      - Create AudioBufferSourceNode with processed buffer
      - Apply ADSR envelope via GainNode
      - Apply vibrato via OscillatorNode -> detune
      - Apply normalization + join gain to velocity
      - Schedule with AudioContext timing
      - Set up crossfade with previous note
3. Worker (for each request):
   a. Analyze pitch marks (or use cached analysis)
   b. Extract cepstral envelope (if preserveFormants)
   c. Synthesize with modified pitch marks
   d. Apply formant envelope (if preserveFormants)
   e. Transfer result back
```

### Fallback Strategy

For pitch shifts <= 2 semitones (configurable threshold):
- Skip PSOLA processing entirely
- Use the existing playback-rate path directly
- This provides zero-latency playback for small pitch shifts
- The threshold is based on the observation that formant distortion below +/-2 semitones is generally imperceptible

### Handling the PSOLA Processing Delay

Since PSOLA requires pre-processing, there is an inherent delay before playback begins. To handle this:

1. **Cache warming**: When a voicebank is loaded, pre-process common pitch shifts (0, +/-2, +/-4, +/-7 semitones) for frequently used samples in the background.
2. **Progressive playback**: Begin scheduling notes as their processed buffers become available, rather than waiting for all buffers.
3. **Loading indicator**: UI consumers should show a brief loading state while buffers are being prepared.
4. **Instant fallback**: If the user expects instant playback (e.g., clicking "play" repeatedly), fall back to playback-rate for the first play and use PSOLA for subsequent plays (once cached).

---

## Migration Path

### Phase 0: Cleanup (No Quality Change)

**Goal**: Remove dead code, simplify the codebase.

1. Remove `granular-pitch-shifter.ts` (1126 lines of dead code)
2. Remove `GranularPitchShifter` import and all `_useGranular` branching from `melody-player.ts`
3. Remove `_scheduleGranularPhraseNote()`, `_scheduleGranularNote()`, and related methods
4. Remove `GrainPlayer` and Tone.js dependency from `package.json`
5. Keep `psola.ts` (will be reused in Phase 2)
6. Keep `pitch-detection.ts` (will be reused in Phase 2)
7. Keep all working subsystems: normalization, ADSR, crossfades, vibrato, looping

**Risk**: None. All removed code is behind `useGranular: false` flags.
**Estimated reduction**: ~1200 lines removed, Tone.js dependency eliminated.

### Phase 1: Web Worker Infrastructure

**Goal**: Establish the worker communication pattern without changing audio quality.

1. Create `audio-processor.worker.ts` with message protocol
2. Move existing `psola.ts` functions into the worker
3. Add `ProcessedBufferCache` to MelodyPlayer
4. Wire up the request/response flow with transferable ArrayBuffers
5. Test with existing PSOLA (no formant preservation yet)

**Risk**: Low. Web Workers are well-supported. The PSOLA code is pure computation with no DOM dependencies.
**Quality change**: PSOLA pitch shifting becomes available (improvement over playback-rate) but without formant preservation.

### Phase 2: Formant-Preserving PSOLA

**Goal**: Add cepstral envelope extraction and formant preservation.

1. Implement `extractCepstralEnvelope()` in the worker
2. Implement `applyFormantPreservation()` in the worker
3. Add `preserveFormants` option to synthesis options
4. Add configurable formant scaling factor (default 15%)
5. Set PSOLA as primary path for pitch shifts > 2 semitones

**Risk**: Moderate. Cepstral analysis is mathematically well-understood but requires careful implementation (FFT windowing, lifter cutoff selection). Testing with real voicebank samples is essential.
**Quality change**: Major improvement. Eliminates chipmunk effect at wide pitch intervals.

### Phase 3: Backlog Features

**Goal**: Implement the remaining audio backlog items.

1. **Pitch bend curves** (wad): Add `pitchBend` keyframes to PhraseNote, apply via `detune` AudioParam scheduling
2. **Independent time stretching** (sa5): Add `timeStretch` to PhraseNote, apply via PSOLA frame manipulation in the same worker pass
3. **Spectral smoothing** (8kx): Add LPC analysis at note boundaries, interpolate coefficients across crossfade region

**Risk**: Low-moderate per feature. Each builds on the Phase 1-2 infrastructure.

### Phase 4: Future Upgrades (Optional)

1. **WORLD vocoder WASM** (e1n): Compile WORLD C code to WASM, integrate as alternative processing backend in the worker
2. **Natural formant scaling** (kq8): Apply configurable percentage of pitch shift to formant frequencies
3. **Spectral envelope visualization** (t2i): Feed cepstral analysis results to a canvas renderer
4. **Neural post-processing** (o9r, 2wi): Add HiFi-GAN or RVC as optional post-processor after PSOLA output

---

## Out of Scope

The following are explicitly NOT part of the v2 audio engine:

1. **Multi-track mixing** - Single-voice synthesis only. Multi-track belongs to the DAW epic (utau_voicebank_manager-4ua).
2. **MIDI input/output** - No MIDI integration in the preview engine.
3. **Plugin hosting (WAM/CLAP)** - No audio plugin support.
4. **Real-time microphone input** - No live audio processing.
5. **Audio recording/export** - No WAV/MP3 rendering. This is a preview tool.
6. **Neural synthesis (DiffSinger/GPT-SoVITS)** - Covered by separate epics (utau_voicebank_manager-t21, utau_voicebank_manager-526).
7. **AudioWorklet-based processing** - The pre-computed buffer approach via Web Worker is simpler and avoids AudioWorklet's complexity (cross-thread memory sharing, worklet registration, Safari quirks). AudioWorklet would only be needed for true real-time streaming synthesis, which is not our use case.
8. **Polyphonic pitch shifting** - All samples are monophonic voice recordings.
9. **Tempo/BPM synchronization** - No beat-locked playback; timing is absolute seconds.
10. **Rubber Band / Superpowered integration** - While these are high-quality options, the licensing complexity (GPL/commercial) and the fact that we already have a working PSOLA implementation make them unnecessary for v1 of the v2 engine. Can be revisited if PSOLA + formants proves insufficient.

---

## References

### Internal Files

| File | Path | Lines | Role |
|------|------|-------|------|
| MelodyPlayer | `src/frontend/src/services/melody-player.ts` | 2282 | Main playback orchestrator |
| GranularPitchShifter | `src/frontend/src/services/granular-pitch-shifter.ts` | 1126 | Dead code (Tone.js wrapper) |
| PSOLA | `src/frontend/src/utils/psola.ts` | 731 | TD-PSOLA implementation |
| Pitch Detection | `src/frontend/src/utils/pitch-detection.ts` | 522 | Autocorrelation pitch detection |
| Loudness Analysis | `src/frontend/src/utils/loudness-analysis.ts` | 885 | RMS normalization, join correction |
| Audio Context | `src/frontend/src/services/audio-context.ts` | 54 | Shared singleton + polyfill |
| Demo Songs | `src/frontend/src/data/demo-songs.ts` | 547 | 5 demo songs |
| Sample Card | `src/frontend/src/components/uvm-sample-card.ts` | 582 | Hover preview playback |
| First Sing | `src/frontend/src/components/uvm-first-sing.ts` | 610 | "Hear Your Voice" consumer |
| Quick Phrase | `src/frontend/src/components/uvm-quick-phrase.ts` | 900 | Text-to-singing consumer |
| Phrase Preview | `src/frontend/src/components/uvm-phrase-preview.ts` | 639 | Demo song player consumer |

### External References

- [TD-PSOLA Reference Implementation](https://github.com/sannawag/TD-PSOLA) - Python TD-PSOLA
- [WORLD Vocoder](https://github.com/mmorise/World) - C++ vocoder (Morise et al.)
- [Phaze](https://github.com/olvb/phaze) - AudioWorklet phase vocoder
- [rubberband-web](https://www.npmjs.com/package/rubberband-web) - Rubber Band AudioWorklet
- [SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) - JS time-stretching
- [Superpowered](https://superpowered.com) - Commercial WASM audio SDK
- [OpenUTAU](https://github.com/stakira/OpenUtau) - Reference UTAU implementation
- [Straycat Resampler](https://github.com/UtaUtaUtau/straycat) - WORLD-based UTAU resampler
- [AudioWorklet MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet) - AudioWorklet documentation
- [Moulines & Charpentier (1990)](https://scholar.google.com/scholar?q=Moulines+Charpentier+1990+PSOLA) - Original TD-PSOLA paper
- [WORLD Paper](https://www.jstage.jst.go.jp/article/transinf/E99.D/7/E99.D_2015EDP7457/_article) - Morise et al., IEICE 2016
- [Bernsee: Time-Pitch Overview](http://blogs.zynaptiq.com/bernsee/time-pitch-overview/) - Comprehensive technique comparison
- [Stanford Phase Vocoder + PSOLA](https://web.stanford.edu/class/ee264/projects/EE264_w2015_final_project_kong.pdf) - Academic comparison
