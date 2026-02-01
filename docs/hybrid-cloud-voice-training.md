# Hybrid Cloud Voice Training Pipeline

> Design document for AI-powered voice model training with browser-based recording and cloud GPU training.

## Vision

Transform the platform from UTAU-only to a comprehensive voice creation studio:

**Record → UTAU Voicebank → Neural Voice Model → Use Anywhere**

Users get instant UTAU output AND can upgrade to AI-powered neural synthesis.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      BROWSER (WebGPU)                        │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  Recording  │→ │ Preprocessing │→ │ Inference (ONNX)   │  │
│  │  Web Audio  │  │ MFA alignment │  │ TTS playback       │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           ↓ upload audio (1-30 min)
┌─────────────────────────────────────────────────────────────┐
│                      CLOUD (GPU)                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  GPT-SoVITS Fine-tuning                                 ││
│  │  • 1 min audio → 2 min training (RTX 3080)              ││
│  │  • 167M params (v1/v2) or 407M (v3)                     ││
│  │  • Export ONNX for browser inference                    ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │  DiffSinger Training (Optional, higher quality)         ││
│  │  • 30+ min singing audio required                       ││
│  │  • ~28M params, hours of training                       ││
│  │  • Export for OpenUTAU                                  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                           ↓ download model
┌─────────────────────────────────────────────────────────────┐
│              USER'S DEVICE (Browser or Desktop)              │
│  • UTAU voicebank (instant, works everywhere)               │
│  • Neural TTS model (ONNX, runs in browser via WebGPU)      │
│  • DiffSinger model (ONNX, runs in OpenUTAU)                │
└─────────────────────────────────────────────────────────────┘
```

---

## User Journey

### Phase 1: Quick Start (Existing)
1. Record prompts (paragraph-based, ~15 sentences)
2. Auto-alignment + auto-oto
3. Download UTAU voicebank

**Time: 10-15 minutes**

### Phase 2: Neural Upgrade (New)
4. "Upgrade to AI Voice" button
5. Upload recordings to cloud
6. GPT-SoVITS fine-tuning (~2 min)
7. Download personalized TTS model

**Time: +5 minutes**

### Phase 3: Singing Synthesis (Advanced)
8. Record full songs (30+ min)
9. DiffSinger training (hours)
10. Download for OpenUTAU

**Time: Hours-days**

---

## Model Architecture Comparison

### Voice Synthesis Models

| Model | Parameters | Training Data | Training Time | GPU Required |
|-------|------------|---------------|---------------|--------------|
| **DiffSinger** | ~28M | 30+ min songs | Hours-days | 8GB+ VRAM |
| **GPT-SoVITS v1/v2** | 167M (90M+77M) | 1-30 min | ~2 min | 6GB+ VRAM |
| **GPT-SoVITS v3** | 407M (330M+77M) | 1-30 min | Longer | 12-16GB VRAM |
| **F5-TTS** | 336M | 100K hrs* | 1 week | 8x A100 80GB |
| **Chatterbox** | 500M | 500K hrs* | N/A | Pretrained only |
| **Chatterbox-Turbo** | 350M | - | N/A | 4GB (inference) |

*Pre-trained on massive datasets; fine-tuning needs much less

### Architecture Details

#### GPT-SoVITS
- Hybrid GPT + VITS architecture
- GPT handles semantic understanding and prosody prediction
- SoVITS generates acoustic features
- v3 adds Conditional Flow Matching Diffusion Transformers

#### DiffSinger
- Diffusion-based acoustic model (AAAI 2022)
- Variance Model → Acoustic Model → Vocoder pipeline
- Uses WaveNet or LYNXNet denoiser
- NSF-HiFiGAN vocoder for waveform generation

#### Chatterbox-Turbo
- Modified Llama architecture (350M params)
- 1-step diffusion decoder (distilled from 10-step)
- Optimized for real-time inference
- ONNX export available

---

## WebGPU Training Viability

### Status: NOT VIABLE for Training

WebGPU in 2025 is primarily suited for **inference**, not training.

| Capability | Browser Support |
|------------|-----------------|
| Inference with quantized models | ✅ Works well |
| Small fine-tuning demos | ⚠️ CPU-only, single-threaded |
| Training 28M+ param models | ❌ Not practical |
| Full voice model training | ❌ Impossible |

### Key Limitations

1. **ONNX Runtime Web training = CPU-only, single-threaded**
2. Browser memory caps (~4GB typical)
3. WebGPU fragmentation across browsers:
   - Chrome: Works, but multi-GPU and power management bugs
   - Firefox: Experimental only, 90% spec compliance
   - Safari: Just shipped in Safari 26 beta (June 2025)
4. Cross-origin isolation requirements break production deployments

### What IS Possible in Browser

- Inference with ONNX models via WebGPU
- Quantized models (INT8, INT4) for reduced memory
- Real-time TTS playback with Chatterbox-Turbo
- Audio recording and preprocessing

### Recommendation

**Hybrid approach**: Browser for recording/inference, cloud for training.

---

## Technical Components

### Browser (WebGPU/ONNX)

| Component | Technology | Purpose |
|-----------|------------|---------|
| Recording | Web Audio API | Capture user voice |
| Preprocessing | MFA (Montreal Forced Aligner) | Phoneme alignment |
| TTS Inference | Chatterbox-Turbo ONNX | Pronunciation examples |
| Model Loading | ONNX Runtime Web + WebGPU | Run trained models |

### Cloud Backend

| Component | Technology | Purpose |
|-----------|------------|---------|
| GPU Instances | Modal.com / RunPod / Self-hosted | On-demand training |
| Training Pipeline | GPT-SoVITS / DiffSinger | Voice model training |
| Model Export | PyTorch → ONNX | Browser-compatible format |
| Storage | S3-compatible | Audio and model storage |
| API | FastAPI | Training orchestration |

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Cloud GPU backend infrastructure
- [ ] Audio upload/storage service
- [ ] GPT-SoVITS training pipeline integration

### Phase 2: Training Pipeline
- [ ] GPT-SoVITS fine-tuning API endpoint
- [ ] Training progress WebSocket notifications
- [ ] ONNX model export from trained model

### Phase 3: Browser Inference
- [ ] Chatterbox-Turbo ONNX integration
- [ ] WebGPU inference service
- [ ] Model caching and loading UX

### Phase 4: UI Integration
- [ ] "Upgrade to AI Voice" button after voicebank creation
- [ ] Training progress UI
- [ ] Model download and test interface

### Phase 5: DiffSinger (Optional)
- [ ] DiffSinger training pipeline
- [ ] Song recording mode (full songs vs prompts)
- [ ] OpenUTAU export format

---

## Business Model Options

| Tier | Features | Cost Model |
|------|----------|------------|
| **Free** | UTAU voicebank only | Free |
| **Pro** | Neural voice training | Per-training or subscription |
| **Enterprise** | Self-hosted training | License fee |

### Cost Considerations

- GPU training: ~$0.50-2.00 per voice (2 min on RTX 3080 equivalent)
- Storage: Minimal (models are ~150-200MB)
- Inference: Free (runs in user's browser)

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Time from recording to neural voice | < 10 min |
| Voice quality MOS score | > 4.0 |
| Browser inference RTF | < 0.1 (real-time) |
| Training success rate | > 95% |

---

## Technical Decisions Needed

1. **Cloud provider**: Modal.com vs RunPod vs self-hosted?
2. **Pricing model**: Per-training vs subscription?
3. **Model storage**: User downloads vs cloud-hosted inference?
4. **GPT-SoVITS version**: v2 (smaller, faster) vs v3 (better quality)?

---

## References

### Models
- [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) - Few-shot voice cloning
- [DiffSinger](https://github.com/openvpi/DiffSinger) - Singing voice synthesis
- [Chatterbox](https://github.com/resemble-ai/chatterbox) - Open-source TTS
- [F5-TTS](https://github.com/SWivid/F5-TTS) - Flow matching TTS

### Browser ML
- [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [WebGPU 2025 Guide](https://aicompetence.org/ai-in-browser-with-webgpu/)

### Research Papers
- [DiffSinger: Singing Voice Synthesis via Shallow Diffusion Mechanism](https://arxiv.org/abs/2105.02446) (AAAI 2022)
- [F5-TTS: A Fairytaler that Fakes Fluent and Faithful Speech](https://arxiv.org/abs/2410.06885)

---

*Created: 2025-01-31*
*Status: Design Phase*
*Epic: utau_voicebank_manager-526*
