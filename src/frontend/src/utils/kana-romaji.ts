/**
 * Japanese kana to romaji conversion for UTAU voicebank processing.
 *
 * This module provides conversion from hiragana and katakana to romaji,
 * which is required for phoneme classification in the frontend.
 *
 * The romaji output follows the standard Japanese phoneme notation:
 * - Syllables like ka, ki, ku, ke, ko
 * - Special consonants: shi (not si), chi (not ti), tsu (not tu)
 *
 * Unlike the backend version, this does NOT space-separate the output
 * since the frontend classification expects contiguous romaji like "ka".
 */

/**
 * Hiragana to romaji mapping.
 * Covers all standard hiragana characters.
 */
export const HIRAGANA_TO_ROMAJI: Record<string, string> = {
  // Vowels
  'あ': 'a',
  'い': 'i',
  'う': 'u',
  'え': 'e',
  'お': 'o',
  // K-row
  'か': 'ka',
  'き': 'ki',
  'く': 'ku',
  'け': 'ke',
  'こ': 'ko',
  // S-row
  'さ': 'sa',
  'し': 'shi',
  'す': 'su',
  'せ': 'se',
  'そ': 'so',
  // T-row
  'た': 'ta',
  'ち': 'chi',
  'つ': 'tsu',
  'て': 'te',
  'と': 'to',
  // N-row
  'な': 'na',
  'に': 'ni',
  'ぬ': 'nu',
  'ね': 'ne',
  'の': 'no',
  // H-row
  'は': 'ha',
  'ひ': 'hi',
  'ふ': 'fu',
  'へ': 'he',
  'ほ': 'ho',
  // M-row
  'ま': 'ma',
  'み': 'mi',
  'む': 'mu',
  'め': 'me',
  'も': 'mo',
  // Y-row
  'や': 'ya',
  'ゆ': 'yu',
  'よ': 'yo',
  // R-row
  'ら': 'ra',
  'り': 'ri',
  'る': 'ru',
  'れ': 're',
  'ろ': 'ro',
  // W-row
  'わ': 'wa',
  'を': 'wo',
  // N
  'ん': 'n',
  // Voiced consonants (dakuten)
  // G-row
  'が': 'ga',
  'ぎ': 'gi',
  'ぐ': 'gu',
  'げ': 'ge',
  'ご': 'go',
  // Z-row
  'ざ': 'za',
  'じ': 'ji',
  'ず': 'zu',
  'ぜ': 'ze',
  'ぞ': 'zo',
  // D-row
  'だ': 'da',
  'ぢ': 'di',
  'づ': 'du',
  'で': 'de',
  'ど': 'do',
  // B-row
  'ば': 'ba',
  'び': 'bi',
  'ぶ': 'bu',
  'べ': 'be',
  'ぼ': 'bo',
  // P-row (handakuten)
  'ぱ': 'pa',
  'ぴ': 'pi',
  'ぷ': 'pu',
  'ぺ': 'pe',
  'ぽ': 'po',
  // Small kana (for combinations)
  'ぁ': 'a',
  'ぃ': 'i',
  'ぅ': 'u',
  'ぇ': 'e',
  'ぉ': 'o',
  'ゃ': 'ya',
  'ゅ': 'yu',
  'ょ': 'yo',
  'っ': 'cl', // Small tsu (geminate consonant)
  // Rare/archaic
  'ゐ': 'wi',
  'ゑ': 'we',
};

/**
 * Katakana to romaji mapping (same phonemes as hiragana).
 */
export const KATAKANA_TO_ROMAJI: Record<string, string> = {
  // Vowels
  'ア': 'a',
  'イ': 'i',
  'ウ': 'u',
  'エ': 'e',
  'オ': 'o',
  // K-row
  'カ': 'ka',
  'キ': 'ki',
  'ク': 'ku',
  'ケ': 'ke',
  'コ': 'ko',
  // S-row
  'サ': 'sa',
  'シ': 'shi',
  'ス': 'su',
  'セ': 'se',
  'ソ': 'so',
  // T-row
  'タ': 'ta',
  'チ': 'chi',
  'ツ': 'tsu',
  'テ': 'te',
  'ト': 'to',
  // N-row
  'ナ': 'na',
  'ニ': 'ni',
  'ヌ': 'nu',
  'ネ': 'ne',
  'ノ': 'no',
  // H-row
  'ハ': 'ha',
  'ヒ': 'hi',
  'フ': 'fu',
  'ヘ': 'he',
  'ホ': 'ho',
  // M-row
  'マ': 'ma',
  'ミ': 'mi',
  'ム': 'mu',
  'メ': 'me',
  'モ': 'mo',
  // Y-row
  'ヤ': 'ya',
  'ユ': 'yu',
  'ヨ': 'yo',
  // R-row
  'ラ': 'ra',
  'リ': 'ri',
  'ル': 'ru',
  'レ': 're',
  'ロ': 'ro',
  // W-row
  'ワ': 'wa',
  'ヲ': 'wo',
  // N
  'ン': 'n',
  // Voiced consonants (dakuten)
  // G-row
  'ガ': 'ga',
  'ギ': 'gi',
  'グ': 'gu',
  'ゲ': 'ge',
  'ゴ': 'go',
  // Z-row
  'ザ': 'za',
  'ジ': 'ji',
  'ズ': 'zu',
  'ゼ': 'ze',
  'ゾ': 'zo',
  // D-row
  'ダ': 'da',
  'ヂ': 'di',
  'ヅ': 'du',
  'デ': 'de',
  'ド': 'do',
  // B-row
  'バ': 'ba',
  'ビ': 'bi',
  'ブ': 'bu',
  'ベ': 'be',
  'ボ': 'bo',
  // P-row (handakuten)
  'パ': 'pa',
  'ピ': 'pi',
  'プ': 'pu',
  'ペ': 'pe',
  'ポ': 'po',
  // Small kana (for combinations)
  'ァ': 'a',
  'ィ': 'i',
  'ゥ': 'u',
  'ェ': 'e',
  'ォ': 'o',
  'ャ': 'ya',
  'ュ': 'yu',
  'ョ': 'yo',
  'ッ': 'cl', // Small tsu (geminate consonant)
  // Rare/archaic
  'ヰ': 'wi',
  'ヱ': 'we',
  // Katakana-specific extensions
  'ー': '', // Long vowel mark (handled separately)
  'ヴ': 'vu', // V-sound
};

/**
 * Combined kana combinations (must be checked before single kana).
 * These are digraph combinations with small ya/yu/yo.
 */
export const KANA_COMBINATIONS: Record<string, string> = {
  // Hiragana combinations
  'きゃ': 'kya',
  'きゅ': 'kyu',
  'きょ': 'kyo',
  'しゃ': 'sha',
  'しゅ': 'shu',
  'しょ': 'sho',
  'ちゃ': 'cha',
  'ちゅ': 'chu',
  'ちょ': 'cho',
  'にゃ': 'nya',
  'にゅ': 'nyu',
  'にょ': 'nyo',
  'ひゃ': 'hya',
  'ひゅ': 'hyu',
  'ひょ': 'hyo',
  'みゃ': 'mya',
  'みゅ': 'myu',
  'みょ': 'myo',
  'りゃ': 'rya',
  'りゅ': 'ryu',
  'りょ': 'ryo',
  'ぎゃ': 'gya',
  'ぎゅ': 'gyu',
  'ぎょ': 'gyo',
  'じゃ': 'ja',
  'じゅ': 'ju',
  'じょ': 'jo',
  'びゃ': 'bya',
  'びゅ': 'byu',
  'びょ': 'byo',
  'ぴゃ': 'pya',
  'ぴゅ': 'pyu',
  'ぴょ': 'pyo',
  // Katakana combinations
  'キャ': 'kya',
  'キュ': 'kyu',
  'キョ': 'kyo',
  'シャ': 'sha',
  'シュ': 'shu',
  'ショ': 'sho',
  'チャ': 'cha',
  'チュ': 'chu',
  'チョ': 'cho',
  'ニャ': 'nya',
  'ニュ': 'nyu',
  'ニョ': 'nyo',
  'ヒャ': 'hya',
  'ヒュ': 'hyu',
  'ヒョ': 'hyo',
  'ミャ': 'mya',
  'ミュ': 'myu',
  'ミョ': 'myo',
  'リャ': 'rya',
  'リュ': 'ryu',
  'リョ': 'ryo',
  'ギャ': 'gya',
  'ギュ': 'gyu',
  'ギョ': 'gyo',
  'ジャ': 'ja',
  'ジュ': 'ju',
  'ジョ': 'jo',
  'ビャ': 'bya',
  'ビュ': 'byu',
  'ビョ': 'byo',
  'ピャ': 'pya',
  'ピュ': 'pyu',
  'ピョ': 'pyo',
  // Extended katakana combinations (foreign sounds)
  'ティ': 'ti',
  'ディ': 'di',
  'トゥ': 'tu',
  'ドゥ': 'du',
  'ファ': 'fa',
  'フィ': 'fi',
  'フェ': 'fe',
  'フォ': 'fo',
  'ウィ': 'wi',
  'ウェ': 'we',
  'ウォ': 'wo',
  'ツァ': 'tsa',
  'ツィ': 'tsi',
  'ツェ': 'tse',
  'ツォ': 'tso',
  'チェ': 'che',
  'シェ': 'she',
  'ジェ': 'je',
};

// Merge all single kana mappings for quick lookup
const ALL_SINGLE_KANA: Record<string, string> = {
  ...HIRAGANA_TO_ROMAJI,
  ...KATAKANA_TO_ROMAJI,
};

/**
 * Romaji to hiragana mapping for CV phoneme matching.
 * Built from the reverse of HIRAGANA_TO_ROMAJI.
 */
export const ROMAJI_TO_HIRAGANA: Record<string, string> = {};

// Build reverse mapping from romaji to hiragana (prefer hiragana over katakana)
for (const [kana, romaji] of Object.entries(HIRAGANA_TO_ROMAJI)) {
  if (romaji && romaji !== 'cl') {
    // Don't overwrite if we already have an entry (keeps first hiragana match)
    if (!ROMAJI_TO_HIRAGANA[romaji]) {
      ROMAJI_TO_HIRAGANA[romaji] = kana;
    }
  }
}

// Add combination mappings (romaji -> hiragana combinations)
for (const [kana, romaji] of Object.entries(KANA_COMBINATIONS)) {
  // Only add hiragana combinations (not katakana duplicates)
  if (romaji && kana.charCodeAt(0) >= 0x3040 && kana.charCodeAt(0) <= 0x309f) {
    if (!ROMAJI_TO_HIRAGANA[romaji]) {
      ROMAJI_TO_HIRAGANA[romaji] = kana;
    }
  }
}

/**
 * Characters to skip during kana to romaji conversion.
 * These are modifiers or markers that don't represent phonemes.
 */
const SKIP_CHARACTERS = new Set([
  '\u309B', // Standalone dakuten (voiced mark)
  '\u309C', // Standalone handakuten (semi-voiced mark)
  '\uFF9E', // Halfwidth dakuten
  '\uFF9F', // Halfwidth handakuten
]);

/**
 * Check if a character is a kana character.
 *
 * @param char - Single character to check
 * @returns True if the character is hiragana or katakana
 */
function isKanaChar(char: string): boolean {
  if (char in ALL_SINGLE_KANA) {
    return true;
  }
  const cp = char.charCodeAt(0);
  // Hiragana: U+3040-U+309F
  // Katakana: U+30A0-U+30FF
  return (cp >= 0x3040 && cp <= 0x309f) || (cp >= 0x30a0 && cp <= 0x30ff);
}

/**
 * Check if text contains any Japanese kana characters.
 *
 * @param text - Text to check
 * @returns True if the text contains hiragana or katakana
 */
export function containsKana(text: string): boolean {
  for (const char of text) {
    if (isKanaChar(char)) {
      return true;
    }
  }
  return false;
}

/**
 * Convert Japanese kana (hiragana/katakana) to romaji.
 *
 * Handles both hiragana and katakana, including:
 * - Basic syllables (a -> a, ka -> ka)
 * - Voiced consonants (ga -> ga, da -> da)
 * - Combinations with small kana (sha -> sha, cho -> cho)
 * - Long vowel marks (ー extends previous vowel)
 * - Geminate consonants (っ/ッ -> cl)
 *
 * Non-kana characters (romaji, numbers, symbols) are passed through unchanged.
 *
 * Unlike the backend version, this does NOT space-separate the output
 * since the frontend phoneme classification expects contiguous romaji.
 *
 * @param text - Input text containing Japanese kana
 * @returns Romaji representation of the text (without spaces between syllables)
 *
 * @example
 * kanaToRomaji('あ')     // 'a'
 * kanaToRomaji('か')     // 'ka'
 * kanaToRomaji('しゃ')   // 'sha'
 * kanaToRomaji('ka')     // 'ka' (already romaji)
 */
export function kanaToRomaji(text: string): string {
  const result: string[] = [];
  let i = 0;

  while (i < text.length) {
    // Check for two-character combinations first
    if (i + 1 < text.length) {
      const twoChar = text.slice(i, i + 2);
      if (twoChar in KANA_COMBINATIONS) {
        result.push(KANA_COMBINATIONS[twoChar]);
        i += 2;
        continue;
      }
    }

    // Check single character
    const char = text[i];

    // Skip standalone dakuten/handakuten markers (not phonemes)
    if (SKIP_CHARACTERS.has(char)) {
      i += 1;
      continue;
    }

    // Handle long vowel mark (ー) by repeating previous vowel
    if (char === 'ー' && result.length > 0) {
      const prev = result[result.length - 1];
      if (prev && 'aiueo'.includes(prev[prev.length - 1])) {
        result.push(prev[prev.length - 1]);
      }
    } else if (char in ALL_SINGLE_KANA) {
      result.push(ALL_SINGLE_KANA[char]);
    } else {
      // Pass through non-kana characters (romaji, numbers, etc.)
      result.push(char);
    }

    i += 1;
  }

  // Join without spaces for phoneme classification
  return result.join('');
}

/**
 * Convert a romaji phoneme to its hiragana equivalent.
 *
 * This is useful for matching romaji phonemes (e.g., from VCV decomposition)
 * against CV voicebanks that use hiragana aliases.
 *
 * @param romaji - Romaji phoneme (e.g., "ka", "shi", "kya")
 * @returns Hiragana equivalent, or null if not found
 *
 * @example
 * romajiToKana('ka')   // 'か'
 * romajiToKana('shi')  // 'し'
 * romajiToKana('kya')  // 'きゃ'
 * romajiToKana('xyz')  // null (not a valid phoneme)
 */
export function romajiToKana(romaji: string): string | null {
  // Check if already kana (pass through)
  if (containsKana(romaji)) {
    return romaji;
  }

  // Normalize to lowercase
  const normalized = romaji.toLowerCase();

  // Check direct mapping
  const kana = ROMAJI_TO_HIRAGANA[normalized];
  if (kana) {
    return kana;
  }

  return null;
}
