import { describe, it, expect } from 'vitest';
import {
  parseVCVAlias,
  findMatchingAlias,
  hasMatchingAlias,
  findOtoEntry,
  CV_PREFIX,
  VOWELS,
} from './alias-matching.js';
import type { OtoEntry } from '../services/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

describe('CV_PREFIX', () => {
  it('is "- "', () => {
    expect(CV_PREFIX).toBe('- ');
  });
});

describe('VOWELS', () => {
  it('contains the five Japanese vowels', () => {
    expect(VOWELS).toEqual(['a', 'i', 'u', 'e', 'o']);
  });
});

// ── parseVCVAlias ────────────────────────────────────────────────────────────

describe('parseVCVAlias', () => {
  it('parses standard VCV alias "a sa"', () => {
    const result = parseVCVAlias('a sa');
    expect(result).toEqual({ vowel: 'a', cv: 'sa' });
  });

  it('parses VCV alias with each vowel', () => {
    expect(parseVCVAlias('a ka')).toEqual({ vowel: 'a', cv: 'ka' });
    expect(parseVCVAlias('i ki')).toEqual({ vowel: 'i', cv: 'ki' });
    expect(parseVCVAlias('u ku')).toEqual({ vowel: 'u', cv: 'ku' });
    expect(parseVCVAlias('e ke')).toEqual({ vowel: 'e', cv: 'ke' });
    expect(parseVCVAlias('o ko')).toEqual({ vowel: 'o', cv: 'ko' });
  });

  it('parses VCV alias where CV part is a single vowel', () => {
    const result = parseVCVAlias('o i');
    expect(result).toEqual({ vowel: 'o', cv: 'i' });
  });

  it('returns null for bare CV alias', () => {
    expect(parseVCVAlias('sa')).toBeNull();
    expect(parseVCVAlias('ka')).toBeNull();
  });

  it('returns null for CV prefix format', () => {
    expect(parseVCVAlias('- sa')).toBeNull();
  });

  it('returns null for non-vowel first part', () => {
    expect(parseVCVAlias('k sa')).toBeNull();
    expect(parseVCVAlias('x ka')).toBeNull();
  });

  it('returns null for three or more parts', () => {
    expect(parseVCVAlias('a ka sa')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseVCVAlias('')).toBeNull();
  });
});

// ── findMatchingAlias ────────────────────────────────────────────────────────

describe('findMatchingAlias', () => {
  it('finds exact match', () => {
    const aliases = new Set(['ka', 'sa', 'ta']);
    expect(findMatchingAlias('ka', aliases)).toBe('ka');
  });

  it('finds CV prefix match when exact fails', () => {
    const aliases = new Set(['- ka', '- sa', '- ta']);
    expect(findMatchingAlias('ka', aliases)).toBe('- ka');
  });

  it('finds VCV match when exact and CV prefix fail', () => {
    const aliases = new Set(['a ka', 'i ki', 'u ku']);
    expect(findMatchingAlias('ka', aliases)).toBe('a ka');
  });

  it('finds kana match from romaji input', () => {
    const aliases = new Set(['か', 'さ', 'た']);
    expect(findMatchingAlias('ka', aliases)).toBe('か');
  });

  it('finds romaji match from kana input', () => {
    const aliases = new Set(['ka', 'sa', 'ta']);
    expect(findMatchingAlias('か', aliases)).toBe('ka');
  });

  it('finds CV-prefix kana match from romaji input', () => {
    const aliases = new Set(['- か', '- さ']);
    expect(findMatchingAlias('ka', aliases)).toBe('- か');
  });

  it('finds CV-prefix romaji match from kana input', () => {
    const aliases = new Set(['- ka', '- sa']);
    expect(findMatchingAlias('か', aliases)).toBe('- ka');
  });

  it('decomposes dash-prefix and tries fallbacks', () => {
    // "- sa" -> try "sa", which is an exact match
    const aliases = new Set(['sa', 'ta']);
    expect(findMatchingAlias('- sa', aliases)).toBe('sa');
  });

  it('decomposes VCV and tries fallbacks', () => {
    // "a sa" -> extract cv part "sa" -> exact match
    const aliases = new Set(['sa', 'ta']);
    expect(findMatchingAlias('a sa', aliases)).toBe('sa');
  });

  it('returns null when no match is found', () => {
    const aliases = new Set(['ka', 'sa', 'ta']);
    expect(findMatchingAlias('xyz', aliases)).toBeNull();
  });

  it('returns null for empty alias set', () => {
    const aliases = new Set<string>();
    expect(findMatchingAlias('ka', aliases)).toBeNull();
  });

  it('prefers exact match over CV prefix', () => {
    const aliases = new Set(['ka', '- ka']);
    expect(findMatchingAlias('ka', aliases)).toBe('ka');
  });
});

// ── hasMatchingAlias ─────────────────────────────────────────────────────────

describe('hasMatchingAlias', () => {
  it('returns true for exact match', () => {
    const aliases = new Set(['ka', 'sa']);
    expect(hasMatchingAlias('ka', aliases)).toBe(true);
  });

  it('returns true for CV prefix match', () => {
    const aliases = new Set(['- ka']);
    expect(hasMatchingAlias('ka', aliases)).toBe(true);
  });

  it('returns true for VCV match', () => {
    const aliases = new Set(['a ka']);
    expect(hasMatchingAlias('ka', aliases)).toBe(true);
  });

  it('returns true for kana conversion match', () => {
    const aliases = new Set(['か']);
    expect(hasMatchingAlias('ka', aliases)).toBe(true);
  });

  it('returns false when not found', () => {
    const aliases = new Set(['ka', 'sa']);
    expect(hasMatchingAlias('xyz', aliases)).toBe(false);
  });
});

// ── findOtoEntry ─────────────────────────────────────────────────────────────

describe('findOtoEntry', () => {
  function makeEntry(alias: string): OtoEntry {
    return {
      filename: `_${alias.replace(/[- ]/g, '')}.wav`,
      alias,
      offset: 45,
      consonant: 120,
      cutoff: -140,
      preutterance: 80,
      overlap: 15,
    };
  }

  it('finds entry by exact alias', () => {
    const otoMap = new Map<string, OtoEntry>([
      ['ka', makeEntry('ka')],
      ['sa', makeEntry('sa')],
    ]);

    const result = findOtoEntry('ka', otoMap);
    expect(result).toBeDefined();
    expect(result!.actualAlias).toBe('ka');
    expect(result!.entry.alias).toBe('ka');
  });

  it('finds entry by CV prefix fallback', () => {
    const otoMap = new Map<string, OtoEntry>([
      ['- ka', makeEntry('- ka')],
    ]);

    const result = findOtoEntry('ka', otoMap);
    expect(result).toBeDefined();
    expect(result!.actualAlias).toBe('- ka');
  });

  it('finds entry by kana conversion', () => {
    const otoMap = new Map<string, OtoEntry>([
      ['か', makeEntry('か')],
    ]);

    const result = findOtoEntry('ka', otoMap);
    expect(result).toBeDefined();
    expect(result!.actualAlias).toBe('か');
  });

  it('returns undefined when not found', () => {
    const otoMap = new Map<string, OtoEntry>([
      ['ka', makeEntry('ka')],
    ]);

    expect(findOtoEntry('xyz', otoMap)).toBeUndefined();
  });

  it('returns undefined for empty oto map', () => {
    const otoMap = new Map<string, OtoEntry>();
    expect(findOtoEntry('ka', otoMap)).toBeUndefined();
  });

  it('returns the full OtoEntry with all timing parameters', () => {
    const entry = makeEntry('ka');
    const otoMap = new Map<string, OtoEntry>([['ka', entry]]);

    const result = findOtoEntry('ka', otoMap);
    expect(result).toBeDefined();
    expect(result!.entry.offset).toBe(45);
    expect(result!.entry.consonant).toBe(120);
    expect(result!.entry.cutoff).toBe(-140);
    expect(result!.entry.preutterance).toBe(80);
    expect(result!.entry.overlap).toBe(15);
  });
});
