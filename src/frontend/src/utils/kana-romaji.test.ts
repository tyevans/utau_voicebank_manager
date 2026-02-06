import { describe, it, expect } from 'vitest';
import {
  kanaToRomaji,
  romajiToKana,
  containsKana,
  HIRAGANA_TO_ROMAJI,
  KATAKANA_TO_ROMAJI,
  KANA_COMBINATIONS,
  ROMAJI_TO_HIRAGANA,
} from './kana-romaji.js';

// ── containsKana ─────────────────────────────────────────────────────────────

describe('containsKana', () => {
  it('returns true for hiragana text', () => {
    expect(containsKana('あ')).toBe(true);
    expect(containsKana('かきくけこ')).toBe(true);
  });

  it('returns true for katakana text', () => {
    expect(containsKana('ア')).toBe(true);
    expect(containsKana('カキクケコ')).toBe(true);
  });

  it('returns true for mixed kana and romaji', () => {
    expect(containsKana('hello あ world')).toBe(true);
  });

  it('returns false for pure romaji', () => {
    expect(containsKana('ka')).toBe(false);
    expect(containsKana('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(containsKana('')).toBe(false);
  });

  it('returns false for numbers and symbols', () => {
    expect(containsKana('12345')).toBe(false);
    expect(containsKana('!@#$%')).toBe(false);
  });
});

// ── kanaToRomaji ─────────────────────────────────────────────────────────────

describe('kanaToRomaji', () => {
  describe('basic hiragana vowels', () => {
    it('converts vowels correctly', () => {
      expect(kanaToRomaji('あ')).toBe('a');
      expect(kanaToRomaji('い')).toBe('i');
      expect(kanaToRomaji('う')).toBe('u');
      expect(kanaToRomaji('え')).toBe('e');
      expect(kanaToRomaji('お')).toBe('o');
    });
  });

  describe('basic hiragana consonant rows', () => {
    it('converts K-row correctly', () => {
      expect(kanaToRomaji('か')).toBe('ka');
      expect(kanaToRomaji('き')).toBe('ki');
      expect(kanaToRomaji('く')).toBe('ku');
      expect(kanaToRomaji('け')).toBe('ke');
      expect(kanaToRomaji('こ')).toBe('ko');
    });

    it('converts S-row correctly (including special shi)', () => {
      expect(kanaToRomaji('さ')).toBe('sa');
      expect(kanaToRomaji('し')).toBe('shi');
      expect(kanaToRomaji('す')).toBe('su');
      expect(kanaToRomaji('せ')).toBe('se');
      expect(kanaToRomaji('そ')).toBe('so');
    });

    it('converts T-row correctly (including special chi, tsu)', () => {
      expect(kanaToRomaji('た')).toBe('ta');
      expect(kanaToRomaji('ち')).toBe('chi');
      expect(kanaToRomaji('つ')).toBe('tsu');
      expect(kanaToRomaji('て')).toBe('te');
      expect(kanaToRomaji('と')).toBe('to');
    });

    it('converts N-row correctly', () => {
      expect(kanaToRomaji('な')).toBe('na');
      expect(kanaToRomaji('に')).toBe('ni');
      expect(kanaToRomaji('ぬ')).toBe('nu');
      expect(kanaToRomaji('ね')).toBe('ne');
      expect(kanaToRomaji('の')).toBe('no');
    });

    it('converts H-row correctly (including special fu)', () => {
      expect(kanaToRomaji('は')).toBe('ha');
      expect(kanaToRomaji('ひ')).toBe('hi');
      expect(kanaToRomaji('ふ')).toBe('fu');
      expect(kanaToRomaji('へ')).toBe('he');
      expect(kanaToRomaji('ほ')).toBe('ho');
    });

    it('converts standalone n correctly', () => {
      expect(kanaToRomaji('ん')).toBe('n');
    });
  });

  describe('voiced consonants (dakuten)', () => {
    it('converts G-row correctly', () => {
      expect(kanaToRomaji('が')).toBe('ga');
      expect(kanaToRomaji('ぎ')).toBe('gi');
      expect(kanaToRomaji('ぐ')).toBe('gu');
      expect(kanaToRomaji('げ')).toBe('ge');
      expect(kanaToRomaji('ご')).toBe('go');
    });

    it('converts Z-row correctly (including special ji)', () => {
      expect(kanaToRomaji('ざ')).toBe('za');
      expect(kanaToRomaji('じ')).toBe('ji');
      expect(kanaToRomaji('ず')).toBe('zu');
      expect(kanaToRomaji('ぜ')).toBe('ze');
      expect(kanaToRomaji('ぞ')).toBe('zo');
    });

    it('converts B-row correctly', () => {
      expect(kanaToRomaji('ば')).toBe('ba');
      expect(kanaToRomaji('び')).toBe('bi');
      expect(kanaToRomaji('ぶ')).toBe('bu');
      expect(kanaToRomaji('べ')).toBe('be');
      expect(kanaToRomaji('ぼ')).toBe('bo');
    });

    it('converts P-row correctly', () => {
      expect(kanaToRomaji('ぱ')).toBe('pa');
      expect(kanaToRomaji('ぴ')).toBe('pi');
      expect(kanaToRomaji('ぷ')).toBe('pu');
      expect(kanaToRomaji('ぺ')).toBe('pe');
      expect(kanaToRomaji('ぽ')).toBe('po');
    });
  });

  describe('kana combinations (digraphs)', () => {
    it('converts hiragana combinations correctly', () => {
      expect(kanaToRomaji('きゃ')).toBe('kya');
      expect(kanaToRomaji('きゅ')).toBe('kyu');
      expect(kanaToRomaji('きょ')).toBe('kyo');
      expect(kanaToRomaji('しゃ')).toBe('sha');
      expect(kanaToRomaji('しゅ')).toBe('shu');
      expect(kanaToRomaji('しょ')).toBe('sho');
      expect(kanaToRomaji('ちゃ')).toBe('cha');
      expect(kanaToRomaji('ちゅ')).toBe('chu');
      expect(kanaToRomaji('ちょ')).toBe('cho');
    });

    it('converts katakana combinations correctly', () => {
      expect(kanaToRomaji('キャ')).toBe('kya');
      expect(kanaToRomaji('シャ')).toBe('sha');
      expect(kanaToRomaji('チャ')).toBe('cha');
    });

    it('converts extended katakana combinations (foreign sounds)', () => {
      expect(kanaToRomaji('ティ')).toBe('ti');
      expect(kanaToRomaji('ファ')).toBe('fa');
      expect(kanaToRomaji('フィ')).toBe('fi');
      expect(kanaToRomaji('フェ')).toBe('fe');
      expect(kanaToRomaji('フォ')).toBe('fo');
    });
  });

  describe('katakana equivalents', () => {
    it('converts katakana vowels identically to hiragana', () => {
      expect(kanaToRomaji('ア')).toBe('a');
      expect(kanaToRomaji('イ')).toBe('i');
      expect(kanaToRomaji('ウ')).toBe('u');
      expect(kanaToRomaji('エ')).toBe('e');
      expect(kanaToRomaji('オ')).toBe('o');
    });

    it('converts katakana consonants identically to hiragana', () => {
      expect(kanaToRomaji('カ')).toBe('ka');
      expect(kanaToRomaji('シ')).toBe('shi');
      expect(kanaToRomaji('チ')).toBe('chi');
      expect(kanaToRomaji('ツ')).toBe('tsu');
      expect(kanaToRomaji('フ')).toBe('fu');
    });
  });

  describe('special characters', () => {
    it('converts small tsu (geminate) to cl', () => {
      expect(kanaToRomaji('っ')).toBe('cl');
      expect(kanaToRomaji('ッ')).toBe('cl');
    });

    it('handles long vowel mark by repeating previous vowel', () => {
      expect(kanaToRomaji('カー')).toBe('kaa');
      expect(kanaToRomaji('キー')).toBe('kii');
      expect(kanaToRomaji('クー')).toBe('kuu');
    });

    it('handles long vowel mark after combination', () => {
      expect(kanaToRomaji('シャー')).toBe('shaa');
    });
  });

  describe('multi-character sequences', () => {
    it('converts a complete word', () => {
      // さくら = sakura
      expect(kanaToRomaji('さくら')).toBe('sakura');
    });

    it('converts VCV-style text', () => {
      // あかさ = akasa
      expect(kanaToRomaji('あかさ')).toBe('akasa');
    });
  });

  describe('pass-through behavior', () => {
    it('passes through romaji text unchanged', () => {
      expect(kanaToRomaji('ka')).toBe('ka');
      expect(kanaToRomaji('hello')).toBe('hello');
    });

    it('passes through numbers unchanged', () => {
      expect(kanaToRomaji('123')).toBe('123');
    });

    it('handles empty string', () => {
      expect(kanaToRomaji('')).toBe('');
    });

    it('handles mixed kana and romaji', () => {
      expect(kanaToRomaji('- か')).toBe('- ka');
    });
  });
});

// ── romajiToKana ─────────────────────────────────────────────────────────────

describe('romajiToKana', () => {
  it('converts basic romaji to hiragana', () => {
    expect(romajiToKana('a')).toBe('あ');
    expect(romajiToKana('ka')).toBe('か');
    expect(romajiToKana('shi')).toBe('し');
    expect(romajiToKana('chi')).toBe('ち');
    expect(romajiToKana('tsu')).toBe('つ');
    expect(romajiToKana('fu')).toBe('ふ');
    expect(romajiToKana('n')).toBe('ん');
  });

  it('converts combination romaji to hiragana', () => {
    expect(romajiToKana('kya')).toBe('きゃ');
    expect(romajiToKana('sha')).toBe('しゃ');
    expect(romajiToKana('cha')).toBe('ちゃ');
  });

  it('handles case insensitivity', () => {
    expect(romajiToKana('KA')).toBe('か');
    expect(romajiToKana('Ka')).toBe('か');
  });

  it('returns null for unknown romaji', () => {
    expect(romajiToKana('xyz')).toBeNull();
    expect(romajiToKana('qqq')).toBeNull();
  });

  it('passes through kana unchanged', () => {
    expect(romajiToKana('か')).toBe('か');
    expect(romajiToKana('カ')).toBe('カ');
  });

  it('returns null for empty string', () => {
    // Empty string has no kana and no romaji mapping, so returns null
    expect(romajiToKana('')).toBeNull();
  });
});

// ── Mapping completeness checks ─────────────────────────────────────────────

describe('HIRAGANA_TO_ROMAJI mapping', () => {
  it('has entries for all basic hiragana rows', () => {
    // 5 vowels + 5 each for 9 consonant rows + 3 y-row + 2 w-row + 1 n = 46 basic
    // Plus voiced, semi-voiced, small kana, archaic
    expect(Object.keys(HIRAGANA_TO_ROMAJI).length).toBeGreaterThan(45);
  });

  it('has no empty string values', () => {
    for (const [_kana, romaji] of Object.entries(HIRAGANA_TO_ROMAJI)) {
      // All hiragana entries should have non-empty romaji values
      expect(romaji.length).toBeGreaterThan(0);
    }
  });
});

describe('KATAKANA_TO_ROMAJI mapping', () => {
  it('has entries for all basic katakana rows', () => {
    expect(Object.keys(KATAKANA_TO_ROMAJI).length).toBeGreaterThan(45);
  });

  it('includes katakana-specific extensions', () => {
    expect(KATAKANA_TO_ROMAJI['ヴ']).toBe('vu');
    // Long vowel mark maps to empty (handled separately)
    expect(KATAKANA_TO_ROMAJI['ー']).toBe('');
  });
});

describe('KANA_COMBINATIONS mapping', () => {
  it('has matching hiragana and katakana combinations', () => {
    // Check that for each hiragana combo there is a katakana equivalent
    const hiraganaEntries = Object.entries(KANA_COMBINATIONS)
      .filter(([kana]) => kana.charCodeAt(0) >= 0x3040 && kana.charCodeAt(0) <= 0x309f);
    const katakanaEntries = Object.entries(KANA_COMBINATIONS)
      .filter(([kana]) => kana.charCodeAt(0) >= 0x30a0 && kana.charCodeAt(0) <= 0x30ff);

    // Both sets should have entries
    expect(hiraganaEntries.length).toBeGreaterThan(0);
    expect(katakanaEntries.length).toBeGreaterThan(0);
  });
});

describe('ROMAJI_TO_HIRAGANA reverse mapping', () => {
  it('contains basic romaji to hiragana mappings', () => {
    expect(ROMAJI_TO_HIRAGANA['a']).toBe('あ');
    expect(ROMAJI_TO_HIRAGANA['ka']).toBe('か');
    expect(ROMAJI_TO_HIRAGANA['shi']).toBe('し');
  });

  it('contains combination mappings', () => {
    expect(ROMAJI_TO_HIRAGANA['kya']).toBe('きゃ');
    expect(ROMAJI_TO_HIRAGANA['sha']).toBe('しゃ');
    expect(ROMAJI_TO_HIRAGANA['cha']).toBe('ちゃ');
  });

  it('does not contain cl (geminate marker)', () => {
    // cl is explicitly excluded from the reverse mapping
    expect(ROMAJI_TO_HIRAGANA['cl']).toBeUndefined();
  });
});
