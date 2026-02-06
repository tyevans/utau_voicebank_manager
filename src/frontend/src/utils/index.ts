/**
 * Utility functions for the UTAU Voicebank Manager frontend.
 */

// Kana to romaji conversion
export {
  kanaToRomaji,
  containsKana,
  HIRAGANA_TO_ROMAJI,
  KATAKANA_TO_ROMAJI,
  KANA_COMBINATIONS,
} from './kana-romaji.js';

// Phoneme classification
export {
  PHONEME_FAMILIES,
  FAMILY_MAP,
  classifyPhoneme,
  groupSamplesByFamily,
  getNonEmptyGroups,
} from './phoneme-groups.js';
export type { PhonemeFamily } from './phoneme-groups.js';

// Pitch detection for adaptive grain sizing and pitch matching
export {
  detectPitchPeriod,
  detectPitch,
  detectRepresentativePitch,
  calculateOptimalGrainSize,
  calculatePitchCorrection,
  C4_FREQUENCY,
} from './pitch-detection.js';
export type {
  PitchDetectionOptions,
  PitchDetectionResult,
} from './pitch-detection.js';

// Spectral analysis for dynamic overlap calculation
export {
  calculateSpectralDistance,
  calculateDynamicOverlap,
  SpectralDistanceCache,
} from './spectral-analysis.js';
export type {
  SpectralDistanceOptions,
  SpectralDistanceResult,
} from './spectral-analysis.js';

// Loudness analysis for sample normalization
export {
  analyzeLoudness,
  calculateNormalizationGain,
  calculateJoinGainCorrection,
  computeNormalizationGains,
  linearToDb,
  dbToLinear,
  LoudnessAnalysisCache,
  DEFAULT_TARGET_RMS_DB,
} from './loudness-analysis.js';
export type {
  LoudnessAnalysis,
  JoinGainCorrection,
  LoudnessAnalysisOptions,
  NormalizationOptions,
  JoinCorrectionOptions,
} from './loudness-analysis.js';

// PSOLA (Pitch-Synchronous Overlap-Add) for high-quality pitch shifting
export {
  analyzePitchMarks,
  psolaSynthesize,
  applyPsola,
  PsolaAnalysisCache,
  PsolaProcessor,
} from './psola.js';
export type {
  PsolaOptions,
  PsolaAnalysis,
  PitchMarkOptions,
} from './psola.js';

// Cepstral envelope for formant preservation
export {
  applyFormantPreservation,
} from './cepstral-envelope.js';
export type {
  CepstralOptions,
} from './cepstral-envelope.js';

// Formant frequency tracking for spectral visualization
export {
  analyzeFormants,
} from './formant-tracker.js';
export type {
  FormantFrame,
  FormantAnalysis,
  FormantTrackingOptions,
} from './formant-tracker.js';

// Spectral smoothing at concatenation joins
export {
  applySpectralSmoothing,
} from './spectral-smoothing.js';
export type {
  SpectralSmoothingOptions,
} from './spectral-smoothing.js';

// Alias matching for voicebank phoneme lookup
export {
  CV_PREFIX,
  VOWELS,
  parseVCVAlias,
  findOtoEntry,
  findMatchingAlias,
  hasMatchingAlias,
} from './alias-matching.js';

// Fetch with retry (exponential backoff)
export { fetchWithRetry } from './fetch-retry.js';
export type { RetryOptions } from './fetch-retry.js';
