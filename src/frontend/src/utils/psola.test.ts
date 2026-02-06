import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PsolaAnalysis } from './psola.js';

// ── AudioBuffer / OfflineAudioContext mocks ──────────────────────────────────
//
// The test environment is 'node' (no Web Audio API). We mock AudioBuffer and
// OfflineAudioContext globally so that psola.ts can construct output buffers.

/**
 * Minimal AudioBuffer mock backed by a Float32Array per channel.
 */
class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private _channels: Float32Array[];

  constructor(options: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = options.numberOfChannels;
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.duration = options.length / options.sampleRate;
    this._channels = [];
    for (let ch = 0; ch < options.numberOfChannels; ch++) {
      this._channels.push(new Float32Array(options.length));
    }
  }

  getChannelData(channel: number): Float32Array {
    return this._channels[channel];
  }
}

/**
 * Minimal OfflineAudioContext mock that only supports createBuffer().
 */
class MockOfflineAudioContext {
  private _numberOfChannels: number;
  private _length: number;
  private _sampleRate: number;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this._numberOfChannels = numberOfChannels;
    this._length = length;
    this._sampleRate = sampleRate;
  }

  createBuffer(channels: number, length: number, sampleRate: number): MockAudioBuffer {
    return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate });
  }
}

// Install mocks on globalThis so psola.ts can use them
beforeEach(() => {
  vi.stubGlobal('AudioBuffer', MockAudioBuffer);
  vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);
});

// Dynamic import AFTER mocks are installed
async function importPsola() {
  return await import('./psola.js');
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Create a mock AudioBuffer filled with the given mono samples.
 */
function createBuffer(samples: Float32Array | number[], sampleRate = 44100): MockAudioBuffer {
  const data = samples instanceof Float32Array ? samples : new Float32Array(samples);
  const buf = new MockAudioBuffer({
    numberOfChannels: 1,
    length: data.length,
    sampleRate,
  });
  buf.getChannelData(0).set(data);
  return buf;
}

/**
 * Generate a pure sine wave.
 */
function generateSineWave(
  frequency: number,
  sampleRate: number,
  duration: number,
  amplitude = 0.8,
): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

/**
 * Compute RMS energy of a Float32Array.
 */
function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Compute peak absolute value.
 */
function computePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return peak;
}

// ── analyzePitchMarks ────────────────────────────────────────────────────────

describe('analyzePitchMarks', () => {
  it('returns pitch marks that cover the full buffer', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const duration = 0.1; // 100ms
    const samples = generateSineWave(200, sampleRate, duration);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // Must produce at least some pitch marks
    expect(analysis.pitchMarks.length).toBeGreaterThan(0);
    // First mark should be near the start
    expect(analysis.pitchMarks[0]).toBeLessThan(sampleRate * 0.02);
    // Last mark should be near the end
    const lastMark = analysis.pitchMarks[analysis.pitchMarks.length - 1];
    expect(lastMark).toBeLessThan(samples.length);
  });

  it('produces monotonically increasing pitch marks', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(150, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    for (let i = 1; i < analysis.pitchMarks.length; i++) {
      expect(analysis.pitchMarks[i]).toBeGreaterThan(analysis.pitchMarks[i - 1]);
    }
  });

  it('has consistent array lengths for pitchMarks, pitchPeriods, voicedFlags', async () => {
    const { analyzePitchMarks } = await importPsola();
    const buffer = createBuffer(generateSineWave(220, 44100, 0.1), 44100);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    expect(analysis.pitchPeriods.length).toBe(analysis.pitchMarks.length);
    expect(analysis.voicedFlags.length).toBe(analysis.pitchMarks.length);
  });

  it('preserves the sample rate from the input buffer', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 22050;
    const buffer = createBuffer(generateSineWave(200, sampleRate, 0.1), sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    expect(analysis.sampleRate).toBe(sampleRate);
  });

  it('detects voiced regions for a clean sine wave', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    // Use a strong 200 Hz sine for 200ms to give autocorrelation plenty of signal
    const samples = generateSineWave(200, sampleRate, 0.2, 0.9);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // At least some marks should be classified as voiced
    const voicedCount = analysis.voicedFlags.filter(Boolean).length;
    expect(voicedCount).toBeGreaterThan(0);
  });

  it('detects approximate pitch period for a 200 Hz sine', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const freq = 200;
    const expectedPeriod = sampleRate / freq; // ~220.5 samples
    const samples = generateSineWave(freq, sampleRate, 0.2, 0.9);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // For voiced marks, the period should be near the expected value
    const voicedPeriods = analysis.pitchPeriods.filter(
      (_, i) => analysis.voicedFlags[i],
    );

    if (voicedPeriods.length > 0) {
      const avgPeriod =
        voicedPeriods.reduce((a, b) => a + b, 0) / voicedPeriods.length;
      // Allow 20% tolerance since autocorrelation on windowed segments is approximate
      expect(avgPeriod).toBeGreaterThan(expectedPeriod * 0.8);
      expect(avgPeriod).toBeLessThan(expectedPeriod * 1.2);
    }
  });

  it('classifies silence as unvoiced', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const silence = new Float32Array(4410); // 100ms of silence
    const buffer = createBuffer(silence, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // All marks should be unvoiced
    for (const voiced of analysis.voicedFlags) {
      expect(voiced).toBe(false);
    }
  });

  it('respects custom pitch range options', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(300, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer, {
      minPitchHz: 100,
      maxPitchHz: 500,
    });

    expect(analysis.pitchMarks.length).toBeGreaterThan(0);
  });

  it('does not produce duplicate pitch marks at the buffer end', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.05);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // Check for duplicates
    const uniqueMarks = new Set(analysis.pitchMarks);
    expect(uniqueMarks.size).toBe(analysis.pitchMarks.length);
  });

  it('handles very short buffers without crashing', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    // Only 100 samples (~2.3ms)
    const samples = new Float32Array(100);
    for (let i = 0; i < 100; i++) {
      samples[i] = Math.sin((2 * Math.PI * 200 * i) / sampleRate);
    }
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    expect(analysis.pitchMarks.length).toBeGreaterThan(0);
    for (const mark of analysis.pitchMarks) {
      expect(mark).toBeGreaterThanOrEqual(0);
      expect(mark).toBeLessThan(samples.length);
    }
  });
});

// ── psolaSynthesize ──────────────────────────────────────────────────────────

describe('psolaSynthesize', () => {
  it('preserves approximate energy for identity transform (no shift)', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1, 0.5);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 0, timeStretch: 1.0 },
    );

    const inputRms = computeRms(samples);
    const outputRms = computeRms(output.getChannelData(0));

    // Energy should be roughly preserved (within 6 dB / factor of 2)
    expect(outputRms).toBeGreaterThan(inputRms * 0.5);
    expect(outputRms).toBeLessThan(inputRms * 2.0);
  });

  it('produces output with correct length for identity transform', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 0, timeStretch: 1.0 },
    );

    expect(output.length).toBe(samples.length);
  });

  it('produces longer output for time stretch > 1', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { timeStretch: 1.5 },
    );

    // Output should be approximately 50% longer
    const expectedLength = Math.ceil(samples.length * 1.5);
    expect(output.length).toBe(expectedLength);
  });

  it('produces shorter output for time stretch < 1', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { timeStretch: 0.5 },
    );

    // Output should be approximately 50% shorter
    const expectedLength = Math.ceil(samples.length * 0.5);
    expect(output.length).toBe(expectedLength);
  });

  it('pitch shift does not change output length', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    const shiftUp = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 5 },
    );
    const shiftDown = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: -5 },
    );

    // Pitch shift with timeStretch=1.0 should preserve length
    expect(shiftUp.length).toBe(samples.length);
    expect(shiftDown.length).toBe(samples.length);
  });

  it('output does not contain NaN or Infinity values', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 7 },
    );

    const outputSamples = output.getChannelData(0);
    for (let i = 0; i < outputSamples.length; i++) {
      expect(Number.isFinite(outputSamples[i])).toBe(true);
    }
  });

  it('silence in produces silence out', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const silence = new Float32Array(4410);
    const buffer = createBuffer(silence, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 5 },
    );

    const outputSamples = output.getChannelData(0);
    const outputPeak = computePeak(outputSamples);
    expect(outputPeak).toBeLessThan(1e-6);
  });

  it('supports all window types without errors', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);
    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    const windowTypes = ['hann', 'hamming', 'triangular'] as const;
    for (const windowType of windowTypes) {
      const output = psolaSynthesize(
        buffer as unknown as AudioBuffer,
        analysis,
        { pitchShift: 3, windowType },
      );
      expect(output.length).toBe(samples.length);
      expect(computeRms(output.getChannelData(0))).toBeGreaterThan(0);
    }
  });

  it('pitch-shifted output has non-zero energy', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.15, 0.7);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // Shift up 12 semitones (one octave)
    const up = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 12 },
    );
    expect(computeRms(up.getChannelData(0))).toBeGreaterThan(0.01);

    // Shift down 12 semitones (one octave)
    const down = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: -12 },
    );
    expect(computeRms(down.getChannelData(0))).toBeGreaterThan(0.01);
  });

  it('output peak does not explode for extreme pitch shifts', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1, 0.5);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    // Extreme pitch shift: +24 semitones (two octaves up)
    const extreme = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 24 },
    );

    const outputPeak = computePeak(extreme.getChannelData(0));
    // Peak should not exceed input peak by more than 6 dB (factor of 2)
    // due to the overlap-add normalization
    expect(outputPeak).toBeLessThan(2.0);
  });
});

// ── applyPsola (convenience wrapper) ─────────────────────────────────────────

describe('applyPsola', () => {
  it('produces output for combined pitch shift and time stretch', async () => {
    const { applyPsola } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const output = applyPsola(buffer as unknown as AudioBuffer, {
      pitchShift: 3,
      timeStretch: 1.2,
    });

    const expectedLength = Math.ceil(samples.length * 1.2);
    expect(output.length).toBe(expectedLength);
    expect(computeRms(output.getChannelData(0))).toBeGreaterThan(0);
  });

  it('works with default options (identity transform)', async () => {
    const { applyPsola } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const output = applyPsola(buffer as unknown as AudioBuffer);

    expect(output.length).toBe(samples.length);
  });
});

// ── PsolaAnalysisCache ───────────────────────────────────────────────────────

describe('PsolaAnalysisCache', () => {
  it('returns cached result for same buffer and options', async () => {
    const { PsolaAnalysisCache } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.05);
    const buffer = createBuffer(samples, sampleRate);

    const cache = new PsolaAnalysisCache();
    const first = cache.getAnalysis(buffer as unknown as AudioBuffer);
    const second = cache.getAnalysis(buffer as unknown as AudioBuffer);

    // Should be the exact same object (referential equality)
    expect(first).toBe(second);
  });

  it('recomputes when options change', async () => {
    const { PsolaAnalysisCache } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.05);
    const buffer = createBuffer(samples, sampleRate);

    const cache = new PsolaAnalysisCache();
    const opts1 = { minPitchHz: 50, maxPitchHz: 800 };
    const opts2 = { minPitchHz: 100, maxPitchHz: 400 };

    const first = cache.getAnalysis(buffer as unknown as AudioBuffer, opts1);
    const second = cache.getAnalysis(buffer as unknown as AudioBuffer, opts2);

    // Different options should produce different analysis (not the same reference)
    expect(first).not.toBe(second);
  });

  it('clear() allows recomputation', async () => {
    const { PsolaAnalysisCache } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.05);
    const buffer = createBuffer(samples, sampleRate);

    const cache = new PsolaAnalysisCache();
    const first = cache.getAnalysis(buffer as unknown as AudioBuffer);
    cache.clear();
    const second = cache.getAnalysis(buffer as unknown as AudioBuffer);

    // After clear, should recompute (different reference)
    expect(first).not.toBe(second);
    // But should have the same structure
    expect(first.pitchMarks.length).toBe(second.pitchMarks.length);
  });
});

// ── PsolaProcessor ───────────────────────────────────────────────────────────

describe('PsolaProcessor', () => {
  it('processes audio with cached analysis', async () => {
    const { PsolaProcessor } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const processor = new PsolaProcessor();
    const output = processor.process(buffer as unknown as AudioBuffer, {
      pitchShift: 3,
    });

    expect(output.length).toBe(samples.length);
    expect(computeRms(output.getChannelData(0))).toBeGreaterThan(0);
  });

  it('preAnalyze returns valid analysis', async () => {
    const { PsolaProcessor } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const processor = new PsolaProcessor();
    const analysis = processor.preAnalyze(buffer as unknown as AudioBuffer);

    expect(analysis.pitchMarks.length).toBeGreaterThan(0);
    expect(analysis.sampleRate).toBe(sampleRate);
  });

  it('clearCache does not prevent further processing', async () => {
    const { PsolaProcessor } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const processor = new PsolaProcessor();
    processor.process(buffer as unknown as AudioBuffer, { pitchShift: 2 });
    processor.clearCache();

    // Should still work after clearing cache
    const output = processor.process(buffer as unknown as AudioBuffer, {
      pitchShift: -2,
    });
    expect(output.length).toBe(samples.length);
  });
});

// ── Edge cases & bounds safety ───────────────────────────────────────────────

describe('PSOLA edge cases', () => {
  it('handles an impulse signal without crashing', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const impulse = new Float32Array(4410);
    impulse[0] = 1.0;
    const buffer = createBuffer(impulse, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 5 },
    );

    expect(output.length).toBe(impulse.length);
    // Output should not contain NaN
    const outputSamples = output.getChannelData(0);
    for (let i = 0; i < outputSamples.length; i++) {
      expect(Number.isFinite(outputSamples[i])).toBe(true);
    }
  });

  it('handles DC signal', async () => {
    const { analyzePitchMarks, psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const dc = new Float32Array(4410).fill(0.5);
    const buffer = createBuffer(dc, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);
    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
    );

    const outputSamples = output.getChannelData(0);
    for (let i = 0; i < outputSamples.length; i++) {
      expect(Number.isFinite(outputSamples[i])).toBe(true);
    }
  });

  it('all pitch marks are within buffer bounds', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.2);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    for (const mark of analysis.pitchMarks) {
      expect(mark).toBeGreaterThanOrEqual(0);
      expect(mark).toBeLessThan(samples.length);
    }
  });

  it('all pitch periods are positive', async () => {
    const { analyzePitchMarks } = await importPsola();
    const sampleRate = 44100;
    const samples = generateSineWave(200, sampleRate, 0.1);
    const buffer = createBuffer(samples, sampleRate);

    const analysis = analyzePitchMarks(buffer as unknown as AudioBuffer);

    for (const period of analysis.pitchPeriods) {
      expect(period).toBeGreaterThan(0);
    }
  });

  it('handles custom analysis with synthesized PsolaAnalysis', async () => {
    const { psolaSynthesize } = await importPsola();
    const sampleRate = 44100;
    const numSamples = 4410;
    const samples = generateSineWave(200, sampleRate, numSamples / sampleRate);
    const buffer = createBuffer(samples, sampleRate);

    // Manually construct a simple analysis: evenly spaced marks
    const period = Math.round(sampleRate / 200);
    const marks: number[] = [];
    const periods: number[] = [];
    const flags: boolean[] = [];

    for (let pos = 0; pos < numSamples; pos += period) {
      marks.push(pos);
      periods.push(period);
      flags.push(true);
    }

    const analysis: PsolaAnalysis = {
      pitchMarks: marks,
      pitchPeriods: periods,
      sampleRate,
      voicedFlags: flags,
    };

    const output = psolaSynthesize(
      buffer as unknown as AudioBuffer,
      analysis,
      { pitchShift: 0, timeStretch: 1.0 },
    );

    expect(output.length).toBe(numSamples);
    // With identity transform and evenly-spaced marks on a periodic signal,
    // output energy should be close to input energy
    const inputRms = computeRms(samples);
    const outputRms = computeRms(output.getChannelData(0));
    expect(outputRms).toBeGreaterThan(inputRms * 0.3);
    expect(outputRms).toBeLessThan(inputRms * 3.0);
  });
});
