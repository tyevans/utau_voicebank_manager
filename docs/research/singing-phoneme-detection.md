# Singing Voice Phoneme Detection Research

**Date**: 2026-01-31
**Context**: Current MMS_FA model struggles with sustained vowels in UTAU voicebank samples

## The Core Problem

Speech-trained forced alignment models (MMS_FA, MFA) detect phonemes as 50-200ms segments, but UTAU voicebank samples contain **sustained vowels lasting 1-3+ seconds**. The model correctly finds phoneme onsets but produces very short segments, resulting in low confidence scores.

---

## Most Promising Solutions

### 1. SOFA (Singing-Oriented Forced Aligner)
**Repository**: https://github.com/qiuqiao/SOFA

Purpose-built for singing voice alignment with advantages over MFA:
- Easier installation
- Better performance on singing
- Faster inference

**Key Features**:
- Neural alignment model (PyTorch-based)
- G2P module for lyrics → phoneme conversion
- ONNX export for deployment
- Pretrained models available (English, Mandarin, Korean, French)

**Evaluation Metrics**:
- Boundary Edit Distance
- Boundary Edit Ratio
- Boundary Error Rate (10ms, 20ms, 50ms tolerance)

**Integration Notes**:
- LabelMakr (https://github.com/spicytigermeat/LabelMakr) provides GUI wrapper
- English model: `tgm_en_v100` trained on SOFA v1.0.3

### 2. Hierarchical CNN + HMM Segmentation
**Paper**: "Singing voice phoneme segmentation by hierarchically inferring syllable and phoneme onset positions" (INTERSPEECH 2018)
**Repository**: https://github.com/ronggong/interspeech2018_submission01

**Two-step approach**:
1. **CNN Onset Detection**: Single-layer CNN with multi-filter shapes on log-mel features
2. **HSMM Boundary Inference**: Left-to-right semi-Markov chain with duration priors

**Key Insight**: Separate onset detection from duration modeling. The CNN finds where phonemes *start*, then the HMM uses duration distributions to find boundaries.

**Advantages**:
- Language-independent (no phoneme labels needed)
- Handles sustained vowels through explicit duration modeling
- Outperforms HSMM forced alignment baseline

### 3. STARS Framework (2025)
**Paper**: https://arxiv.org/abs/2507.06670

Multi-level unified framework for singing transcription and alignment:
- U-Net architecture with Conformer blocks
- Frame-level phoneme logits + Viterbi forced alignment
- CTC loss for phoneme alignment
- BCE loss for boundary detection

**Novel approach**: FreqMOE (Frequency Mixture of Experts) partitions frequency dimension with specialized experts.

---

## Signal Processing Techniques

### Onset Detection for Singing
Standard spectral flux achieves only **55.9% F-measure** on solo singing (MIREX 2012). Better alternatives:

1. **NINOS2** (Normalized Identification of Note Onset based on Spectral Sparsity)
   - Outperforms Logarithmic Spectral Flux for sustained instruments
   - Better handles vibrato and soft onsets

2. **Consonant-Vowel Transition Analysis**
   - Spectral peak at burst
   - Voice onset time (VOT)
   - Formant transition trajectories

### Vowel Onset Point Detection
- Use spectral energy at formant frequencies
- Zero-frequency filter for voiced/unvoiced transitions
- Power spectrum correlation between adjacent frames

### F0-Based Segmentation
- RMVPE for F0 extraction
- DWT decomposition into low/high frequency components
- Note boundaries often correlate with F0 discontinuities

---

## Existing Tools Comparison

| Tool | Approach | Singing Support | Notes |
|------|----------|-----------------|-------|
| **SOFA** | Neural + G2P | Excellent | Purpose-built for singing |
| **MFA** | GMM-HMM | Poor | Speech-optimized |
| **MMS_FA** | Wav2Vec2 + CTC | Poor | Speech-optimized |
| **Moresampler** | ML-based | Fair | UTAU-specific, inconsistent results |
| **NNSVS** | Neural (Sinsy-style) | Good | Full SVS toolkit |
| **LabelMakr** | Whisper + SOFA | Good | GUI for DiffSinger labeling |

---

## UTAU-Specific Considerations

### oto.ini Parameters
| Param | Detection Strategy |
|-------|-------------------|
| offset | Onset detection (energy threshold, spectral flux) |
| consonant | CV transition detection (formant movement) |
| preutterance | Onset - small margin |
| overlap | Based on phoneme type (voiced consonants need more) |
| cutoff | Energy drop-off detection (RMS threshold) |

### Recording Style Differences
- **CV samples**: Single consonant-vowel, sustained
- **VCV samples**: Multiple phonemes per file, need internal boundaries
- **CVVC**: Requires both onset and offset for each component

### BPM-Based Approaches
Traditional UTAU tools use recording tempo for calculations:
```
beat_duration_ms = 60000 / BPM
offset = beat_position * beat_duration_ms - preutterance
```
This works for rhythm-locked recordings but not for freely-sung samples.

---

## Recommended Implementation Strategy

### Short-term: Hybrid Approach (Current)
1. Use MMS_FA for phoneme onset detection (accurate for consonants)
2. RMS energy analysis for sound boundaries
3. Extend final segment to energy-detected end
4. Gap correction for consecutive segments

### Medium-term: Integrate SOFA
1. Install SOFA as alternative detector
2. Compare results with MMS_FA
3. Use ensemble voting for confidence
4. Train custom model on UTAU voicebank data if needed

### Long-term: Custom Model
1. Collect labeled UTAU voicebank data
2. Train CNN for onset detection on singing-specific features
3. Duration HMM with UTAU-specific priors
4. End-to-end fine-tuning

---

## Key Papers

1. **Hierarchical Phoneme Segmentation**
   - Gong et al. (2018) INTERSPEECH
   - https://arxiv.org/abs/1806.01665

2. **NNSVS Toolkit**
   - Yamamoto et al. (2022) ICASSP 2023
   - https://arxiv.org/abs/2210.15987

3. **DiffSinger**
   - Liu et al. (2022) AAAI
   - https://arxiv.org/abs/2105.02446

4. **STARS Framework**
   - ACL 2025
   - https://arxiv.org/abs/2507.06670

5. **Spectral Sparsity for Onset Detection**
   - EURASIP JASM 2021
   - https://asmp-eurasipjournals.springeropen.com/articles/10.1186/s13636-021-00214-7

---

## GitHub Resources

- **SOFA**: https://github.com/qiuqiao/SOFA
- **LabelMakr**: https://github.com/spicytigermeat/LabelMakr
- **NNSVS**: https://github.com/nnsvs/nnsvs
- **Hierarchical Segmentation**: https://github.com/ronggong/interspeech2018_submission01
- **Lyrics Aligner**: https://github.com/schufo/lyrics-aligner
- **DiffSinger**: https://github.com/MoonInTheRiver/DiffSinger
