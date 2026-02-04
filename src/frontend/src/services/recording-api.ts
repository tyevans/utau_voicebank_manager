/**
 * API client for recording session management.
 *
 * Provides type-safe methods for creating and managing recording sessions,
 * uploading audio segments, and generating voicebanks.
 */

import type { PhonemePrompt } from '../components/uvm-recording-prompter.js';
import { ApiError, getDefaultApiUrl } from './api.js';

/**
 * Recording session status.
 */
export type SessionStatus =
  | 'pending'
  | 'recording'
  | 'processing'
  | 'completed'
  | 'cancelled';

/**
 * A recorded audio segment within a session.
 */
export interface RecordingSegment {
  id: string;
  prompt_index: number;
  prompt_text: string;
  audio_filename: string;
  duration_ms: number;
  recorded_at: string;
  is_accepted: boolean;
  rejection_reason: string | null;
}

/**
 * Full recording session with all details.
 */
export interface RecordingSession {
  id: string;
  voicebank_id: string;
  recording_style: string;
  language: string;
  status: SessionStatus;
  prompts: string[];
  segments: RecordingSegment[];
  current_prompt_index: number;
  created_at: string;
  updated_at: string;
}

/**
 * Session progress information.
 */
export interface SessionProgress {
  session_id: string;
  status: SessionStatus;
  total_prompts: number;
  completed_segments: number;
  rejected_segments: number;
  progress_percent: number;
  current_prompt_index: number;
  current_prompt_text: string | null;
}

/**
 * Options for including optional extra sound packs in the recording list.
 * These extend the base prompts with additional phonemes for loanwords,
 * alternative pronunciations, and expressive sounds.
 */
export interface ReclistOptions {
  /** Include alternative consonants for loanwords (ti, si, fa, fi, etc.) */
  extraConsonants?: boolean;
  /** Include L-sounds distinct from Japanese R-sounds (la, li, lu, le, lo) */
  lSounds?: boolean;
  /** Include breath sounds (inhale, exhale, aspiration) */
  breathSounds?: boolean;
}

/**
 * Configuration for creating a new recording session.
 */
export interface SessionConfig {
  voicebankName: string;
  style: 'cv' | 'vcv' | 'cvvc' | 'vccv' | 'arpasing';
  language: string;
  reclistOptions?: ReclistOptions;
}

/**
 * Generated voicebank result.
 */
export interface GeneratedVoicebank {
  name: string;
  path: string;
  sample_count: number;
  oto_entries: number;
  recording_style: string;
  language: string;
  generation_time_seconds: number;
  warnings: string[];
  skipped_segments: number;
  average_confidence: number;
}

/**
 * Job status from the backend queue.
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

/**
 * Job progress information.
 */
export interface JobProgress {
  percent: number;
  message: string;
  updated_at: string;
}

/**
 * Job result (success or failure).
 */
export interface JobResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/**
 * Async job tracked by the backend queue.
 */
export interface Job {
  id: string;
  type: string;
  status: JobStatus;
  params: Record<string, unknown>;
  progress: JobProgress | null;
  result: JobResult | null;
  created_at: string;
  updated_at: string;
}

/**
 * Japanese CV prompts for basic mora recording.
 * These are the fundamental building blocks for Japanese voicebanks.
 */
const JAPANESE_CV_PROMPTS: PhonemePrompt[] = [
  // A row
  { id: 'a', text: 'a', romaji: 'a', phonemes: ['a'], style: 'cv', category: 'vowel', difficulty: 'basic' },
  { id: 'i', text: 'i', romaji: 'i', phonemes: ['i'], style: 'cv', category: 'vowel', difficulty: 'basic' },
  { id: 'u', text: 'u', romaji: 'u', phonemes: ['u'], style: 'cv', category: 'vowel', difficulty: 'basic' },
  { id: 'e', text: 'e', romaji: 'e', phonemes: ['e'], style: 'cv', category: 'vowel', difficulty: 'basic' },
  { id: 'o', text: 'o', romaji: 'o', phonemes: ['o'], style: 'cv', category: 'vowel', difficulty: 'basic' },

  // Ka row
  { id: 'ka', text: 'ka', romaji: 'ka', phonemes: ['k', 'a'], style: 'cv', category: 'k-row', difficulty: 'basic' },
  { id: 'ki', text: 'ki', romaji: 'ki', phonemes: ['k', 'i'], style: 'cv', category: 'k-row', difficulty: 'basic' },
  { id: 'ku', text: 'ku', romaji: 'ku', phonemes: ['k', 'u'], style: 'cv', category: 'k-row', difficulty: 'basic' },
  { id: 'ke', text: 'ke', romaji: 'ke', phonemes: ['k', 'e'], style: 'cv', category: 'k-row', difficulty: 'basic' },
  { id: 'ko', text: 'ko', romaji: 'ko', phonemes: ['k', 'o'], style: 'cv', category: 'k-row', difficulty: 'basic' },

  // Sa row
  { id: 'sa', text: 'sa', romaji: 'sa', phonemes: ['s', 'a'], style: 'cv', category: 's-row', difficulty: 'basic' },
  { id: 'si', text: 'shi', romaji: 'shi', phonemes: ['sh', 'i'], style: 'cv', category: 's-row', difficulty: 'basic' },
  { id: 'su', text: 'su', romaji: 'su', phonemes: ['s', 'u'], style: 'cv', category: 's-row', difficulty: 'basic' },
  { id: 'se', text: 'se', romaji: 'se', phonemes: ['s', 'e'], style: 'cv', category: 's-row', difficulty: 'basic' },
  { id: 'so', text: 'so', romaji: 'so', phonemes: ['s', 'o'], style: 'cv', category: 's-row', difficulty: 'basic' },

  // Ta row
  { id: 'ta', text: 'ta', romaji: 'ta', phonemes: ['t', 'a'], style: 'cv', category: 't-row', difficulty: 'basic' },
  { id: 'ti', text: 'chi', romaji: 'chi', phonemes: ['ch', 'i'], style: 'cv', category: 't-row', difficulty: 'basic' },
  { id: 'tu', text: 'tsu', romaji: 'tsu', phonemes: ['ts', 'u'], style: 'cv', category: 't-row', difficulty: 'basic' },
  { id: 'te', text: 'te', romaji: 'te', phonemes: ['t', 'e'], style: 'cv', category: 't-row', difficulty: 'basic' },
  { id: 'to', text: 'to', romaji: 'to', phonemes: ['t', 'o'], style: 'cv', category: 't-row', difficulty: 'basic' },

  // Na row
  { id: 'na', text: 'na', romaji: 'na', phonemes: ['n', 'a'], style: 'cv', category: 'n-row', difficulty: 'basic' },
  { id: 'ni', text: 'ni', romaji: 'ni', phonemes: ['n', 'i'], style: 'cv', category: 'n-row', difficulty: 'basic' },
  { id: 'nu', text: 'nu', romaji: 'nu', phonemes: ['n', 'u'], style: 'cv', category: 'n-row', difficulty: 'basic' },
  { id: 'ne', text: 'ne', romaji: 'ne', phonemes: ['n', 'e'], style: 'cv', category: 'n-row', difficulty: 'basic' },
  { id: 'no', text: 'no', romaji: 'no', phonemes: ['n', 'o'], style: 'cv', category: 'n-row', difficulty: 'basic' },

  // Ha row
  { id: 'ha', text: 'ha', romaji: 'ha', phonemes: ['h', 'a'], style: 'cv', category: 'h-row', difficulty: 'basic' },
  { id: 'hi', text: 'hi', romaji: 'hi', phonemes: ['h', 'i'], style: 'cv', category: 'h-row', difficulty: 'basic' },
  { id: 'hu', text: 'fu', romaji: 'fu', phonemes: ['f', 'u'], style: 'cv', category: 'h-row', difficulty: 'basic' },
  { id: 'he', text: 'he', romaji: 'he', phonemes: ['h', 'e'], style: 'cv', category: 'h-row', difficulty: 'basic' },
  { id: 'ho', text: 'ho', romaji: 'ho', phonemes: ['h', 'o'], style: 'cv', category: 'h-row', difficulty: 'basic' },

  // Ma row
  { id: 'ma', text: 'ma', romaji: 'ma', phonemes: ['m', 'a'], style: 'cv', category: 'm-row', difficulty: 'basic' },
  { id: 'mi', text: 'mi', romaji: 'mi', phonemes: ['m', 'i'], style: 'cv', category: 'm-row', difficulty: 'basic' },
  { id: 'mu', text: 'mu', romaji: 'mu', phonemes: ['m', 'u'], style: 'cv', category: 'm-row', difficulty: 'basic' },
  { id: 'me', text: 'me', romaji: 'me', phonemes: ['m', 'e'], style: 'cv', category: 'm-row', difficulty: 'basic' },
  { id: 'mo', text: 'mo', romaji: 'mo', phonemes: ['m', 'o'], style: 'cv', category: 'm-row', difficulty: 'basic' },

  // Ya row
  { id: 'ya', text: 'ya', romaji: 'ya', phonemes: ['y', 'a'], style: 'cv', category: 'y-row', difficulty: 'basic' },
  { id: 'yu', text: 'yu', romaji: 'yu', phonemes: ['y', 'u'], style: 'cv', category: 'y-row', difficulty: 'basic' },
  { id: 'yo', text: 'yo', romaji: 'yo', phonemes: ['y', 'o'], style: 'cv', category: 'y-row', difficulty: 'basic' },

  // Ra row
  { id: 'ra', text: 'ra', romaji: 'ra', phonemes: ['r', 'a'], style: 'cv', category: 'r-row', difficulty: 'basic' },
  { id: 'ri', text: 'ri', romaji: 'ri', phonemes: ['r', 'i'], style: 'cv', category: 'r-row', difficulty: 'basic' },
  { id: 'ru', text: 'ru', romaji: 'ru', phonemes: ['r', 'u'], style: 'cv', category: 'r-row', difficulty: 'basic' },
  { id: 're', text: 're', romaji: 're', phonemes: ['r', 'e'], style: 'cv', category: 'r-row', difficulty: 'basic' },
  { id: 'ro', text: 'ro', romaji: 'ro', phonemes: ['r', 'o'], style: 'cv', category: 'r-row', difficulty: 'basic' },

  // Wa row
  { id: 'wa', text: 'wa', romaji: 'wa', phonemes: ['w', 'a'], style: 'cv', category: 'w-row', difficulty: 'basic' },
  { id: 'wo', text: 'wo', romaji: 'wo', phonemes: ['w', 'o'], style: 'cv', category: 'w-row', difficulty: 'basic' },

  // N
  { id: 'nn', text: 'n', romaji: 'n', phonemes: ['n'], style: 'cv', category: 'special', difficulty: 'basic' },

  // Voiced consonants (Ga row)
  { id: 'ga', text: 'ga', romaji: 'ga', phonemes: ['g', 'a'], style: 'cv', category: 'g-row', difficulty: 'basic' },
  { id: 'gi', text: 'gi', romaji: 'gi', phonemes: ['g', 'i'], style: 'cv', category: 'g-row', difficulty: 'basic' },
  { id: 'gu', text: 'gu', romaji: 'gu', phonemes: ['g', 'u'], style: 'cv', category: 'g-row', difficulty: 'basic' },
  { id: 'ge', text: 'ge', romaji: 'ge', phonemes: ['g', 'e'], style: 'cv', category: 'g-row', difficulty: 'basic' },
  { id: 'go', text: 'go', romaji: 'go', phonemes: ['g', 'o'], style: 'cv', category: 'g-row', difficulty: 'basic' },

  // Za row
  { id: 'za', text: 'za', romaji: 'za', phonemes: ['z', 'a'], style: 'cv', category: 'z-row', difficulty: 'basic' },
  { id: 'zi', text: 'ji', romaji: 'ji', phonemes: ['j', 'i'], style: 'cv', category: 'z-row', difficulty: 'basic' },
  { id: 'zu', text: 'zu', romaji: 'zu', phonemes: ['z', 'u'], style: 'cv', category: 'z-row', difficulty: 'basic' },
  { id: 'ze', text: 'ze', romaji: 'ze', phonemes: ['z', 'e'], style: 'cv', category: 'z-row', difficulty: 'basic' },
  { id: 'zo', text: 'zo', romaji: 'zo', phonemes: ['z', 'o'], style: 'cv', category: 'z-row', difficulty: 'basic' },

  // Da row
  { id: 'da', text: 'da', romaji: 'da', phonemes: ['d', 'a'], style: 'cv', category: 'd-row', difficulty: 'basic' },
  { id: 'di', text: 'di', romaji: 'di', phonemes: ['d', 'i'], style: 'cv', category: 'd-row', difficulty: 'intermediate' },
  { id: 'du', text: 'du', romaji: 'du', phonemes: ['d', 'u'], style: 'cv', category: 'd-row', difficulty: 'intermediate' },
  { id: 'de', text: 'de', romaji: 'de', phonemes: ['d', 'e'], style: 'cv', category: 'd-row', difficulty: 'basic' },
  { id: 'do', text: 'do', romaji: 'do', phonemes: ['d', 'o'], style: 'cv', category: 'd-row', difficulty: 'basic' },

  // Ba row
  { id: 'ba', text: 'ba', romaji: 'ba', phonemes: ['b', 'a'], style: 'cv', category: 'b-row', difficulty: 'basic' },
  { id: 'bi', text: 'bi', romaji: 'bi', phonemes: ['b', 'i'], style: 'cv', category: 'b-row', difficulty: 'basic' },
  { id: 'bu', text: 'bu', romaji: 'bu', phonemes: ['b', 'u'], style: 'cv', category: 'b-row', difficulty: 'basic' },
  { id: 'be', text: 'be', romaji: 'be', phonemes: ['b', 'e'], style: 'cv', category: 'b-row', difficulty: 'basic' },
  { id: 'bo', text: 'bo', romaji: 'bo', phonemes: ['b', 'o'], style: 'cv', category: 'b-row', difficulty: 'basic' },

  // Pa row
  { id: 'pa', text: 'pa', romaji: 'pa', phonemes: ['p', 'a'], style: 'cv', category: 'p-row', difficulty: 'basic' },
  { id: 'pi', text: 'pi', romaji: 'pi', phonemes: ['p', 'i'], style: 'cv', category: 'p-row', difficulty: 'basic' },
  { id: 'pu', text: 'pu', romaji: 'pu', phonemes: ['p', 'u'], style: 'cv', category: 'p-row', difficulty: 'basic' },
  { id: 'pe', text: 'pe', romaji: 'pe', phonemes: ['p', 'e'], style: 'cv', category: 'p-row', difficulty: 'basic' },
  { id: 'po', text: 'po', romaji: 'po', phonemes: ['p', 'o'], style: 'cv', category: 'p-row', difficulty: 'basic' },
];

/**
 * Japanese VCV prompts for more natural voice transitions.
 */
const JAPANESE_VCV_PROMPTS: PhonemePrompt[] = [
  // Basic VCV patterns with 'a'
  { id: 'a_ka', text: 'aka', romaji: 'a ka', phonemes: ['a', 'k', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_sa', text: 'asa', romaji: 'a sa', phonemes: ['a', 's', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_ta', text: 'ata', romaji: 'a ta', phonemes: ['a', 't', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_na', text: 'ana', romaji: 'a na', phonemes: ['a', 'n', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_ha', text: 'aha', romaji: 'a ha', phonemes: ['a', 'h', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_ma', text: 'ama', romaji: 'a ma', phonemes: ['a', 'm', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_ya', text: 'aya', romaji: 'a ya', phonemes: ['a', 'y', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_ra', text: 'ara', romaji: 'a ra', phonemes: ['a', 'r', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },
  { id: 'a_wa', text: 'awa', romaji: 'a wa', phonemes: ['a', 'w', 'a'], style: 'vcv', category: 'a-transitions', difficulty: 'intermediate' },

  // VCV patterns with 'i'
  { id: 'i_ki', text: 'iki', romaji: 'i ki', phonemes: ['i', 'k', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_shi', text: 'ishi', romaji: 'i shi', phonemes: ['i', 'sh', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_chi', text: 'ichi', romaji: 'i chi', phonemes: ['i', 'ch', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_ni', text: 'ini', romaji: 'i ni', phonemes: ['i', 'n', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_hi', text: 'ihi', romaji: 'i hi', phonemes: ['i', 'h', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_mi', text: 'imi', romaji: 'i mi', phonemes: ['i', 'm', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },
  { id: 'i_ri', text: 'iri', romaji: 'i ri', phonemes: ['i', 'r', 'i'], style: 'vcv', category: 'i-transitions', difficulty: 'intermediate' },

  // VCV patterns with 'u'
  { id: 'u_ku', text: 'uku', romaji: 'u ku', phonemes: ['u', 'k', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_su', text: 'usu', romaji: 'u su', phonemes: ['u', 's', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_tsu', text: 'utsu', romaji: 'u tsu', phonemes: ['u', 'ts', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_nu', text: 'unu', romaji: 'u nu', phonemes: ['u', 'n', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_fu', text: 'ufu', romaji: 'u fu', phonemes: ['u', 'f', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_mu', text: 'umu', romaji: 'u mu', phonemes: ['u', 'm', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_yu', text: 'uyu', romaji: 'u yu', phonemes: ['u', 'y', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },
  { id: 'u_ru', text: 'uru', romaji: 'u ru', phonemes: ['u', 'r', 'u'], style: 'vcv', category: 'u-transitions', difficulty: 'intermediate' },

  // VCV patterns with 'e'
  { id: 'e_ke', text: 'eke', romaji: 'e ke', phonemes: ['e', 'k', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_se', text: 'ese', romaji: 'e se', phonemes: ['e', 's', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_te', text: 'ete', romaji: 'e te', phonemes: ['e', 't', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_ne', text: 'ene', romaji: 'e ne', phonemes: ['e', 'n', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_he', text: 'ehe', romaji: 'e he', phonemes: ['e', 'h', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_me', text: 'eme', romaji: 'e me', phonemes: ['e', 'm', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },
  { id: 'e_re', text: 'ere', romaji: 'e re', phonemes: ['e', 'r', 'e'], style: 'vcv', category: 'e-transitions', difficulty: 'intermediate' },

  // VCV patterns with 'o'
  { id: 'o_ko', text: 'oko', romaji: 'o ko', phonemes: ['o', 'k', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_so', text: 'oso', romaji: 'o so', phonemes: ['o', 's', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_to', text: 'oto', romaji: 'o to', phonemes: ['o', 't', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_no', text: 'ono', romaji: 'o no', phonemes: ['o', 'n', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_ho', text: 'oho', romaji: 'o ho', phonemes: ['o', 'h', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_mo', text: 'omo', romaji: 'o mo', phonemes: ['o', 'm', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_yo', text: 'oyo', romaji: 'o yo', phonemes: ['o', 'y', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_ro', text: 'oro', romaji: 'o ro', phonemes: ['o', 'r', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
  { id: 'o_wo', text: 'owo', romaji: 'o wo', phonemes: ['o', 'w', 'o'], style: 'vcv', category: 'o-transitions', difficulty: 'intermediate' },
];

/**
 * English ARPAsing prompts for UTAU English voicebanks.
 * Uses ARPABET phoneme notation for American English.
 */
const ENGLISH_ARPASING_PROMPTS: PhonemePrompt[] = [
  // Basic words covering core phonemes
  { id: 'en-arp-001', text: 'cat', romaji: 'cat', phonemes: ['k', 'ae', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Short vowel ae, common consonants k and t' },
  { id: 'en-arp-002', text: 'dog', romaji: 'dog', phonemes: ['d', 'aa', 'g'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Open back vowel aa, voiced stops' },
  { id: 'en-arp-003', text: 'bat', romaji: 'bat', phonemes: ['b', 'ae', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiced bilabial stop b' },
  { id: 'en-arp-004', text: 'set', romaji: 'set', phonemes: ['s', 'eh', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Front mid vowel eh' },
  { id: 'en-arp-005', text: 'kit', romaji: 'kit', phonemes: ['k', 'ih', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'High front lax vowel ih' },
  { id: 'en-arp-006', text: 'good', romaji: 'good', phonemes: ['g', 'uh', 'd'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'High back lax vowel uh' },
  { id: 'en-arp-007', text: 'food', romaji: 'food', phonemes: ['f', 'uw', 'd'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'High back tense vowel uw' },
  { id: 'en-arp-008', text: 'bee', romaji: 'bee', phonemes: ['b', 'iy'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'High front tense vowel iy' },
  { id: 'en-arp-009', text: 'go', romaji: 'go', phonemes: ['g', 'ow'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Diphthong ow' },
  { id: 'en-arp-010', text: 'buy', romaji: 'buy', phonemes: ['b', 'ay'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Diphthong ay' },
  { id: 'en-arp-011', text: 'now', romaji: 'now', phonemes: ['n', 'aw'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Diphthong aw' },
  { id: 'en-arp-012', text: 'boy', romaji: 'boy', phonemes: ['b', 'oy'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Diphthong oy' },
  { id: 'en-arp-013', text: 'say', romaji: 'say', phonemes: ['s', 'ey'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Diphthong ey' },
  { id: 'en-arp-014', text: 'bird', romaji: 'bird', phonemes: ['b', 'er', 'd'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'R-colored vowel er' },
  { id: 'en-arp-015', text: 'cut', romaji: 'cut', phonemes: ['k', 'ah', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Mid central vowel ah (strut vowel)' },
  { id: 'en-arp-016', text: 'jaw', romaji: 'jaw', phonemes: ['jh', 'ao'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Affricate jh and open-mid back vowel ao' },
  { id: 'en-arp-017', text: 'cheese', romaji: 'cheese', phonemes: ['ch', 'iy', 'z'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Affricate ch and final voiced fricative z' },
  { id: 'en-arp-018', text: 'ship', romaji: 'ship', phonemes: ['sh', 'ih', 'p'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiceless postalveolar fricative sh' },
  { id: 'en-arp-019', text: 'measure', romaji: 'measure', phonemes: ['m', 'eh', 'zh', 'er'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiced postalveolar fricative zh' },
  { id: 'en-arp-020', text: 'think', romaji: 'think', phonemes: ['th', 'ih', 'ng', 'k'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiceless dental fricative th, velar nasal ng' },
  { id: 'en-arp-021', text: 'this', romaji: 'this', phonemes: ['dh', 'ih', 's'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiced dental fricative dh' },
  { id: 'en-arp-022', text: 'ring', romaji: 'ring', phonemes: ['r', 'ih', 'ng'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Initial r and final velar nasal ng' },
  { id: 'en-arp-023', text: 'love', romaji: 'love', phonemes: ['l', 'ah', 'v'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Lateral l and labiodental fricative v' },
  { id: 'en-arp-024', text: 'win', romaji: 'win', phonemes: ['w', 'ih', 'n'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Labial-velar approximant w' },
  { id: 'en-arp-025', text: 'yes', romaji: 'yes', phonemes: ['y', 'eh', 's'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Palatal approximant y' },
  { id: 'en-arp-026', text: 'hat', romaji: 'hat', phonemes: ['hh', 'ae', 't'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiceless glottal fricative hh' },
  { id: 'en-arp-027', text: 'map', romaji: 'map', phonemes: ['m', 'ae', 'p'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Bilabial nasal m' },
  { id: 'en-arp-028', text: 'sun', romaji: 'sun', phonemes: ['s', 'ah', 'n'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Alveolar nasal n' },
  { id: 'en-arp-029', text: 'fish', romaji: 'fish', phonemes: ['f', 'ih', 'sh'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Labiodental fricative f' },
  { id: 'en-arp-030', text: 'zoo', romaji: 'zoo', phonemes: ['z', 'uw'], style: 'arpasing', category: 'basic-words', difficulty: 'basic', notes: 'Voiced alveolar fricative z' },

  // Phrases for natural speech patterns
  { id: 'en-arp-031', text: 'The quick brown fox', romaji: 'The quick brown fox', phonemes: ['dh', 'ax', 'k', 'w', 'ih', 'k', 'b', 'r', 'aw', 'n', 'f', 'aa', 'k', 's'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Classic pangram start - covers common consonant clusters' },
  { id: 'en-arp-032', text: 'jumps over the lazy dog', romaji: 'jumps over the lazy dog', phonemes: ['jh', 'ah', 'm', 'p', 's', 'ow', 'v', 'er', 'dh', 'ax', 'l', 'ey', 'z', 'iy', 'd', 'ao', 'g'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Completes pangram - covers remaining common sounds' },
  { id: 'en-arp-033', text: 'She sells seashells', romaji: 'She sells seashells', phonemes: ['sh', 'iy', 's', 'eh', 'l', 'z', 's', 'iy', 'sh', 'eh', 'l', 'z'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Sibilant practice - sh and s alternation' },
  { id: 'en-arp-034', text: 'by the seashore', romaji: 'by the seashore', phonemes: ['b', 'ay', 'dh', 'ax', 's', 'iy', 'sh', 'ao', 'r'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Continuation of seashells phrase' },
  { id: 'en-arp-035', text: 'How are you today', romaji: 'How are you today', phonemes: ['hh', 'aw', 'aa', 'r', 'y', 'uw', 't', 'ax', 'd', 'ey'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Common greeting with natural prosody' },
  { id: 'en-arp-036', text: 'I would like some water', romaji: 'I would like some water', phonemes: ['ay', 'w', 'uh', 'd', 'l', 'ay', 'k', 's', 'ah', 'm', 'w', 'ao', 't', 'er'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Request phrase with varied vowels' },
  { id: 'en-arp-037', text: 'The weather is nice', romaji: 'The weather is nice', phonemes: ['dh', 'ax', 'w', 'eh', 'dh', 'er', 'ih', 'z', 'n', 'ay', 's'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Common observation with th sounds' },
  { id: 'en-arp-038', text: 'Please help me find it', romaji: 'Please help me find it', phonemes: ['p', 'l', 'iy', 'z', 'hh', 'eh', 'l', 'p', 'm', 'iy', 'f', 'ay', 'n', 'd', 'ih', 't'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Request with consonant clusters pl, lp, nd' },
  { id: 'en-arp-039', text: 'What time is lunch', romaji: 'What time is lunch', phonemes: ['w', 'ah', 't', 't', 'ay', 'm', 'ih', 'z', 'l', 'ah', 'n', 'ch'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Question with ch ending' },
  { id: 'en-arp-040', text: 'I love singing songs', romaji: 'I love singing songs', phonemes: ['ay', 'l', 'ah', 'v', 's', 'ih', 'ng', 'ih', 'ng', 's', 'ao', 'ng', 'z'], style: 'arpasing', category: 'phrases', difficulty: 'intermediate', notes: 'Multiple ng sounds for voicebank use' },

  // Pangrams for complete phoneme coverage
  { id: 'en-arp-041', text: 'Pack my box with five dozen liquor jugs', romaji: 'Pack my box with five dozen liquor jugs', phonemes: ['p', 'ae', 'k', 'm', 'ay', 'b', 'aa', 'k', 's', 'w', 'ih', 'th', 'f', 'ay', 'v', 'd', 'ah', 'z', 'ax', 'n', 'l', 'ih', 'k', 'er', 'jh', 'ah', 'g', 'z'], style: 'arpasing', category: 'pangrams', difficulty: 'advanced', notes: 'Complete pangram - all letters of alphabet' },
  { id: 'en-arp-042', text: 'Sphinx of black quartz judge my vow', romaji: 'Sphinx of black quartz judge my vow', phonemes: ['s', 'f', 'ih', 'ng', 'k', 's', 'ah', 'v', 'b', 'l', 'ae', 'k', 'k', 'w', 'ao', 'r', 't', 's', 'jh', 'ah', 'jh', 'm', 'ay', 'v', 'aw'], style: 'arpasing', category: 'pangrams', difficulty: 'advanced', notes: 'Short pangram with unusual consonant clusters' },
  { id: 'en-arp-043', text: 'How vexingly quick daft zebras jump', romaji: 'How vexingly quick daft zebras jump', phonemes: ['hh', 'aw', 'v', 'eh', 'k', 's', 'ih', 'ng', 'l', 'iy', 'k', 'w', 'ih', 'k', 'd', 'ae', 'f', 't', 'z', 'iy', 'b', 'r', 'ax', 'z', 'jh', 'ah', 'm', 'p'], style: 'arpasing', category: 'pangrams', difficulty: 'advanced', notes: 'Another pangram with good phoneme distribution' },
  { id: 'en-arp-044', text: 'The five boxing wizards jump quickly', romaji: 'The five boxing wizards jump quickly', phonemes: ['dh', 'ax', 'f', 'ay', 'v', 'b', 'aa', 'k', 's', 'ih', 'ng', 'w', 'ih', 'z', 'er', 'd', 'z', 'jh', 'ah', 'm', 'p', 'k', 'w', 'ih', 'k', 'l', 'iy'], style: 'arpasing', category: 'pangrams', difficulty: 'advanced', notes: 'Pangram with multiple consonant clusters' },
  { id: 'en-arp-045', text: 'Jackdaws love my big sphinx of quartz', romaji: 'Jackdaws love my big sphinx of quartz', phonemes: ['jh', 'ae', 'k', 'd', 'ao', 'z', 'l', 'ah', 'v', 'm', 'ay', 'b', 'ih', 'g', 's', 'f', 'ih', 'ng', 'k', 's', 'ah', 'v', 'k', 'w', 'ao', 'r', 't', 's'], style: 'arpasing', category: 'pangrams', difficulty: 'advanced', notes: 'Pangram with jh and varied vowels' },

  // Sentences for extended recording
  { id: 'en-arp-046', text: 'A journey of a thousand miles begins with a single step', romaji: 'A journey of a thousand miles begins with a single step', phonemes: ['ax', 'jh', 'er', 'n', 'iy', 'ah', 'v', 'ax', 'th', 'aw', 'z', 'ax', 'n', 'd', 'm', 'ay', 'l', 'z', 'b', 'ih', 'g', 'ih', 'n', 'z', 'w', 'ih', 'th', 'ax', 's', 'ih', 'ng', 'g', 'ax', 'l', 's', 't', 'eh', 'p'], style: 'arpasing', category: 'sentences', difficulty: 'advanced', notes: 'Inspirational quote with natural speech patterns' },
  { id: 'en-arp-047', text: 'To be or not to be that is the question', romaji: 'To be or not to be that is the question', phonemes: ['t', 'ax', 'b', 'iy', 'ao', 'r', 'n', 'aa', 't', 't', 'ax', 'b', 'iy', 'dh', 'ae', 't', 'ih', 'z', 'dh', 'ax', 'k', 'w', 'eh', 's', 'ch', 'ax', 'n'], style: 'arpasing', category: 'sentences', difficulty: 'advanced', notes: 'Classic Shakespeare with repeated sounds' },

  // Tongue twisters for articulation practice
  { id: 'en-arp-048', text: 'Red lorry yellow lorry', romaji: 'Red lorry yellow lorry', phonemes: ['r', 'eh', 'd', 'l', 'ao', 'r', 'iy', 'y', 'eh', 'l', 'ow', 'l', 'ao', 'r', 'iy'], style: 'arpasing', category: 'tongue-twisters', difficulty: 'advanced', notes: 'Tongue twister for r and l distinction' },
  { id: 'en-arp-049', text: 'Unique New York', romaji: 'Unique New York', phonemes: ['y', 'uw', 'n', 'iy', 'k', 'n', 'uw', 'y', 'ao', 'r', 'k'], style: 'arpasing', category: 'tongue-twisters', difficulty: 'advanced', notes: 'Tongue twister for y and n sounds' },
  { id: 'en-arp-050', text: 'Peter Piper picked a peck of pickled peppers', romaji: 'Peter Piper picked a peck of pickled peppers', phonemes: ['p', 'iy', 't', 'er', 'p', 'ay', 'p', 'er', 'p', 'ih', 'k', 't', 'ax', 'p', 'eh', 'k', 'ah', 'v', 'p', 'ih', 'k', 'ax', 'l', 'd', 'p', 'eh', 'p', 'er', 'z'], style: 'arpasing', category: 'tongue-twisters', difficulty: 'advanced', notes: 'Classic alliterative tongue twister for p sound' },

  // Isolated vowels for sustained notes
  { id: 'en-arp-051', text: 'ah', romaji: 'ah (as in father)', phonemes: ['aa'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Open back unrounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-052', text: 'eh', romaji: 'eh (as in bed)', phonemes: ['eh'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Open-mid front unrounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-053', text: 'ee', romaji: 'ee (as in bee)', phonemes: ['iy'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Close front unrounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-054', text: 'ih', romaji: 'ih (as in bit)', phonemes: ['ih'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Near-close front unrounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-055', text: 'oh', romaji: 'oh (as in go)', phonemes: ['ow'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Close-mid back rounded vowel diphthong - sustain for 2-3 seconds' },
  { id: 'en-arp-056', text: 'oo', romaji: 'oo (as in food)', phonemes: ['uw'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Close back rounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-057', text: 'uh', romaji: 'uh (as in cut)', phonemes: ['ah'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'Open-mid back unrounded vowel - sustain for 2-3 seconds' },
  { id: 'en-arp-058', text: 'er', romaji: 'er (as in bird)', phonemes: ['er'], style: 'arpasing', category: 'isolated-vowels', difficulty: 'basic', notes: 'R-colored mid central vowel - sustain for 2-3 seconds' },
];

/**
 * Japanese extra consonants for loanword pronunciation.
 *
 * These are alternative pronunciations distinct from standard Japanese:
 * - si (s+i) vs standard shi (sh+i)
 * - ti (t+i) vs standard chi (ch+i)
 * - tu (t+u) vs standard tsu (ts+u)
 * - hu (h+u) vs standard fu (f+u)
 * - fa/fi/fe/fo series for foreign words
 * - ye, wi, we for English-influenced words
 *
 * Note: di and du already exist in JAPANESE_CV_PROMPTS and are not duplicated here.
 * Note: wo already exists in JAPANESE_CV_PROMPTS and is not duplicated here.
 */
const JAPANESE_EXTRA_CONSONANTS: PhonemePrompt[] = [
  // Alternative sibilants and stops
  { id: 'ext-si', text: 'si', romaji: 'si', phonemes: ['s', 'i'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Alternative to shi - used in loanwords like "signal"' },
  { id: 'ext-ti', text: 'ti', romaji: 'ti', phonemes: ['t', 'i'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Alternative to chi - used in loanwords like "tea"' },
  { id: 'ext-tu', text: 'tu', romaji: 'tu', phonemes: ['t', 'u'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Alternative to tsu - used in loanwords like "two"' },
  { id: 'ext-hu', text: 'hu', romaji: 'hu', phonemes: ['h', 'u'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Alternative to fu - used in loanwords like "who"' },

  // Y-row extension
  { id: 'ext-ye', text: 'ye', romaji: 'ye', phonemes: ['y', 'e'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "yes"' },

  // W-row extensions
  { id: 'ext-wi', text: 'wi', romaji: 'wi', phonemes: ['w', 'i'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "with"' },
  { id: 'ext-we', text: 'we', romaji: 'we', phonemes: ['w', 'e'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "web"' },

  // F-row for foreign words
  { id: 'ext-fa', text: 'fa', romaji: 'fa', phonemes: ['f', 'a'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "fan"' },
  { id: 'ext-fi', text: 'fi', romaji: 'fi', phonemes: ['f', 'i'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "film"' },
  { id: 'ext-fe', text: 'fe', romaji: 'fe', phonemes: ['f', 'e'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "festival"' },
  { id: 'ext-fo', text: 'fo', romaji: 'fo', phonemes: ['f', 'o'], style: 'cv', category: 'extra-consonants', difficulty: 'advanced', notes: 'Used in loanwords like "fork"' },
];

/**
 * Japanese L-sound prompts, distinct from the standard R-row.
 *
 * In standard Japanese, the R-row (ra, ri, ru, re, ro) uses an alveolar tap.
 * These L-sounds use a lateral approximant, useful for voicebanks that need
 * to distinguish English L from Japanese R in careful pronunciation.
 */
const JAPANESE_EXTRA_L_SOUNDS: PhonemePrompt[] = [
  { id: 'ext-la', text: 'la', romaji: 'la', phonemes: ['l', 'a'], style: 'cv', category: 'extra-l-sounds', difficulty: 'advanced', notes: 'Lateral L distinct from Japanese R tap' },
  { id: 'ext-li', text: 'li', romaji: 'li', phonemes: ['l', 'i'], style: 'cv', category: 'extra-l-sounds', difficulty: 'advanced', notes: 'Lateral L distinct from Japanese R tap' },
  { id: 'ext-lu', text: 'lu', romaji: 'lu', phonemes: ['l', 'u'], style: 'cv', category: 'extra-l-sounds', difficulty: 'advanced', notes: 'Lateral L distinct from Japanese R tap' },
  { id: 'ext-le', text: 'le', romaji: 'le', phonemes: ['l', 'e'], style: 'cv', category: 'extra-l-sounds', difficulty: 'advanced', notes: 'Lateral L distinct from Japanese R tap' },
  { id: 'ext-lo', text: 'lo', romaji: 'lo', phonemes: ['l', 'o'], style: 'cv', category: 'extra-l-sounds', difficulty: 'advanced', notes: 'Lateral L distinct from Japanese R tap' },
];

/**
 * Breath sound prompts for expressive synthesis.
 *
 * These add realism to voicebanks by providing breath samples
 * that can be inserted between phrases or at natural pause points.
 */
const JAPANESE_EXTRA_BREATHS: PhonemePrompt[] = [
  { id: 'ext-breath-in', text: 'breath in', romaji: 'breath_in', phonemes: ['br'], style: 'cv', category: 'extra-breaths', difficulty: 'advanced', notes: 'Inhale breath - record a natural breath intake' },
  { id: 'ext-breath-out', text: 'breath out', romaji: 'breath_out', phonemes: ['br'], style: 'cv', category: 'extra-breaths', difficulty: 'advanced', notes: 'Exhale breath - record a natural breath release' },
  { id: 'ext-breath-aspiration', text: 'aspiration', romaji: 'breath_aspiration', phonemes: ['hh'], style: 'cv', category: 'extra-breaths', difficulty: 'advanced', notes: 'Light sigh or aspiration - a soft breathy sound' },
];

/**
 * API client for recording session management.
 */
export class RecordingApiService {
  private readonly baseUrl: string;

  constructor(baseUrl = getDefaultApiUrl()) {
    this.baseUrl = baseUrl;
  }

  /**
   * Make an HTTP request and handle errors.
   */
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
      },
    });

    if (!response.ok) {
      let message = `HTTP ${response.status}: ${response.statusText}`;
      let detail: unknown = undefined;

      try {
        const errorData = await response.json();
        if (typeof errorData.detail === 'string') {
          message = errorData.detail;
        } else if (errorData.detail) {
          detail = errorData.detail;
          message = JSON.stringify(errorData.detail);
        }
      } catch {
        // Response body is not JSON, use default message
      }

      throw new ApiError(response.status, message, detail);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json();
  }

  /**
   * Get prompts for a given style and language.
   *
   * Currently provides built-in Japanese CV, VCV prompts and English ARPAsing prompts.
   * Optional sound packs can be included via the `options` parameter for Japanese styles.
   * Future versions may fetch from the backend.
   */
  getPrompts(
    style: 'cv' | 'vcv' | 'cvvc' | 'vccv' | 'arpasing',
    language: string,
    options?: ReclistOptions
  ): PhonemePrompt[] {
    // Handle English ARPAsing style
    if (style === 'arpasing') {
      if (language !== 'en') {
        console.warn(`ARPAsing style is designed for English; language "${language}" may not be appropriate`);
      }
      return [...ENGLISH_ARPASING_PROMPTS];
    }

    // Handle Japanese styles
    if (language !== 'ja') {
      console.warn(`Language "${language}" not yet supported for style "${style}", falling back to Japanese`);
    }

    let prompts: PhonemePrompt[];

    switch (style) {
      case 'cv':
        prompts = [...JAPANESE_CV_PROMPTS];
        break;
      case 'vcv':
        prompts = [...JAPANESE_VCV_PROMPTS];
        break;
      case 'cvvc':
        // CVVC combines CV and VCV patterns
        prompts = [...JAPANESE_CV_PROMPTS, ...JAPANESE_VCV_PROMPTS];
        break;
      default:
        prompts = [...JAPANESE_CV_PROMPTS];
        break;
    }

    // Append optional extra sound packs for Japanese styles
    if (language === 'ja' && options) {
      if (options.extraConsonants) {
        prompts = [...prompts, ...JAPANESE_EXTRA_CONSONANTS];
      }
      if (options.lSounds) {
        prompts = [...prompts, ...JAPANESE_EXTRA_L_SOUNDS];
      }
      if (options.breathSounds) {
        prompts = [...prompts, ...JAPANESE_EXTRA_BREATHS];
      }
    }

    return prompts;
  }

  /**
   * Create a new recording session.
   *
   * Creates a session on the backend to track recording progress.
   * The session must have a voicebank to associate recordings with.
   * Optional reclist options control which extra sound packs are included.
   */
  async createSession(
    config: SessionConfig
  ): Promise<{ sessionId: string; prompts: PhonemePrompt[] }> {
    const prompts = this.getPrompts(config.style, config.language, config.reclistOptions);
    const promptTexts = prompts.map((p) => p.romaji);

    const session = await this.request<RecordingSession>('/sessions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        voicebank_id: config.voicebankName,
        recording_style: config.style,
        language: config.language,
        prompts: promptTexts,
      }),
    });

    return {
      sessionId: session.id,
      prompts,
    };
  }

  /**
   * Start a recording session.
   *
   * Transitions the session to the recording state.
   */
  async startSession(sessionId: string): Promise<RecordingSession> {
    return this.request<RecordingSession>(`/sessions/${sessionId}/start`, {
      method: 'POST',
    });
  }

  /**
   * Upload a recorded audio segment.
   *
   * Uploads audio for a specific prompt to the session.
   */
  async uploadSegment(
    sessionId: string,
    promptIndex: number,
    promptText: string,
    audioBlob: Blob,
    durationMs: number
  ): Promise<RecordingSegment> {
    const formData = new FormData();
    formData.append('prompt_index', promptIndex.toString());
    formData.append('prompt_text', promptText);
    formData.append('duration_ms', durationMs.toString());
    formData.append('audio', audioBlob, `segment_${promptIndex}.wav`);

    return this.request<RecordingSegment>(`/sessions/${sessionId}/segments`, {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Get session status and progress.
   */
  async getSessionStatus(sessionId: string): Promise<SessionProgress> {
    return this.request<SessionProgress>(`/sessions/${sessionId}/status`);
  }

  /**
   * Get full session details.
   */
  async getSession(sessionId: string): Promise<RecordingSession> {
    return this.request<RecordingSession>(`/sessions/${sessionId}`);
  }

  /**
   * Complete a recording session.
   *
   * Marks the session as ready for voicebank generation.
   */
  async completeSession(sessionId: string): Promise<RecordingSession> {
    return this.request<RecordingSession>(`/sessions/${sessionId}/complete`, {
      method: 'POST',
    });
  }

  /**
   * Submit a voicebank generation job for a recording session.
   *
   * Returns a Job in QUEUED status. Poll with getJobStatus() for progress.
   */
  async generateVoicebank(
    sessionId: string,
    name: string
  ): Promise<Job> {
    return this.request<Job>(
      `/sessions/${sessionId}/generate-voicebank`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          voicebank_name: name,
        }),
      }
    );
  }

  /**
   * Get the current status and progress of a job.
   */
  async getJobStatus(jobId: string): Promise<Job> {
    return this.request<Job>(`/jobs/${jobId}`);
  }

  /**
   * Get the result of a completed generation job.
   */
  async getJobResult(jobId: string): Promise<GeneratedVoicebank> {
    return this.request<GeneratedVoicebank>(`/jobs/${jobId}/result`);
  }

  /**
   * Poll a job until it reaches a terminal state (completed or failed).
   *
   * Calls onProgress with each update. Returns the final job state.
   * Throws if the job fails.
   */
  async pollJobUntilComplete(
    jobId: string,
    onProgress?: (job: Job) => void,
    intervalMs = 2000
  ): Promise<Job> {
    return new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const job = await this.getJobStatus(jobId);
          onProgress?.(job);

          if (job.status === 'completed') {
            resolve(job);
            return;
          }
          if (job.status === 'failed') {
            const errorMsg = job.result?.error ?? 'Job failed';
            reject(new ApiError(500, errorMsg));
            return;
          }

          // Still running, poll again
          setTimeout(poll, intervalMs);
        } catch (error) {
          reject(error);
        }
      };

      poll();
    });
  }

  /**
   * Download the generated voicebank as a ZIP file.
   *
   * Note: This requires the backend to have a download endpoint.
   * For now, returns the path from the generated voicebank.
   */
  async downloadVoicebank(generatedPath: string): Promise<Blob> {
    // The backend would need a download endpoint
    // For now, we just return the path info
    const response = await fetch(`${this.baseUrl}/voicebanks/${encodeURIComponent(generatedPath)}/download`);

    if (!response.ok) {
      throw new ApiError(response.status, 'Failed to download voicebank');
    }

    return response.blob();
  }

  /**
   * Cancel a recording session.
   */
  async cancelSession(sessionId: string): Promise<RecordingSession> {
    return this.request<RecordingSession>(`/sessions/${sessionId}/cancel`, {
      method: 'POST',
    });
  }

  /**
   * Reject a recorded segment for re-recording.
   *
   * Marks the segment as rejected so it can be recorded again.
   */
  async rejectSegment(
    sessionId: string,
    segmentId: string,
    reason = 'Re-recording requested'
  ): Promise<RecordingSegment> {
    const formData = new FormData();
    formData.append('reason', reason);

    return this.request<RecordingSegment>(
      `/sessions/${sessionId}/segments/${segmentId}/reject`,
      {
        method: 'POST',
        body: formData,
      }
    );
  }
}

/**
 * Default recording API service instance.
 */
export const recordingApi = new RecordingApiService();
