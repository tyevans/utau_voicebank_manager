/**
 * TypeScript type definitions for the UTAU Voicebank Manager API.
 *
 * These types mirror the Pydantic models from the backend to ensure
 * type-safe communication between frontend and backend.
 */

/**
 * Lightweight voicebank summary for list views.
 */
export interface VoicebankSummary {
  /** Slugified unique identifier */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Number of WAV sample files */
  sample_count: number;
  /** Whether oto.ini configuration exists */
  has_oto: boolean;
}

/**
 * Full voicebank details including path and creation time.
 */
export interface Voicebank extends VoicebankSummary {
  /** Absolute path to voicebank folder */
  path: string;
  /** ISO 8601 timestamp when the voicebank was created */
  created_at: string;
}

/**
 * Oto.ini entry defining phoneme timing parameters.
 *
 * Each entry maps a WAV file and alias to timing parameters that control
 * how the audio is played during synthesis.
 */
export interface OtoEntry {
  /** WAV filename (e.g., "_ka.wav") */
  filename: string;
  /** Phoneme alias (e.g., "- ka" for CV, "a ka" for VCV) */
  alias: string;
  /** Playback start position in milliseconds */
  offset: number;
  /** Fixed region end in milliseconds (not stretched during synthesis) */
  consonant: number;
  /** Playback end position in ms (negative = from audio end) */
  cutoff: number;
  /** How early to start before the note begins (ms) */
  preutterance: number;
  /** Crossfade duration with previous note (ms) */
  overlap: number;
}

/**
 * Request payload for creating a new oto entry.
 * All timing parameters are optional and default to 0.
 */
export interface OtoEntryCreate {
  /** WAV filename (e.g., "_ka.wav") */
  filename: string;
  /** Phoneme alias (e.g., "- ka" for CV, "a ka" for VCV) */
  alias: string;
  /** Playback start position in milliseconds */
  offset?: number;
  /** Fixed region end in milliseconds */
  consonant?: number;
  /** Playback end position in ms (negative = from audio end) */
  cutoff?: number;
  /** How early to start before the note begins (ms) */
  preutterance?: number;
  /** Crossfade duration with previous note (ms) */
  overlap?: number;
}

/**
 * Request payload for updating an existing oto entry.
 * Only provided fields will be updated.
 */
export interface OtoEntryUpdate {
  /** Playback start position in milliseconds */
  offset?: number;
  /** Fixed region end in milliseconds */
  consonant?: number;
  /** Playback end position in ms (negative = from audio end) */
  cutoff?: number;
  /** How early to start before the note begins (ms) */
  preutterance?: number;
  /** Crossfade duration with previous note (ms) */
  overlap?: number;
}

/**
 * A detected phoneme segment with timing and confidence.
 */
export interface PhonemeSegment {
  /** Phoneme symbol (IPA or ARPABET format) */
  phoneme: string;
  /** Start time of the phoneme in milliseconds */
  start_ms: number;
  /** End time of the phoneme in milliseconds */
  end_ms: number;
  /** Detection confidence score between 0 and 1 */
  confidence: number;
}

/**
 * ML service status information.
 */
export interface MlStatus {
  /** Service availability status */
  status: string;
  /** Computation device being used (cpu or cuda) */
  device: string;
  /** Whether CUDA/GPU acceleration is available */
  cuda_available: boolean;
  /** Name of the ML model being used */
  model?: string;
}
