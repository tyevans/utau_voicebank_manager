import { describe, it, expect } from 'vitest';
import {
  classifyPhoneme,
  groupSamplesByFamily,
  getNonEmptyGroups,
  PHONEME_FAMILIES,
  FAMILY_MAP,
} from './phoneme-groups.js';

// ── PHONEME_FAMILIES constant ────────────────────────────────────────────────

describe('PHONEME_FAMILIES', () => {
  it('contains all expected families in order', () => {
    const ids = PHONEME_FAMILIES.map((f) => f.id);
    expect(ids).toEqual([
      'vowel', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w',
      'nn', 'g', 'z', 'd', 'b', 'p', 'other',
    ]);
  });

  it('has label and description for every family', () => {
    for (const family of PHONEME_FAMILIES) {
      expect(family.label).toBeTruthy();
      expect(family.description).toBeTruthy();
    }
  });
});

describe('FAMILY_MAP', () => {
  it('is a Map with the same size as PHONEME_FAMILIES', () => {
    expect(FAMILY_MAP.size).toBe(PHONEME_FAMILIES.length);
  });

  it('can look up a family by ID', () => {
    const kFamily = FAMILY_MAP.get('k');
    expect(kFamily).toBeDefined();
    expect(kFamily!.label).toBe('K-row');
  });
});

// ── classifyPhoneme ──────────────────────────────────────────────────────────

describe('classifyPhoneme', () => {
  describe('vowels', () => {
    it('classifies single vowels', () => {
      expect(classifyPhoneme('a')).toBe('vowel');
      expect(classifyPhoneme('i')).toBe('vowel');
      expect(classifyPhoneme('u')).toBe('vowel');
      expect(classifyPhoneme('e')).toBe('vowel');
      expect(classifyPhoneme('o')).toBe('vowel');
    });

    it('classifies uppercase vowels', () => {
      expect(classifyPhoneme('A')).toBe('vowel');
      expect(classifyPhoneme('I')).toBe('vowel');
    });
  });

  describe('basic consonant rows', () => {
    it('classifies K-row', () => {
      expect(classifyPhoneme('ka')).toBe('k');
      expect(classifyPhoneme('ki')).toBe('k');
      expect(classifyPhoneme('ku')).toBe('k');
      expect(classifyPhoneme('ke')).toBe('k');
      expect(classifyPhoneme('ko')).toBe('k');
    });

    it('classifies S-row (including shi)', () => {
      expect(classifyPhoneme('sa')).toBe('s');
      expect(classifyPhoneme('shi')).toBe('s');
      expect(classifyPhoneme('su')).toBe('s');
      expect(classifyPhoneme('se')).toBe('s');
      expect(classifyPhoneme('so')).toBe('s');
    });

    it('classifies T-row (including chi, tsu)', () => {
      expect(classifyPhoneme('ta')).toBe('t');
      expect(classifyPhoneme('chi')).toBe('t');
      expect(classifyPhoneme('tsu')).toBe('t');
      expect(classifyPhoneme('te')).toBe('t');
      expect(classifyPhoneme('to')).toBe('t');
    });

    it('classifies N-row', () => {
      expect(classifyPhoneme('na')).toBe('n');
      expect(classifyPhoneme('ni')).toBe('n');
      expect(classifyPhoneme('nu')).toBe('n');
      expect(classifyPhoneme('ne')).toBe('n');
      expect(classifyPhoneme('no')).toBe('n');
    });

    it('classifies H-row (including fu)', () => {
      expect(classifyPhoneme('ha')).toBe('h');
      expect(classifyPhoneme('hi')).toBe('h');
      expect(classifyPhoneme('fu')).toBe('h');
      expect(classifyPhoneme('he')).toBe('h');
      expect(classifyPhoneme('ho')).toBe('h');
    });

    it('classifies M-row', () => {
      expect(classifyPhoneme('ma')).toBe('m');
      expect(classifyPhoneme('mi')).toBe('m');
      expect(classifyPhoneme('mu')).toBe('m');
    });

    it('classifies Y-row', () => {
      expect(classifyPhoneme('ya')).toBe('y');
      expect(classifyPhoneme('yu')).toBe('y');
      expect(classifyPhoneme('yo')).toBe('y');
    });

    it('classifies R-row', () => {
      expect(classifyPhoneme('ra')).toBe('r');
      expect(classifyPhoneme('ri')).toBe('r');
      expect(classifyPhoneme('ru')).toBe('r');
      expect(classifyPhoneme('re')).toBe('r');
      expect(classifyPhoneme('ro')).toBe('r');
    });

    it('classifies W-row', () => {
      expect(classifyPhoneme('wa')).toBe('w');
      expect(classifyPhoneme('wo')).toBe('w');
    });
  });

  describe('standalone n', () => {
    it('classifies "n" as nasal nn', () => {
      expect(classifyPhoneme('n')).toBe('nn');
    });

    it('classifies "nn" as nasal nn', () => {
      expect(classifyPhoneme('nn')).toBe('nn');
    });
  });

  describe('voiced consonants', () => {
    it('classifies G-row', () => {
      expect(classifyPhoneme('ga')).toBe('g');
      expect(classifyPhoneme('gi')).toBe('g');
      expect(classifyPhoneme('gu')).toBe('g');
    });

    it('classifies Z-row (including ji)', () => {
      expect(classifyPhoneme('za')).toBe('z');
      expect(classifyPhoneme('ji')).toBe('z');
      expect(classifyPhoneme('zu')).toBe('z');
    });

    it('classifies D-row', () => {
      expect(classifyPhoneme('da')).toBe('d');
      expect(classifyPhoneme('de')).toBe('d');
      expect(classifyPhoneme('do')).toBe('d');
    });

    it('classifies B-row', () => {
      expect(classifyPhoneme('ba')).toBe('b');
      expect(classifyPhoneme('bi')).toBe('b');
      expect(classifyPhoneme('bu')).toBe('b');
    });

    it('classifies P-row', () => {
      expect(classifyPhoneme('pa')).toBe('p');
      expect(classifyPhoneme('pi')).toBe('p');
      expect(classifyPhoneme('pu')).toBe('p');
    });
  });

  describe('combination sounds', () => {
    it('classifies sha/shu/sho as S-row', () => {
      expect(classifyPhoneme('sha')).toBe('s');
      expect(classifyPhoneme('shu')).toBe('s');
      expect(classifyPhoneme('sho')).toBe('s');
    });

    it('classifies cha/chu/cho as T-row', () => {
      expect(classifyPhoneme('cha')).toBe('t');
      expect(classifyPhoneme('chu')).toBe('t');
      expect(classifyPhoneme('cho')).toBe('t');
    });

    it('classifies ja/ju/jo as Z-row', () => {
      expect(classifyPhoneme('ja')).toBe('z');
      expect(classifyPhoneme('ju')).toBe('z');
      expect(classifyPhoneme('jo')).toBe('z');
    });

    it('classifies tsa/tsi/tse/tso as T-row', () => {
      expect(classifyPhoneme('tsa')).toBe('t');
      expect(classifyPhoneme('tsi')).toBe('t');
    });
  });

  describe('kana input', () => {
    it('classifies hiragana through kana conversion', () => {
      expect(classifyPhoneme('か')).toBe('k');
      expect(classifyPhoneme('さ')).toBe('s');
      expect(classifyPhoneme('し')).toBe('s');
      expect(classifyPhoneme('た')).toBe('t');
      expect(classifyPhoneme('ち')).toBe('t');
      expect(classifyPhoneme('は')).toBe('h');
      expect(classifyPhoneme('ふ')).toBe('h');
    });

    it('classifies katakana through kana conversion', () => {
      expect(classifyPhoneme('カ')).toBe('k');
      expect(classifyPhoneme('サ')).toBe('s');
    });

    it('classifies kana vowels', () => {
      expect(classifyPhoneme('あ')).toBe('vowel');
      expect(classifyPhoneme('い')).toBe('vowel');
      expect(classifyPhoneme('ア')).toBe('vowel');
    });

    it('classifies kana n as nasal', () => {
      expect(classifyPhoneme('ん')).toBe('nn');
      expect(classifyPhoneme('ン')).toBe('nn');
    });
  });

  describe('prefix handling', () => {
    it('strips leading dash', () => {
      expect(classifyPhoneme('-ka')).toBe('k');
    });

    it('strips leading underscore', () => {
      expect(classifyPhoneme('_ka')).toBe('k');
    });

    it('handles whitespace trimming', () => {
      expect(classifyPhoneme('  ka  ')).toBe('k');
    });
  });

  describe('edge cases', () => {
    it('returns "other" for empty string', () => {
      expect(classifyPhoneme('')).toBe('other');
    });

    it('returns "other" for unrecognized phonemes', () => {
      expect(classifyPhoneme('xyz')).toBe('other');
    });

    it('classifies hu as H-row (alternate fu romanization)', () => {
      expect(classifyPhoneme('hu')).toBe('h');
    });

    it('classifies f-prefix as H-row', () => {
      expect(classifyPhoneme('fa')).toBe('h');
    });
  });
});

// ── groupSamplesByFamily ─────────────────────────────────────────────────────

describe('groupSamplesByFamily', () => {
  it('groups samples by consonant family', () => {
    const samples = ['ka.wav', 'ki.wav', 'sa.wav', 'a.wav', 'n.wav'];
    const groups = groupSamplesByFamily(samples);

    expect(groups.get('k')).toEqual(['ka.wav', 'ki.wav']);
    expect(groups.get('s')).toEqual(['sa.wav']);
    expect(groups.get('vowel')).toEqual(['a.wav']);
    expect(groups.get('nn')).toEqual(['n.wav']);
  });

  it('initializes all families even if empty', () => {
    const samples = ['ka.wav'];
    const groups = groupSamplesByFamily(samples);

    // All families should be present
    for (const family of PHONEME_FAMILIES) {
      expect(groups.has(family.id)).toBe(true);
    }
  });

  it('handles empty input', () => {
    const groups = groupSamplesByFamily([]);

    // All families should exist but be empty
    for (const family of PHONEME_FAMILIES) {
      expect(groups.get(family.id)).toEqual([]);
    }
  });

  it('strips .wav extension for classification', () => {
    const samples = ['shi.wav', 'chi.wav', 'tsu.wav'];
    const groups = groupSamplesByFamily(samples);

    expect(groups.get('s')).toEqual(['shi.wav']);
    expect(groups.get('t')).toEqual(['chi.wav', 'tsu.wav']);
  });

  it('puts unrecognized samples in "other"', () => {
    const samples = ['xyz.wav', 'qqq.wav'];
    const groups = groupSamplesByFamily(samples);

    expect(groups.get('other')).toEqual(['xyz.wav', 'qqq.wav']);
  });
});

// ── getNonEmptyGroups ────────────────────────────────────────────────────────

describe('getNonEmptyGroups', () => {
  it('returns only groups with samples', () => {
    const samples = ['ka.wav', 'sa.wav', 'a.wav'];
    const groups = getNonEmptyGroups(samples);

    const familyIds = groups.map((g) => g.family.id);
    expect(familyIds).toContain('k');
    expect(familyIds).toContain('s');
    expect(familyIds).toContain('vowel');
    // Should NOT contain families without any samples
    expect(familyIds).not.toContain('m');
    expect(familyIds).not.toContain('other');
  });

  it('returns empty array for no samples', () => {
    expect(getNonEmptyGroups([])).toEqual([]);
  });

  it('preserves family ordering from PHONEME_FAMILIES', () => {
    // vowel should come before k, k before s, etc.
    const samples = ['sa.wav', 'ka.wav', 'a.wav'];
    const groups = getNonEmptyGroups(samples);
    const familyIds = groups.map((g) => g.family.id);

    expect(familyIds.indexOf('vowel')).toBeLessThan(familyIds.indexOf('k'));
    expect(familyIds.indexOf('k')).toBeLessThan(familyIds.indexOf('s'));
  });

  it('includes full PhonemeFamily info', () => {
    const samples = ['ka.wav'];
    const groups = getNonEmptyGroups(samples);

    expect(groups.length).toBe(1);
    expect(groups[0].family.id).toBe('k');
    expect(groups[0].family.label).toBe('K-row');
    expect(groups[0].family.description).toBeTruthy();
    expect(groups[0].samples).toEqual(['ka.wav']);
  });
});
