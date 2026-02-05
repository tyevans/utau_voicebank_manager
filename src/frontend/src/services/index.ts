/**
 * API client services for the UTAU Voicebank Manager.
 *
 * This module exports API clients for communicating with the backend.
 * Services handle HTTP requests, error handling, and response parsing.
 */

// Shared AudioContext singleton
export { getSharedAudioContext } from './audio-context.js';

// API client
export { api, ApiClient, ApiError } from './api.js';

// Audio synthesis
export { MelodyPlayer, DEFAULT_ENVELOPE } from './melody-player.js';
export type {
  ADSREnvelope,
  CrossfadeType,
  NoteEvent,
  PhraseNote,
  SampleData,
  SpectralDistanceOptions,
  SpectralDistanceResult,
  SynthesisOptions,
  VibratoParams,
} from './melody-player.js';

// Sample preloading
export { SampleLoader, loadSamplesForPhrase } from './sample-loader.js';
export type { LoadSamplesResult } from './sample-loader.js';

// Melody patterns for preview
export { MELODY_PATTERNS, getMelodyPattern } from './melody-patterns.js';
export type { MelodyPattern } from './melody-patterns.js';

// Recording session API client
export {
  recordingApi,
  RecordingApiService,
} from './recording-api.js';

// Recording API types
export type {
  GeneratedVoicebank,
  RecordingSegment,
  RecordingSession,
  SessionConfig,
  SessionProgress,
  SessionStatus,
} from './recording-api.js';

// Type definitions
export type {
  MlStatus,
  OtoEntry,
  OtoEntryCreate,
  OtoEntryUpdate,
  OtoSuggestion,
  PhonemeSegment,
  Voicebank,
  VoicebankSummary,
} from './types.js';
