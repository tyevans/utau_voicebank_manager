/**
 * Demo songs for voicebank testing and preview.
 *
 * These are public domain songs that demonstrate voicebank capabilities
 * across different languages and recording styles. Each song includes
 * a list of required phonemes so the UI can validate whether a voicebank
 * has the necessary samples to play the song.
 */

import type { PhraseNote, VibratoParams } from '../services/melody-player.js';
import { romajiToKana, kanaToRomaji } from '../utils/kana-romaji.js';

/**
 * A demo song with phoneme-level note data for voicebank preview.
 */
export interface DemoSong {
  /** Unique identifier for the song */
  id: string;
  /** Display name of the song */
  title: string;
  /** Language of the lyrics */
  language: 'japanese' | 'english';
  /** Recording style the song is designed for */
  recordingStyle: 'cv' | 'vcv' | 'arpasing';
  /** List of phoneme aliases required to play this song */
  requiredPhonemes: string[];
  /** The note sequence with phonemes and timing */
  notes: PhraseNote[];
  /** Tempo in beats per minute */
  bpm: number;
  /** Optional description or subtitle */
  description?: string;
}

/**
 * Helper to calculate note timing from beats.
 * Returns duration in seconds based on BPM.
 */
function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm;
}

/**
 * Extended note entry that supports vibrato.
 * Format: [alias, pitch, durationInBeats, velocity?, vibrato?]
 */
type NoteEntry =
  | [alias: string, pitch: number, durationInBeats: number]
  | [alias: string, pitch: number, durationInBeats: number, velocity: number]
  | [alias: string, pitch: number, durationInBeats: number, velocity: number, vibrato: VibratoParams];

/**
 * Helper to create sequential phrase notes from a simplified notation.
 * Each entry is [alias, pitch, durationInBeats] or [alias, pitch, durationInBeats, velocity]
 * or [alias, pitch, durationInBeats, velocity, vibrato].
 * Velocity defaults to 1.0 if not specified.
 */
function createPhraseNotes(
  entries: NoteEntry[],
  bpm: number
): PhraseNote[] {
  const notes: PhraseNote[] = [];
  let startTime = 0;

  for (const entry of entries) {
    const [alias, pitch, beats, velocity = 1.0, vibrato] = entry;
    const duration = beatsToSeconds(beats, bpm);
    const note: PhraseNote = {
      alias,
      pitch,
      startTime,
      duration,
      velocity,
    };
    if (vibrato) {
      note.vibrato = vibrato;
    }
    notes.push(note);
    startTime += duration;
  }

  return notes;
}

// =============================================================================
// Twinkle Twinkle Little Star (English - ARPAsing)
// =============================================================================
//
// Melody: C C G G A A G | F F E E D D C
// Lyrics: Twin-kle twin-kle lit-tle star | How I won-der what you are
//
// ARPAsing phoneme mapping (ARPABET-style):
//   twinkle = t w ih ng k ah l
//   little  = l ih t ah l
//   star    = s t aa r
//   how     = hh aw
//   I       = ay
//   wonder  = w ah n d er
//   what    = w ah t
//   you     = y uw
//   are     = aa r

const TWINKLE_BPM = 100;

/**
 * Twinkle Twinkle Little Star - English ARPAsing demo.
 *
 * Classic nursery rhyme in C major. Uses ARPABET phonemes suitable
 * for ARPAsing-style voicebanks. First two phrases included.
 *
 * Musical structure:
 * - Time signature: 4/4
 * - Key: C major
 * - Tempo: 100 BPM
 * - Pitch reference: 0 = C4, 7 = G4, 9 = A4, etc.
 */
export const TWINKLE_TWINKLE: DemoSong = {
  id: 'twinkle-twinkle',
  title: 'Twinkle Twinkle Little Star',
  description: 'English nursery rhyme (first 2 phrases)',
  language: 'english',
  recordingStyle: 'arpasing',
  bpm: TWINKLE_BPM,
  requiredPhonemes: [
    // Vowels used
    'aa', 'ah', 'aw', 'ay', 'er', 'ih', 'uw',
    // Consonants used
    'd', 'hh', 'k', 'l', 'n', 'ng', 'r', 's', 't', 'w', 'y',
  ],
  notes: createPhraseNotes([
    // Measure 1: "Twin-kle twin-kle"
    // C C G G
    ['t', 0, 0.25],      // "T-" attack
    ['w', 0, 0.25],      // "-w-"
    ['ih', 0, 0.25],     // "-i-"
    ['ng', 0, 0.25],     // "-ng"
    ['k', 0, 0.25],      // "k-" of "-kle"
    ['ah', 0, 0.5],      // "-le"
    ['l', 0, 0.25],

    ['t', 7, 0.25],      // "twin-"
    ['w', 7, 0.25],
    ['ih', 7, 0.25],
    ['ng', 7, 0.25],
    ['k', 7, 0.25],      // "-kle"
    ['ah', 7, 0.5],
    ['l', 7, 0.25],

    // Measure 2: "lit-tle star"
    // A A G (held)
    ['l', 9, 0.25],      // "lit-"
    ['ih', 9, 0.5],
    ['t', 9, 0.25],

    ['ah', 9, 0.5],      // "-tle"
    ['l', 9, 0.5],

    ['s', 7, 0.25],      // "star"
    ['t', 7, 0.25],
    ['aa', 7, 1.0],
    ['r', 7, 0.5],

    // Measure 3: "How I won-der"
    // F F E E
    ['hh', 5, 0.25],     // "how"
    ['aw', 5, 0.75],

    ['ay', 5, 1.0],      // "I"

    ['w', 4, 0.25],      // "won-"
    ['ah', 4, 0.5],
    ['n', 4, 0.25],

    ['d', 4, 0.25],      // "-der"
    ['er', 4, 0.75],

    // Measure 4: "what you are"
    // D D C (held)
    ['w', 2, 0.25],      // "what"
    ['ah', 2, 0.5],
    ['t', 2, 0.25],

    ['y', 2, 0.25],      // "you"
    ['uw', 2, 0.75],

    ['aa', 0, 1.0],      // "are"
    ['r', 0, 1.0],
  ], TWINKLE_BPM),
};

// =============================================================================
// Furusato (Japanese - CV)
// =============================================================================
//
// Traditional Japanese song "Furusato" (Hometown)
// Public domain, composed 1914 by Teiichi Okano
//
// Lyrics (first verse, first two phrases):
//   うさぎおいし かのやま
//   (u sa gi o i shi ka no ya ma)
//   "Chasing rabbits on that mountain"
//
// Melody (simplified, in G major for comfortable range):
//   G A B B B A B | D D C B A G
//   Transposed to C4 reference: 0 2 4 4 4 2 4 | 7 7 5 4 2 0
//
// Traditional timing: 3/4 time signature

const FURUSATO_BPM = 72;

/**
 * Furusato (ふるさと) - Japanese CV demo.
 *
 * Traditional Japanese song meaning "Hometown". Uses standard
 * Japanese CV phonemes suitable for UTAU-style voicebanks.
 *
 * Musical structure:
 * - Time signature: 3/4
 * - Key: Relative to C4
 * - Tempo: 72 BPM (waltz tempo)
 * - First two phrases of the song
 */
export const FURUSATO: DemoSong = {
  id: 'furusato',
  title: 'Furusato (ふるさと)',
  description: 'Traditional Japanese song (first 2 phrases)',
  language: 'japanese',
  recordingStyle: 'cv',
  bpm: FURUSATO_BPM,
  requiredPhonemes: [
    // Pure vowels
    'a', 'i', 'u', 'o',
    // CV combinations used
    'ka', 'sa', 'gi', 'shi', 'no', 'ya', 'ma',
  ],
  notes: createPhraseNotes([
    // Phrase 1: うさぎおいし (u sa gi o i shi)
    // Melody: G A B B B A (mapped to 0 2 4 4 4 2)
    // In 3/4 time, each syllable gets roughly 1 beat

    ['u', 0, 1.0],       // う - G
    ['sa', 2, 1.0],      // さ - A
    ['gi', 4, 1.0],      // ぎ - B

    ['o', 4, 1.0],       // お - B
    ['i', 4, 1.0],       // い - B
    ['shi', 2, 2.0],     // し - A (held longer for phrase ending)

    // Phrase 2: かのやま (ka no ya ma)
    // Melody: B D D C B A (mapped to 4 7 7 5 4 2)
    // Short rest before this phrase (implicit in timing)

    ['ka', 4, 1.0],      // か - B
    ['no', 7, 1.5],      // の - D (slightly longer)
    ['ya', 7, 1.5],      // や - D
    ['ma', 5, 3.0],      // ま - C (held for phrase ending)
  ], FURUSATO_BPM),
};

// =============================================================================
// Sakura Sakura (Japanese - VCV)
// =============================================================================
//
// Traditional Japanese folk song "Sakura Sakura" (Cherry Blossoms)
// Public domain, arranged in Edo period
//
// Lyrics (first two phrases):
//   さくら さくら (sa ku ra sa ku ra)
//   やよいの そらは (ya yo i no so ra wa)
//
// VCV phoneme format: [preceding vowel] [consonant-vowel]
// First note uses bare phoneme or "- [cv]" format
//
// Melody in A minor (traditional pentatonic):
//   A A B | A A B | A B C B A | B A...
//   Mapped to semitones: 0 0 2 | 0 0 2 | 0 2 3 2 0 | 2 0
//
// The iconic Japanese melody using yo scale (A B C E F in Western terms)

const SAKURA_BPM = 66;

/**
 * Sakura Sakura (さくらさくら) - Japanese VCV demo.
 *
 * Traditional Japanese folk song celebrating cherry blossoms.
 * Uses VCV (Vowel-Consonant-Vowel) phoneme format where each note
 * carries the preceding vowel context for smoother transitions.
 *
 * Musical structure:
 * - Time signature: 4/4
 * - Key: A minor pentatonic (yo scale)
 * - Tempo: 66 BPM (slow, contemplative)
 * - First two phrases of the song
 *
 * VCV format explanation:
 * - First note: "- sa" (no preceding vowel, uses dash prefix)
 * - Following notes: "[prev_vowel] [cv]" (e.g., "a ku" after "sa")
 */
export const SAKURA_SAKURA: DemoSong = {
  id: 'sakura-sakura',
  title: 'Sakura Sakura (さくらさくら)',
  description: 'Traditional Japanese folk song (VCV style)',
  language: 'japanese',
  recordingStyle: 'vcv',
  bpm: SAKURA_BPM,
  requiredPhonemes: [
    // VCV phonemes used in this song
    '- sa',    // Starting "sa" (no preceding vowel)
    'a ku',    // "ku" after vowel "a"
    'u ra',    // "ra" after vowel "u"
    'a sa',    // "sa" after vowel "a"
    '- ya',    // Starting "ya" for second phrase
    'a yo',    // "yo" after vowel "a"
    'o i',     // "i" after vowel "o"
    'i no',    // "no" after vowel "i"
    'o so',    // "so" after vowel "o"
    'o ra',    // "ra" after vowel "o"
    'a wa',    // "wa" after vowel "a"
  ],
  notes: createPhraseNotes([
    // Phrase 1: さくら (sa ku ra)
    // Melody: A A B (semitones: 0 0 2)
    ['- sa', 0, 1.0],      // さ - A (first note, no preceding vowel)
    ['a ku', 0, 1.0],      // く - A (preceded by "a" from "sa")
    ['u ra', 2, 1.5],      // ら - B (preceded by "u" from "ku")

    // Phrase 1 repeat: さくら (sa ku ra)
    // Melody: A A B (semitones: 0 0 2)
    ['a sa', 0, 1.0],      // さ - A (preceded by "a" from "ra")
    ['a ku', 0, 1.0],      // く - A (preceded by "a" from "sa")
    ['u ra', 2, 2.0],      // ら - B (preceded by "u" from "ku", held longer)

    // Phrase 2: やよいの (ya yo i no)
    // Melody: A B C B (semitones: 0 2 3 2)
    ['- ya', 0, 1.0],      // や - A (phrase start, fresh attack)
    ['a yo', 2, 1.0],      // よ - B (preceded by "a" from "ya")
    ['o i', 3, 1.0],       // い - C (preceded by "o" from "yo")
    ['i no', 2, 1.5],      // の - B (preceded by "i" from "i")

    // Phrase 2 continued: そらは (so ra wa)
    // Melody: A B A (semitones: 0 2 0)
    ['o so', 0, 1.0],      // そ - A (preceded by "o" from "no")
    ['o ra', 2, 1.0],      // ら - B (preceded by "o" from "so")
    ['a wa', 0, 2.5],      // は(wa) - A (preceded by "a" from "ra", phrase ending)
  ], SAKURA_BPM),
};

// =============================================================================
// Velocity Test Pattern (Japanese CV)
// =============================================================================
//
// A simple test pattern to demonstrate velocity/dynamics support.
// Plays a scale with increasing then decreasing velocity to create
// a crescendo-decrescendo effect.
//
// Phonemes: a, ka, sa, ta, na (basic Japanese CV)

const VELOCITY_TEST_BPM = 120;

/**
 * Velocity Test Pattern - Japanese CV dynamics demo.
 *
 * Simple ascending/descending pattern with varying velocity values
 * to demonstrate the dynamics system. Each note clearly increases
 * or decreases in volume.
 *
 * Musical structure:
 * - Time signature: 4/4
 * - Key: C major
 * - Tempo: 120 BPM
 * - Pattern: Crescendo up, decrescendo down
 */
export const VELOCITY_TEST: DemoSong = {
  id: 'velocity-test',
  title: 'Velocity Test Pattern',
  description: 'Crescendo/decrescendo dynamics demo',
  language: 'japanese',
  recordingStyle: 'cv',
  bpm: VELOCITY_TEST_BPM,
  requiredPhonemes: ['a', 'ka', 'sa', 'ta', 'na'],
  notes: createPhraseNotes([
    // Ascending scale with crescendo (velocity 0.2 -> 1.0)
    ['a', 0, 0.5, 0.2],      // C4 - very soft
    ['ka', 2, 0.5, 0.35],    // D4 - soft
    ['sa', 4, 0.5, 0.5],     // E4 - medium-soft
    ['ta', 5, 0.5, 0.65],    // F4 - medium
    ['na', 7, 0.5, 0.8],     // G4 - medium-loud
    ['a', 9, 0.5, 0.9],      // A4 - loud
    ['ka', 11, 0.5, 1.0],    // B4 - very loud (full velocity)
    ['sa', 12, 1.0, 1.0],    // C5 - very loud (held)

    // Descending scale with decrescendo (velocity 1.0 -> 0.2)
    ['ta', 11, 0.5, 0.9],    // B4 - loud
    ['na', 9, 0.5, 0.8],     // A4 - medium-loud
    ['a', 7, 0.5, 0.65],     // G4 - medium
    ['ka', 5, 0.5, 0.5],     // F4 - medium-soft
    ['sa', 4, 0.5, 0.35],    // E4 - soft
    ['ta', 2, 0.5, 0.25],    // D4 - very soft
    ['na', 0, 1.0, 0.2],     // C4 - very soft (held, fade out)
  ], VELOCITY_TEST_BPM),
};

// =============================================================================
// Vibrato Test Pattern (Japanese CV)
// =============================================================================
//
// A test pattern demonstrating vibrato on held notes.
// Shows different vibrato configurations: natural, subtle, dramatic, and delayed.
//
// Phonemes: a, i, u, e, o (Japanese vowels for clear vibrato demonstration)

const VIBRATO_TEST_BPM = 80;

/**
 * Vibrato Test Pattern - Demonstrates vibrato modulation on held notes.
 *
 * Four phrases demonstrating different vibrato styles:
 * 1. Natural vibrato (5 Hz, 40 cents, 300ms delay) - typical singing style
 * 2. Subtle vibrato (4 Hz, 20 cents, 200ms delay) - gentle shimmer
 * 3. Dramatic vibrato (6 Hz, 70 cents, 100ms delay) - operatic intensity
 * 4. No vibrato comparison - shows the difference
 *
 * Musical structure:
 * - Time signature: 4/4
 * - Key: C major
 * - Tempo: 80 BPM (slow to let vibrato develop)
 * - Each note held for 2 beats to demonstrate vibrato effect
 */
export const VIBRATO_TEST: DemoSong = {
  id: 'vibrato-test',
  title: 'Vibrato Test Pattern',
  description: 'Demonstrates different vibrato styles on held notes',
  language: 'japanese',
  recordingStyle: 'cv',
  bpm: VIBRATO_TEST_BPM,
  requiredPhonemes: ['a', 'i', 'u', 'e', 'o'],
  notes: createPhraseNotes([
    // Phrase 1: Natural vibrato (typical singing)
    // "a" held with standard vibrato parameters
    ['a', 0, 2.0, 1.0, { rate: 5, depth: 40, delay: 300 }],   // C4 with natural vibrato
    ['i', 2, 2.0, 1.0, { rate: 5, depth: 40, delay: 300 }],   // D4 with natural vibrato

    // Short rest (using short note)
    ['u', 4, 0.5],                                             // E4 quick transition

    // Phrase 2: Subtle vibrato (gentle shimmer)
    ['e', 5, 2.0, 1.0, { rate: 4, depth: 20, delay: 200 }],   // F4 with subtle vibrato
    ['o', 7, 2.0, 1.0, { rate: 4, depth: 20, delay: 200 }],   // G4 with subtle vibrato

    // Short rest
    ['a', 9, 0.5],                                             // A4 quick transition

    // Phrase 3: Dramatic vibrato (operatic style)
    ['i', 7, 2.0, 1.0, { rate: 6, depth: 70, delay: 100 }],   // G4 with dramatic vibrato
    ['u', 5, 2.0, 1.0, { rate: 6, depth: 70, delay: 100 }],   // F4 with dramatic vibrato

    // Short rest
    ['e', 4, 0.5],                                             // E4 quick transition

    // Phrase 4: No vibrato for comparison
    ['o', 2, 2.0],                                             // D4 no vibrato
    ['a', 0, 3.0],                                             // C4 no vibrato (final held note)
  ], VIBRATO_TEST_BPM),
};

// =============================================================================
// Exports
// =============================================================================

/**
 * All available demo songs.
 */
export const DEMO_SONGS: DemoSong[] = [TWINKLE_TWINKLE, FURUSATO, SAKURA_SAKURA, VELOCITY_TEST, VIBRATO_TEST];

/**
 * Get a demo song by its ID.
 *
 * @param id - The song ID to look up
 * @returns The matching demo song, or undefined if not found
 */
export function getDemoSong(id: string): DemoSong | undefined {
  return DEMO_SONGS.find((song) => song.id === id);
}

/**
 * Get demo songs filtered by language.
 *
 * @param language - The language to filter by
 * @returns Array of demo songs in that language
 */
export function getDemoSongsByLanguage(
  language: 'japanese' | 'english'
): DemoSong[] {
  return DEMO_SONGS.filter((song) => song.language === language);
}

/**
 * Get demo songs filtered by recording style.
 *
 * @param style - The recording style to filter by
 * @returns Array of demo songs for that style
 */
export function getDemoSongsByStyle(
  style: 'cv' | 'vcv' | 'arpasing'
): DemoSong[] {
  return DEMO_SONGS.filter((song) => song.recordingStyle === style);
}

/**
 * Common alias prefix patterns used in voicebanks.
 * Japanese CV voicebanks often use "- " prefix for consonant-vowel sounds.
 * VCV voicebanks use vowel prefixes like "a ", "i ", etc.
 */
const CV_PREFIX = '- ';
const VOWELS = ['a', 'i', 'u', 'e', 'o'];

/**
 * Parse a VCV alias into its vowel and CV components.
 *
 * VCV aliases follow the format "[vowel] [cv]" where the vowel is the
 * preceding vowel context (a, i, u, e, o) and cv is the consonant-vowel
 * or vowel being sung.
 *
 * @param alias - The alias to parse
 * @returns Object with vowel and cv parts, or null if not VCV format
 *
 * @example
 * parseVCVAlias('a sa')  // { vowel: 'a', cv: 'sa' }
 * parseVCVAlias('o i')   // { vowel: 'o', cv: 'i' }
 * parseVCVAlias('sa')    // null (not VCV format)
 * parseVCVAlias('- sa')  // null (CV prefix format, not VCV)
 */
function parseVCVAlias(alias: string): { vowel: string; cv: string } | null {
  const parts = alias.split(' ');
  if (parts.length === 2 && VOWELS.includes(parts[0])) {
    return { vowel: parts[0], cv: parts[1] };
  }
  return null;
}

/**
 * Check if a phoneme alias exists in the available aliases,
 * accounting for common voicebank alias format variations.
 *
 * Checks in order:
 * 1. Exact match (e.g., "ka")
 * 2. CV prefix format (e.g., "- ka")
 * 3. VCV format with vowel prefix (e.g., "a ka", "i ka", etc.)
 * 4. Kana conversion for romaji phonemes (e.g., "ku" -> "く")
 * 5. Romaji conversion for kana aliases (e.g., check if "ku" when phoneme is "く")
 * 6. VCV decomposition with all above fallbacks
 *
 * @param phoneme - The phoneme to look for
 * @param availableAliases - Set of available aliases
 * @param depth - Internal recursion depth tracker (prevents infinite recursion)
 * @returns true if the phoneme is available in any format
 */
function hasPhonemeAlias(phoneme: string, availableAliases: Set<string>, depth = 0): boolean {
  // Prevent infinite recursion
  if (depth > 2) {
    return false;
  }

  // Check exact match first
  if (availableAliases.has(phoneme)) {
    return true;
  }

  // Check CV prefix format (e.g., "- ka")
  if (availableAliases.has(CV_PREFIX + phoneme)) {
    return true;
  }

  // Check VCV format with vowel prefix (e.g., "a ka", "i ka")
  for (const vowel of VOWELS) {
    if (availableAliases.has(`${vowel} ${phoneme}`)) {
      return true;
    }
  }

  // Try kana conversion: if phoneme is romaji (e.g., "ku"), check for kana (e.g., "く")
  // This is crucial for VCV songs playing on CV voicebanks with hiragana aliases
  const kana = romajiToKana(phoneme);
  if (kana && kana !== phoneme) {
    // Check exact kana match
    if (availableAliases.has(kana)) {
      return true;
    }
    // Check with CV prefix (e.g., "- く")
    if (availableAliases.has(CV_PREFIX + kana)) {
      return true;
    }
  }

  // Try romaji conversion: if phoneme is kana, check romaji version
  const romaji = kanaToRomaji(phoneme);
  if (romaji && romaji !== phoneme) {
    if (availableAliases.has(romaji)) {
      return true;
    }
    if (availableAliases.has(CV_PREFIX + romaji)) {
      return true;
    }
  }

  // Try dash-prefix decomposition: if phoneme starts with "- " (e.g., "- sa"),
  // strip the prefix and check for just the CV part (e.g., "sa").
  // This allows VCV songs with dash-prefixed phonemes to play on CV voicebanks.
  if (phoneme.startsWith(CV_PREFIX)) {
    const cvPart = phoneme.slice(CV_PREFIX.length);
    if (cvPart && hasPhonemeAlias(cvPart, availableAliases, depth + 1)) {
      return true;
    }
  }

  // Try VCV decomposition: if phoneme is VCV format (e.g., "a sa"),
  // check if just the CV part (e.g., "sa") is available.
  // This allows VCV songs to show as compatible with CV voicebanks.
  const vcvParts = parseVCVAlias(phoneme);
  if (vcvParts) {
    // Recursively check for just the CV part (with kana fallback)
    if (hasPhonemeAlias(vcvParts.cv, availableAliases, depth + 1)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a voicebank has all required phonemes for a demo song.
 *
 * This function accounts for common voicebank alias format variations:
 * - Bare format: "ka", "sa"
 * - CV prefix format: "- ka", "- sa"
 * - VCV format: "a ka", "i ki"
 *
 * @param song - The demo song to check
 * @param availableAliases - Set of alias names available in the voicebank
 * @returns Object with compatibility info
 */
export function checkSongCompatibility(
  song: DemoSong,
  availableAliases: Set<string>
): {
  compatible: boolean;
  missingPhonemes: string[];
  availableCount: number;
  totalRequired: number;
} {
  const missingPhonemes: string[] = [];

  for (const phoneme of song.requiredPhonemes) {
    if (!hasPhonemeAlias(phoneme, availableAliases)) {
      missingPhonemes.push(phoneme);
    }
  }

  return {
    compatible: missingPhonemes.length === 0,
    missingPhonemes,
    availableCount: song.requiredPhonemes.length - missingPhonemes.length,
    totalRequired: song.requiredPhonemes.length,
  };
}
