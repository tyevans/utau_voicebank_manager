/**
 * Japanese phoneme family classification for CV voicebanks.
 *
 * Groups phonemes by their consonant family (row in the Japanese syllabary).
 */

import { containsKana, kanaToRomaji } from './kana-romaji.js';

export interface PhonemeFamily {
  id: string;
  label: string;
  description: string;
}

/**
 * Ordered list of Japanese phoneme families.
 * Order follows the traditional gojuon (fifty sounds) order.
 */
export const PHONEME_FAMILIES: PhonemeFamily[] = [
  { id: 'vowel', label: 'Vowels', description: 'a, i, u, e, o' },
  { id: 'k', label: 'K-row', description: 'ka, ki, ku, ke, ko' },
  { id: 's', label: 'S-row', description: 'sa, shi, su, se, so' },
  { id: 't', label: 'T-row', description: 'ta, chi, tsu, te, to' },
  { id: 'n', label: 'N-row', description: 'na, ni, nu, ne, no' },
  { id: 'h', label: 'H-row', description: 'ha, hi, fu, he, ho' },
  { id: 'm', label: 'M-row', description: 'ma, mi, mu, me, mo' },
  { id: 'y', label: 'Y-row', description: 'ya, yu, yo' },
  { id: 'r', label: 'R-row', description: 'ra, ri, ru, re, ro' },
  { id: 'w', label: 'W-row', description: 'wa, wi, we, wo' },
  { id: 'nn', label: 'N', description: 'n (nasal)' },
  { id: 'g', label: 'G-row', description: 'ga, gi, gu, ge, go (voiced K)' },
  { id: 'z', label: 'Z-row', description: 'za, ji, zu, ze, zo (voiced S)' },
  { id: 'd', label: 'D-row', description: 'da, di, du, de, do (voiced T)' },
  { id: 'b', label: 'B-row', description: 'ba, bi, bu, be, bo (voiced H)' },
  { id: 'p', label: 'P-row', description: 'pa, pi, pu, pe, po' },
  { id: 'other', label: 'Other', description: 'Unclassified samples' },
];

/**
 * Map of family ID to family info for quick lookup.
 */
export const FAMILY_MAP = new Map<string, PhonemeFamily>(
  PHONEME_FAMILIES.map((f) => [f.id, f])
);

/**
 * Classify a phoneme/alias into its consonant family.
 *
 * Handles both romaji (ka, ki, ku) and Japanese kana (か, き, く) aliases.
 *
 * @param alias - The phoneme alias (e.g., "ka", "shi", "n", "か", "し", "ん")
 * @returns The family ID (e.g., "k", "s", "nn")
 */
export function classifyPhoneme(alias: string): string {
  // Normalize: trim and remove leading dash/underscore
  let normalized = alias.trim().replace(/^[-_]+/, '');

  // Convert kana to romaji if the alias contains Japanese characters
  if (containsKana(normalized)) {
    normalized = kanaToRomaji(normalized);
  }

  // Lowercase for romaji matching
  normalized = normalized.toLowerCase();

  if (!normalized) {
    return 'other';
  }

  // Check for standalone 'n' (nasal) - must be exactly 'n' or 'nn'
  if (normalized === 'n' || normalized === 'nn') {
    return 'nn';
  }

  // Check for pure vowels (single vowel or vowel only)
  if (/^[aiueo]$/.test(normalized)) {
    return 'vowel';
  }

  // Check for special romanization patterns first (multi-character)
  // T-row special cases: chi, tsu, cha, chu, cho
  if (/^(chi|tsu|ch[aiueo]|ts[aiueo])/.test(normalized)) {
    return 't';
  }

  // S-row special cases: shi, sha, shu, sho
  if (/^(shi|sh[aiueo])/.test(normalized)) {
    return 's';
  }

  // Z-row special cases: ji, ja, ju, jo (ji can be z-row or d-row variant)
  if (/^(ji|j[aiueo])/.test(normalized)) {
    return 'z';
  }

  // H-row special case: fu (also written as hu)
  if (/^(fu|hu)/.test(normalized)) {
    return 'h';
  }

  // Get the first character for simple consonant classification
  const firstChar = normalized[0];

  // Simple consonant mappings
  const consonantMap: Record<string, string> = {
    k: 'k',
    s: 's',
    t: 't',
    n: 'n',
    h: 'h',
    f: 'h', // fu is h-row
    m: 'm',
    y: 'y',
    r: 'r',
    w: 'w',
    g: 'g',
    z: 'z',
    d: 'd',
    b: 'b',
    p: 'p',
  };

  const family = consonantMap[firstChar];
  if (family) {
    return family;
  }

  // Check if it's a vowel-starting combination (like extended vowels)
  if (/^[aiueo]/.test(normalized)) {
    return 'vowel';
  }

  return 'other';
}

/**
 * Group a list of samples by their phoneme family.
 *
 * @param samples - List of sample filenames
 * @returns Map of family ID to list of samples in that family
 */
export function groupSamplesByFamily(
  samples: string[]
): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  // Initialize all families with empty arrays to maintain order
  for (const family of PHONEME_FAMILIES) {
    groups.set(family.id, []);
  }

  for (const sample of samples) {
    // Extract alias from filename (remove .wav extension)
    const alias = sample.replace(/\.wav$/i, '');
    const familyId = classifyPhoneme(alias);

    const group = groups.get(familyId);
    if (group) {
      group.push(sample);
    } else {
      // Fallback to 'other' if family not found
      groups.get('other')?.push(sample);
    }
  }

  return groups;
}

/**
 * Get non-empty groups with their family info.
 *
 * @param samples - List of sample filenames
 * @returns Array of [family, samples] pairs for non-empty groups
 */
export function getNonEmptyGroups(
  samples: string[]
): Array<{ family: PhonemeFamily; samples: string[] }> {
  const groups = groupSamplesByFamily(samples);
  const result: Array<{ family: PhonemeFamily; samples: string[] }> = [];

  for (const family of PHONEME_FAMILIES) {
    const familySamples = groups.get(family.id);
    if (familySamples && familySamples.length > 0) {
      result.push({ family, samples: familySamples });
    }
  }

  return result;
}
