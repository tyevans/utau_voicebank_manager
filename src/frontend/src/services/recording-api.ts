/**
 * API client for recording session management.
 *
 * Provides type-safe methods for creating and managing recording sessions,
 * uploading audio segments, and generating voicebanks.
 */

import type { PhonemePrompt } from '../components/uvm-recording-prompter.js';
import { ApiError } from './api.js';

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
 * Configuration for creating a new recording session.
 */
export interface SessionConfig {
  voicebankName: string;
  style: 'cv' | 'vcv' | 'cvvc';
  language: string;
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
 * API client for recording session management.
 */
export class RecordingApiService {
  private readonly baseUrl: string;

  constructor(baseUrl = 'http://localhost:8000/api/v1') {
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
   * Currently provides built-in Japanese CV and VCV prompts.
   * Future versions may fetch from the backend.
   */
  getPrompts(style: 'cv' | 'vcv' | 'cvvc', language: string): PhonemePrompt[] {
    if (language !== 'ja') {
      // For now, only Japanese is supported
      console.warn(`Language "${language}" not yet supported, falling back to Japanese`);
    }

    switch (style) {
      case 'cv':
        return [...JAPANESE_CV_PROMPTS];
      case 'vcv':
        return [...JAPANESE_VCV_PROMPTS];
      case 'cvvc':
        // CVVC combines CV and VCV patterns
        return [...JAPANESE_CV_PROMPTS, ...JAPANESE_VCV_PROMPTS];
      default:
        return [...JAPANESE_CV_PROMPTS];
    }
  }

  /**
   * Create a new recording session.
   *
   * Creates a session on the backend to track recording progress.
   * The session must have a voicebank to associate recordings with.
   */
  async createSession(
    config: SessionConfig
  ): Promise<{ sessionId: string; prompts: PhonemePrompt[] }> {
    const prompts = this.getPrompts(config.style, config.language);
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
   * Generate a voicebank from a recording session.
   *
   * Processes all recorded segments, performs alignment, and creates
   * the final voicebank with oto.ini parameters.
   */
  async generateVoicebank(
    sessionId: string,
    name: string
  ): Promise<GeneratedVoicebank> {
    return this.request<GeneratedVoicebank>(
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
}

/**
 * Default recording API service instance.
 */
export const recordingApi = new RecordingApiService();
