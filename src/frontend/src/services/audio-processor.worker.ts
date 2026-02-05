/// <reference lib="webworker" />

/**
 * Audio Processor Web Worker - Off-main-thread PSOLA processing.
 *
 * Receives raw audio channel data from the main thread, runs PSOLA
 * pitch-synchronous overlap-add synthesis, and transfers the processed
 * result back. Uses Float32Array transfer for zero-copy messaging.
 *
 * The worker maintains an internal analysis cache keyed by a fingerprint
 * of the input data, so repeated pitch-shift requests for the same source
 * audio skip the expensive analysis step.
 *
 * Message Protocol:
 * - Main -> Worker: ProcessRequest { type: 'process', id, channelData, sampleRate, pitchShift, timeStretch }
 * - Worker -> Main: ProcessResponse { type: 'result', id, channelData, sampleRate }
 * - Worker -> Main: ProcessError { type: 'error', id, message }
 */

declare const self: DedicatedWorkerGlobalScope;

import {
  analyzePitchMarks,
  psolaSynthesize,
  type PsolaAnalysis,
} from '../utils/psola.js';
import { applyFormantPreservation } from '../utils/cepstral-envelope.js';

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

interface ProcessRequest {
  type: 'process';
  id: string;
  channelData: Float32Array;
  sampleRate: number;
  pitchShift: number;
  timeStretch: number;
  /** Whether to apply formant preservation after PSOLA (default: false) */
  preserveFormants: boolean;
  /** Formant scaling factor (0.0 = full preservation, 1.0 = no correction, default: 0.0) */
  formantScale: number;
}

interface ProcessResponse {
  type: 'result';
  id: string;
  channelData: Float32Array;
  sampleRate: number;
}

interface ProcessError {
  type: 'error';
  id: string;
  message: string;
}

type WorkerMessage = ProcessRequest;
type WorkerResponse = ProcessResponse | ProcessError;

// ---------------------------------------------------------------------------
// Internal analysis cache
// ---------------------------------------------------------------------------

/**
 * Fingerprint an audio buffer for cache lookup.
 *
 * Uses the first 128 samples, length, and sample rate to create a
 * fast-to-compute key. This is not a cryptographic hash -- collisions
 * are theoretically possible but extremely unlikely for real audio data.
 */
function fingerprint(channelData: Float32Array, sampleRate: number): string {
  const sampleCount = Math.min(128, channelData.length);
  let hash = channelData.length ^ (sampleRate * 31);
  for (let i = 0; i < sampleCount; i++) {
    // Convert float to an integer-like value for hashing
    const bits = Math.round(channelData[i] * 1e6);
    hash = ((hash << 5) - hash + bits) | 0;
  }
  return `${hash}_${channelData.length}_${sampleRate}`;
}

/** LRU-ish analysis cache. Map preserves insertion order. */
const analysisCache = new Map<string, PsolaAnalysis>();
const ANALYSIS_CACHE_MAX = 50;

function getCachedAnalysis(
  channelData: Float32Array,
  sampleRate: number,
): PsolaAnalysis {
  const key = fingerprint(channelData, sampleRate);

  const cached = analysisCache.get(key);
  if (cached) {
    // Move to end (LRU refresh)
    analysisCache.delete(key);
    analysisCache.set(key, cached);
    return cached;
  }

  // Create a temporary AudioBuffer for the PSOLA analysis function.
  // OfflineAudioContext and AudioBuffer are available in Web Worker scope
  // per the Web Audio API specification.
  // Ensure data is backed by a plain ArrayBuffer for copyToChannel compatibility.
  const analysisData = new Float32Array(new ArrayBuffer(channelData.length * 4));
  analysisData.set(channelData);
  const offlineCtx = new OfflineAudioContext(1, channelData.length, sampleRate);
  const audioBuffer = offlineCtx.createBuffer(1, channelData.length, sampleRate);
  audioBuffer.copyToChannel(analysisData, 0);

  const analysis = analyzePitchMarks(audioBuffer);

  // Evict oldest if over capacity
  if (analysisCache.size >= ANALYSIS_CACHE_MAX) {
    const oldest = analysisCache.keys().next().value;
    if (oldest !== undefined) {
      analysisCache.delete(oldest);
    }
  }
  analysisCache.set(key, analysis);

  return analysis;
}

// ---------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------

function processAudio(request: ProcessRequest): WorkerResponse {
  const { id, channelData, sampleRate, pitchShift, timeStretch, preserveFormants, formantScale } = request;

  // Fast path: no modification needed
  if (pitchShift === 0 && timeStretch === 1.0) {
    return {
      type: 'result',
      id,
      channelData, // Return as-is (will be transferred back)
      sampleRate,
    };
  }

  // Analyze pitch marks (cached)
  const analysis = getCachedAnalysis(channelData, sampleRate);

  // Create AudioBuffer for synthesis (psolaSynthesize requires AudioBuffer)
  // Ensure data is backed by a plain ArrayBuffer for copyToChannel compatibility.
  const synthData = new Float32Array(new ArrayBuffer(channelData.length * 4));
  synthData.set(channelData);
  const synthCtx = new OfflineAudioContext(1, channelData.length, sampleRate);
  const inputBuffer = synthCtx.createBuffer(1, channelData.length, sampleRate);
  inputBuffer.copyToChannel(synthData, 0);

  // Synthesize with PSOLA
  const outputBuffer = psolaSynthesize(inputBuffer, analysis, {
    pitchShift,
    timeStretch,
  });

  // Extract output channel data into a plain ArrayBuffer-backed Float32Array
  let outputData = new Float32Array(new ArrayBuffer(outputBuffer.length * 4));
  outputBuffer.copyFromChannel(outputData, 0);

  // Apply formant preservation if requested and pitch was actually shifted
  if (preserveFormants && pitchShift !== 0) {
    const corrected = applyFormantPreservation(
      channelData,  // original (unshifted)
      outputData,    // PSOLA-shifted
      sampleRate,
      pitchShift,
      { formantScale },
    );
    // Ensure result is backed by a plain ArrayBuffer for zero-copy transfer.
    const correctedData = new Float32Array(new ArrayBuffer(corrected.length * 4));
    correctedData.set(corrected);
    outputData = correctedData;
  }

  return {
    type: 'result',
    id,
    channelData: outputData,
    sampleRate: outputBuffer.sampleRate,
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const request = event.data;

  if (request.type !== 'process') {
    const errorResponse: ProcessError = {
      type: 'error',
      id: (request as ProcessRequest).id ?? 'unknown',
      message: `Unknown message type: ${(request as ProcessRequest).type}`,
    };
    self.postMessage(errorResponse);
    return;
  }

  try {
    const response = processAudio(request);

    if (response.type === 'result') {
      // Transfer the channelData buffer for zero-copy messaging
      self.postMessage(response, [response.channelData.buffer]);
    } else {
      self.postMessage(response);
    }
  } catch (err) {
    const errorResponse: ProcessError = {
      type: 'error',
      id: request.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorResponse);
  }
};
