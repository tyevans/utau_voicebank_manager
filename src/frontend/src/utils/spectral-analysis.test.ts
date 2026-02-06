import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── AudioBuffer mock ─────────────────────────────────────────────────────────
//
// calculateSpectralDistance and calculateDynamicOverlap require AudioBuffer
// objects. The test environment is 'node', so we provide a minimal mock.

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

beforeEach(() => {
  vi.stubGlobal('AudioBuffer', MockAudioBuffer);
});

async function importModule() {
  return await import('./spectral-analysis.js');
}

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Create a mock AudioBuffer from mono samples.
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
  durationMs: number,
  amplitude = 0.8,
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    samples[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate);
  }
  return samples;
}

/**
 * Generate white noise.
 */
function generateWhiteNoise(
  sampleRate: number,
  durationMs: number,
  amplitude = 0.5,
): Float32Array {
  const numSamples = Math.floor((durationMs / 1000) * sampleRate);
  const samples = new Float32Array(numSamples);
  // Deterministic pseudo-random for reproducible tests
  let seed = 42;
  for (let i = 0; i < numSamples; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = amplitude * ((seed / 0x7fffffff) * 2 - 1);
  }
  return samples;
}

// ── calculateSpectralDistance ─────────────────────────────────────────────────

describe('calculateSpectralDistance', () => {
  it('returns zero distance for identical buffers', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;
    const samples = generateSineWave(440, sampleRate, 100);
    const bufA = createBuffer(samples, sampleRate);
    const bufB = createBuffer(samples, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );

    expect(result.distance).toBeCloseTo(0, 1);
    expect(result.spectralCentroidDiff).toBeCloseTo(0, 2);
    expect(result.energyDiff).toBeCloseTo(0, 2);
    expect(result.magnitudeDistance).toBeCloseTo(0, 1);
  });

  it('returns higher distance for spectrally different signals', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;

    // Low frequency sine vs high frequency sine
    const lowFreq = generateSineWave(100, sampleRate, 100);
    const highFreq = generateSineWave(4000, sampleRate, 100);

    const bufLow = createBuffer(lowFreq, sampleRate);
    const bufHigh = createBuffer(highFreq, sampleRate);

    const result = calculateSpectralDistance(
      bufLow as unknown as AudioBuffer,
      bufHigh as unknown as AudioBuffer,
    );

    // Should have a meaningful non-zero distance
    expect(result.distance).toBeGreaterThan(0.1);
    // Spectral centroid should differ significantly
    expect(result.spectralCentroidDiff).toBeGreaterThan(0.1);
  });

  it('returns distance between 0 and 1', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;

    const sine = generateSineWave(440, sampleRate, 100);
    const noise = generateWhiteNoise(sampleRate, 100);
    const bufA = createBuffer(sine, sampleRate);
    const bufB = createBuffer(noise, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );

    expect(result.distance).toBeGreaterThanOrEqual(0);
    expect(result.distance).toBeLessThanOrEqual(1);
  });

  it('recommendedOverlapMs is at least baseOverlapMs', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;
    const samples = generateSineWave(440, sampleRate, 100);
    const bufA = createBuffer(samples, sampleRate);
    const bufB = createBuffer(samples, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      { baseOverlapMs: 50 },
    );

    expect(result.recommendedOverlapMs).toBeGreaterThanOrEqual(50);
  });

  it('recommendedOverlapMs does not exceed base + maxAdditional', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;

    // Maximally different: sine vs silence
    const sine = generateSineWave(440, sampleRate, 100, 0.9);
    const silence = new Float32Array(Math.floor((100 / 1000) * sampleRate));

    const bufA = createBuffer(sine, sampleRate);
    const bufB = createBuffer(silence, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      { baseOverlapMs: 30, maxAdditionalOverlapMs: 70 },
    );

    expect(result.recommendedOverlapMs).toBeLessThanOrEqual(100);
  });

  it('returns base overlap when both buffers are empty', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;
    // Create buffers with length 0 is not possible, use very short buffers
    const empty = new Float32Array(1);
    const bufA = createBuffer(empty, sampleRate);
    const bufB = createBuffer(empty, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      { baseOverlapMs: 25 },
    );

    // Very short buffers will either return 0 distance or handle gracefully
    expect(result.recommendedOverlapMs).toBeGreaterThanOrEqual(25);
  });

  it('similar frequencies produce lower distance than dissimilar', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;

    const freq440 = generateSineWave(440, sampleRate, 100);
    const freq450 = generateSineWave(450, sampleRate, 100); // very close
    const freq4000 = generateSineWave(4000, sampleRate, 100); // very far

    const buf440 = createBuffer(freq440, sampleRate);
    const buf450 = createBuffer(freq450, sampleRate);
    const buf4000 = createBuffer(freq4000, sampleRate);

    const closeDist = calculateSpectralDistance(
      buf440 as unknown as AudioBuffer,
      buf450 as unknown as AudioBuffer,
    );
    const farDist = calculateSpectralDistance(
      buf440 as unknown as AudioBuffer,
      buf4000 as unknown as AudioBuffer,
    );

    expect(closeDist.distance).toBeLessThan(farDist.distance);
  });

  it('energy difference is zero for equal-amplitude signals', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;
    const amp = 0.5;

    const sineA = generateSineWave(200, sampleRate, 100, amp);
    const sineB = generateSineWave(800, sampleRate, 100, amp);

    const bufA = createBuffer(sineA, sampleRate);
    const bufB = createBuffer(sineB, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );

    // Equal amplitude should produce near-zero energy difference
    expect(result.energyDiff).toBeLessThan(0.1);
  });

  it('respects custom weight options', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;

    const sineA = generateSineWave(200, sampleRate, 100);
    const sineB = generateSineWave(2000, sampleRate, 100);

    const bufA = createBuffer(sineA, sampleRate);
    const bufB = createBuffer(sineB, sampleRate);

    // Centroid-only distance
    const centroidOnly = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      { centroidWeight: 1.0, magnitudeWeight: 0, energyWeight: 0 },
    );

    // Magnitude-only distance
    const magnitudeOnly = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      { centroidWeight: 0, magnitudeWeight: 1.0, energyWeight: 0 },
    );

    // They should differ since they measure different aspects
    // Both should be positive for these different signals
    expect(centroidOnly.distance).toBeGreaterThan(0);
    expect(magnitudeOnly.distance).toBeGreaterThan(0);
  });

  it('all result fields are finite numbers', async () => {
    const { calculateSpectralDistance } = await importModule();
    const sampleRate = 44100;
    const samples = generateSineWave(440, sampleRate, 100);
    const bufA = createBuffer(samples, sampleRate);
    const bufB = createBuffer(samples, sampleRate);

    const result = calculateSpectralDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );

    expect(Number.isFinite(result.distance)).toBe(true);
    expect(Number.isFinite(result.recommendedOverlapMs)).toBe(true);
    expect(Number.isFinite(result.spectralCentroidDiff)).toBe(true);
    expect(Number.isFinite(result.energyDiff)).toBe(true);
    expect(Number.isFinite(result.magnitudeDistance)).toBe(true);
  });
});

// ── calculateDynamicOverlap ──────────────────────────────────────────────────

describe('calculateDynamicOverlap', () => {
  it('returns at least the oto overlap for identical signals', async () => {
    const { calculateDynamicOverlap } = await importModule();
    const sampleRate = 44100;
    const samples = generateSineWave(440, sampleRate, 100);
    const bufA = createBuffer(samples, sampleRate);
    const bufB = createBuffer(samples, sampleRate);

    const overlap = calculateDynamicOverlap(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      30,
    );

    expect(overlap).toBeGreaterThanOrEqual(30);
  });

  it('returns at most oto overlap * maxScaleFactor', async () => {
    const { calculateDynamicOverlap } = await importModule();
    const sampleRate = 44100;

    const sine = generateSineWave(100, sampleRate, 100, 0.9);
    const noise = generateWhiteNoise(sampleRate, 100, 0.9);

    const bufA = createBuffer(sine, sampleRate);
    const bufB = createBuffer(noise, sampleRate);

    const overlap = calculateDynamicOverlap(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
      30,
      { maxScaleFactor: 2.0 },
    );

    expect(overlap).toBeLessThanOrEqual(60);
  });

  it('scales overlap based on spectral distance', async () => {
    const { calculateDynamicOverlap } = await importModule();
    const sampleRate = 44100;

    const freq440 = generateSineWave(440, sampleRate, 100);
    const freq440Close = generateSineWave(450, sampleRate, 100); // similar
    const freq4000 = generateSineWave(4000, sampleRate, 100); // different

    const buf440 = createBuffer(freq440, sampleRate);
    const bufClose = createBuffer(freq440Close, sampleRate);
    const bufFar = createBuffer(freq4000, sampleRate);

    const overlapClose = calculateDynamicOverlap(
      buf440 as unknown as AudioBuffer,
      bufClose as unknown as AudioBuffer,
      30,
    );
    const overlapFar = calculateDynamicOverlap(
      buf440 as unknown as AudioBuffer,
      bufFar as unknown as AudioBuffer,
      30,
    );

    // More different spectra should get larger overlap
    expect(overlapFar).toBeGreaterThanOrEqual(overlapClose);
  });
});

// ── SpectralDistanceCache ────────────────────────────────────────────────────

describe('SpectralDistanceCache', () => {
  it('caches results for the same buffer pair', async () => {
    const { SpectralDistanceCache } = await importModule();
    const sampleRate = 44100;
    const samplesA = generateSineWave(440, sampleRate, 100);
    const samplesB = generateSineWave(880, sampleRate, 100);
    const bufA = createBuffer(samplesA, sampleRate);
    const bufB = createBuffer(samplesB, sampleRate);

    const cache = new SpectralDistanceCache();

    const first = cache.getDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );
    const second = cache.getDistance(
      bufA as unknown as AudioBuffer,
      bufB as unknown as AudioBuffer,
    );

    // Should be the exact same object
    expect(first).toBe(second);
    expect(cache.size).toBe(1);
  });

  it('stores separate entries for different buffer pairs', async () => {
    const { SpectralDistanceCache } = await importModule();
    const sampleRate = 44100;
    const samplesA = generateSineWave(440, sampleRate, 100);
    const samplesB = generateSineWave(880, sampleRate, 100);
    const samplesC = generateSineWave(1200, sampleRate, 100);

    const bufA = createBuffer(samplesA, sampleRate);
    const bufB = createBuffer(samplesB, sampleRate);
    const bufC = createBuffer(samplesC, sampleRate);

    const cache = new SpectralDistanceCache();
    cache.getDistance(bufA as unknown as AudioBuffer, bufB as unknown as AudioBuffer);
    cache.getDistance(bufA as unknown as AudioBuffer, bufC as unknown as AudioBuffer);

    expect(cache.size).toBe(2);
  });

  it('clear() empties the cache', async () => {
    const { SpectralDistanceCache } = await importModule();
    const sampleRate = 44100;
    const samples = generateSineWave(440, sampleRate, 100);
    const bufA = createBuffer(samples, sampleRate);
    const bufB = createBuffer(samples, sampleRate);

    const cache = new SpectralDistanceCache();
    cache.getDistance(bufA as unknown as AudioBuffer, bufB as unknown as AudioBuffer);
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('evicts oldest entry when max size is reached', async () => {
    const { SpectralDistanceCache } = await importModule();
    const sampleRate = 44100;
    const cache = new SpectralDistanceCache(undefined, 2); // max 2 entries

    const bufs: MockAudioBuffer[] = [];
    for (let i = 0; i < 4; i++) {
      bufs.push(createBuffer(generateSineWave(200 + i * 100, sampleRate, 100), sampleRate));
    }

    cache.getDistance(bufs[0] as unknown as AudioBuffer, bufs[1] as unknown as AudioBuffer);
    cache.getDistance(bufs[1] as unknown as AudioBuffer, bufs[2] as unknown as AudioBuffer);
    cache.getDistance(bufs[2] as unknown as AudioBuffer, bufs[3] as unknown as AudioBuffer);

    // Should not exceed max size
    expect(cache.size).toBeLessThanOrEqual(2);
  });
});
