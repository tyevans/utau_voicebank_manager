/**
 * Shared alias matching utilities for UTAU voicebank phoneme lookup.
 *
 * UTAU voicebanks store samples with aliases in various formats:
 * - Bare CV: "ka", "sa", "ta"
 * - CV prefix: "- ka", "- sa"
 * - VCV: "a ka", "i ki", "o sa"
 * - Hiragana: "\u304B", "\u3055", "\u305F"
 * - Mixed formats within a single voicebank
 *
 * These utilities provide a single implementation of the matching cascade
 * that accounts for all format variations. Multiple components need to
 * resolve aliases, so this module prevents duplication.
 *
 * @module alias-matching
 */

import type { OtoEntry } from '../services/types.js';
import { romajiToKana, kanaToRomaji } from './kana-romaji.js';

/**
 * Common CV prefix used in many Japanese voicebanks.
 * Indicates a consonant-vowel sound at the beginning of a phrase.
 */
export const CV_PREFIX = '- ';

/**
 * Japanese vowels used for VCV alias format detection.
 */
export const VOWELS = ['a', 'i', 'u', 'e', 'o'];

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
export function parseVCVAlias(alias: string): { vowel: string; cv: string } | null {
  const parts = alias.split(' ');
  if (parts.length === 2 && VOWELS.includes(parts[0])) {
    return { vowel: parts[0], cv: parts[1] };
  }
  return null;
}

/**
 * Core alias matching cascade. Checks whether a given alias exists
 * in a collection, trying common voicebank format variations.
 *
 * Checks in order:
 * 1. Exact match (e.g., "ka")
 * 2. CV prefix format (e.g., "- ka")
 * 3. VCV format with vowel prefix (e.g., "a ka", "i ka", etc.)
 * 4. Kana conversion for romaji phonemes (e.g., "ku" -> "\u304F")
 * 5. Romaji conversion for kana aliases (e.g., "\u304F" -> "ku")
 * 6. Dash-prefix decomposition (e.g., "- sa" -> try "sa")
 * 7. VCV decomposition (e.g., "a sa" -> try "sa" with all fallbacks)
 *
 * @param alias - The alias to look for
 * @param has - Function that checks if a key exists in the collection
 * @param depth - Internal recursion depth tracker (prevents infinite recursion)
 * @returns The actual alias that matched, or null if no match found
 */
function resolveAlias(
  alias: string,
  has: (key: string) => boolean,
  depth = 0
): string | null {
  // Prevent infinite recursion
  if (depth > 2) {
    return null;
  }

  // 1. Exact match
  if (has(alias)) {
    return alias;
  }

  // 2. CV prefix format (e.g., "- ka")
  const cvAlias = CV_PREFIX + alias;
  if (has(cvAlias)) {
    return cvAlias;
  }

  // 3. VCV format with vowel prefix (e.g., "a ka", "i ka")
  for (const vowel of VOWELS) {
    const vcvAlias = `${vowel} ${alias}`;
    if (has(vcvAlias)) {
      return vcvAlias;
    }
  }

  // 4. Kana conversion: romaji -> kana (e.g., "ku" -> "\u304F")
  const kana = romajiToKana(alias);
  if (kana && kana !== alias) {
    if (has(kana)) {
      return kana;
    }
    const kanaCvAlias = CV_PREFIX + kana;
    if (has(kanaCvAlias)) {
      return kanaCvAlias;
    }
  }

  // 5. Romaji conversion: kana -> romaji (e.g., "\u304F" -> "ku")
  const romaji = kanaToRomaji(alias);
  if (romaji && romaji !== alias) {
    if (has(romaji)) {
      return romaji;
    }
    const romajiCvAlias = CV_PREFIX + romaji;
    if (has(romajiCvAlias)) {
      return romajiCvAlias;
    }
  }

  // 6. Dash-prefix decomposition: "- sa" -> try "sa"
  if (alias.startsWith(CV_PREFIX)) {
    const cvPart = alias.slice(CV_PREFIX.length);
    if (cvPart) {
      const result = resolveAlias(cvPart, has, depth + 1);
      if (result) {
        return result;
      }
    }
  }

  // 7. VCV decomposition: "a sa" -> try "sa" with all fallbacks
  const vcvParts = parseVCVAlias(alias);
  if (vcvParts) {
    const result = resolveAlias(vcvParts.cv, has, depth + 1);
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Find an OtoEntry for an alias, accounting for common voicebank alias format variations.
 *
 * This is the primary entry point for components that need the full OtoEntry
 * object (e.g., for audio playback with oto parameters).
 *
 * @param alias - The alias to look for
 * @param otoMap - Map of alias to OtoEntry
 * @returns The matching OtoEntry and the actual alias used, or undefined if not found
 *
 * @example
 * const result = findOtoEntry('ka', otoMap);
 * if (result) {
 *   console.log(result.actualAlias);  // e.g., "- ka" or "a ka"
 *   console.log(result.entry.offset); // oto parameters
 * }
 */
export function findOtoEntry(
  alias: string,
  otoMap: Map<string, OtoEntry>,
): { entry: OtoEntry; actualAlias: string } | undefined {
  const matched = resolveAlias(alias, (key) => otoMap.has(key));
  if (matched) {
    const entry = otoMap.get(matched);
    if (entry) {
      return { entry, actualAlias: matched };
    }
  }
  return undefined;
}

/**
 * Find the matching alias string from a set of available aliases.
 *
 * Use this when you need to know which alias matched but don't need
 * the full OtoEntry object (e.g., for UI display or phoneme validation).
 *
 * @param alias - The alias to look for
 * @param aliasSet - Set of available alias strings
 * @returns The actual alias that matched, or null if not found
 *
 * @example
 * const aliases = new Set(['- ka', 'a sa', '\u304F']);
 * findMatchingAlias('ka', aliases);  // '- ka'
 * findMatchingAlias('ku', aliases);  // '\u304F' (via kana conversion)
 * findMatchingAlias('xyz', aliases); // null
 */
export function findMatchingAlias(
  alias: string,
  aliasSet: Set<string>,
): string | null {
  return resolveAlias(alias, (key) => aliasSet.has(key));
}

/**
 * Check if a phoneme alias exists in a set of available aliases.
 *
 * Convenience wrapper that returns a boolean. Use this for compatibility
 * checks where you only need to know if an alias is available, not which
 * specific format matched.
 *
 * @param alias - The alias to check
 * @param aliasSet - Set of available alias strings
 * @returns true if the alias is available in any format
 *
 * @example
 * const aliases = new Set(['- ka', 'a sa']);
 * hasMatchingAlias('ka', aliases);   // true (matches "- ka")
 * hasMatchingAlias('sa', aliases);   // true (matches "a sa")
 * hasMatchingAlias('xyz', aliases);  // false
 */
export function hasMatchingAlias(
  alias: string,
  aliasSet: Set<string>,
): boolean {
  return resolveAlias(alias, (key) => aliasSet.has(key)) !== null;
}
