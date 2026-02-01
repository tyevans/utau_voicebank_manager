"""Japanese kana to romaji conversion for UTAU voicebank processing.

This module provides conversion from hiragana and katakana to romaji,
which is required for SOFA forced alignment since the dictionary uses
romaji phoneme notation.

The romaji output follows the standard Japanese phoneme notation used
in UTAU voicebanks and SOFA dictionaries:
- Syllables like ka, ki, ku, ke, ko
- Special consonants: shi (not si), chi (not ti), tsu (not tu)
- Long vowels are represented by repeating the vowel or with "ー"
"""

# Hiragana to romaji mapping
# Covers all standard hiragana characters
HIRAGANA_TO_ROMAJI: dict[str, str] = {
    # Vowels
    "あ": "a",
    "い": "i",
    "う": "u",
    "え": "e",
    "お": "o",
    # K-row
    "か": "ka",
    "き": "ki",
    "く": "ku",
    "け": "ke",
    "こ": "ko",
    # S-row
    "さ": "sa",
    "し": "shi",
    "す": "su",
    "せ": "se",
    "そ": "so",
    # T-row
    "た": "ta",
    "ち": "chi",
    "つ": "tsu",
    "て": "te",
    "と": "to",
    # N-row
    "な": "na",
    "に": "ni",
    "ぬ": "nu",
    "ね": "ne",
    "の": "no",
    # H-row
    "は": "ha",
    "ひ": "hi",
    "ふ": "fu",
    "へ": "he",
    "ほ": "ho",
    # M-row
    "ま": "ma",
    "み": "mi",
    "む": "mu",
    "め": "me",
    "も": "mo",
    # Y-row
    "や": "ya",
    "ゆ": "yu",
    "よ": "yo",
    # R-row
    "ら": "ra",
    "り": "ri",
    "る": "ru",
    "れ": "re",
    "ろ": "ro",
    # W-row
    "わ": "wa",
    "を": "wo",
    # N
    "ん": "N",
    # Voiced consonants (dakuten)
    # G-row
    "が": "ga",
    "ぎ": "gi",
    "ぐ": "gu",
    "げ": "ge",
    "ご": "go",
    # Z-row
    "ざ": "za",
    "じ": "ji",
    "ず": "zu",
    "ぜ": "ze",
    "ぞ": "zo",
    # D-row
    "だ": "da",
    "ぢ": "di",
    "づ": "du",
    "で": "de",
    "ど": "do",
    # B-row
    "ば": "ba",
    "び": "bi",
    "ぶ": "bu",
    "べ": "be",
    "ぼ": "bo",
    # P-row (handakuten)
    "ぱ": "pa",
    "ぴ": "pi",
    "ぷ": "pu",
    "ぺ": "pe",
    "ぽ": "po",
    # Small kana (for combinations)
    "ぁ": "a",
    "ぃ": "i",
    "ぅ": "u",
    "ぇ": "e",
    "ぉ": "o",
    "ゃ": "ya",
    "ゅ": "yu",
    "ょ": "yo",
    "っ": "cl",  # Small tsu (geminate consonant)
    # Rare/archaic
    "ゐ": "wi",
    "ゑ": "we",
}

# Katakana to romaji mapping (same phonemes as hiragana)
KATAKANA_TO_ROMAJI: dict[str, str] = {
    # Vowels
    "ア": "a",
    "イ": "i",
    "ウ": "u",
    "エ": "e",
    "オ": "o",
    # K-row
    "カ": "ka",
    "キ": "ki",
    "ク": "ku",
    "ケ": "ke",
    "コ": "ko",
    # S-row
    "サ": "sa",
    "シ": "shi",
    "ス": "su",
    "セ": "se",
    "ソ": "so",
    # T-row
    "タ": "ta",
    "チ": "chi",
    "ツ": "tsu",
    "テ": "te",
    "ト": "to",
    # N-row
    "ナ": "na",
    "ニ": "ni",
    "ヌ": "nu",
    "ネ": "ne",
    "ノ": "no",
    # H-row
    "ハ": "ha",
    "ヒ": "hi",
    "フ": "fu",
    "ヘ": "he",
    "ホ": "ho",
    # M-row
    "マ": "ma",
    "ミ": "mi",
    "ム": "mu",
    "メ": "me",
    "モ": "mo",
    # Y-row
    "ヤ": "ya",
    "ユ": "yu",
    "ヨ": "yo",
    # R-row
    "ラ": "ra",
    "リ": "ri",
    "ル": "ru",
    "レ": "re",
    "ロ": "ro",
    # W-row
    "ワ": "wa",
    "ヲ": "wo",
    # N
    "ン": "N",
    # Voiced consonants (dakuten)
    # G-row
    "ガ": "ga",
    "ギ": "gi",
    "グ": "gu",
    "ゲ": "ge",
    "ゴ": "go",
    # Z-row
    "ザ": "za",
    "ジ": "ji",
    "ズ": "zu",
    "ゼ": "ze",
    "ゾ": "zo",
    # D-row
    "ダ": "da",
    "ヂ": "di",
    "ヅ": "du",
    "デ": "de",
    "ド": "do",
    # B-row
    "バ": "ba",
    "ビ": "bi",
    "ブ": "bu",
    "ベ": "be",
    "ボ": "bo",
    # P-row (handakuten)
    "パ": "pa",
    "ピ": "pi",
    "プ": "pu",
    "ペ": "pe",
    "ポ": "po",
    # Small kana (for combinations)
    "ァ": "a",
    "ィ": "i",
    "ゥ": "u",
    "ェ": "e",
    "ォ": "o",
    "ャ": "ya",
    "ュ": "yu",
    "ョ": "yo",
    "ッ": "cl",  # Small tsu (geminate consonant)
    # Rare/archaic
    "ヰ": "wi",
    "ヱ": "we",
    # Katakana-specific extensions
    "ー": "",  # Long vowel mark (handled separately)
    "ヴ": "vu",  # V-sound
}

# Combined kana combinations (must be checked before single kana)
# These are digraph combinations with small ya/yu/yo
KANA_COMBINATIONS: dict[str, str] = {
    # Hiragana combinations
    "きゃ": "kya",
    "きゅ": "kyu",
    "きょ": "kyo",
    "しゃ": "sha",
    "しゅ": "shu",
    "しょ": "sho",
    "ちゃ": "cha",
    "ちゅ": "chu",
    "ちょ": "cho",
    "にゃ": "nya",
    "にゅ": "nyu",
    "にょ": "nyo",
    "ひゃ": "hya",
    "ひゅ": "hyu",
    "ひょ": "hyo",
    "みゃ": "mya",
    "みゅ": "myu",
    "みょ": "myo",
    "りゃ": "rya",
    "りゅ": "ryu",
    "りょ": "ryo",
    "ぎゃ": "gya",
    "ぎゅ": "gyu",
    "ぎょ": "gyo",
    "じゃ": "ja",
    "じゅ": "ju",
    "じょ": "jo",
    "びゃ": "bya",
    "びゅ": "byu",
    "びょ": "byo",
    "ぴゃ": "pya",
    "ぴゅ": "pyu",
    "ぴょ": "pyo",
    # Katakana combinations
    "キャ": "kya",
    "キュ": "kyu",
    "キョ": "kyo",
    "シャ": "sha",
    "シュ": "shu",
    "ショ": "sho",
    "チャ": "cha",
    "チュ": "chu",
    "チョ": "cho",
    "ニャ": "nya",
    "ニュ": "nyu",
    "ニョ": "nyo",
    "ヒャ": "hya",
    "ヒュ": "hyu",
    "ヒョ": "hyo",
    "ミャ": "mya",
    "ミュ": "myu",
    "ミョ": "myo",
    "リャ": "rya",
    "リュ": "ryu",
    "リョ": "ryo",
    "ギャ": "gya",
    "ギュ": "gyu",
    "ギョ": "gyo",
    "ジャ": "ja",
    "ジュ": "ju",
    "ジョ": "jo",
    "ビャ": "bya",
    "ビュ": "byu",
    "ビョ": "byo",
    "ピャ": "pya",
    "ピュ": "pyu",
    "ピョ": "pyo",
    # Extended katakana combinations (foreign sounds)
    "ティ": "ti",
    "ディ": "di",
    "トゥ": "tu",
    "ドゥ": "du",
    "ファ": "fa",
    "フィ": "fi",
    "フェ": "fe",
    "フォ": "fo",
    "ウィ": "wi",
    "ウェ": "we",
    "ウォ": "wo",
    "ツァ": "tsa",
    "ツィ": "tsi",
    "ツェ": "tse",
    "ツォ": "tso",
    "チェ": "che",
    "シェ": "she",
    "ジェ": "je",
}

# Merge all single kana mappings
_ALL_SINGLE_KANA = {**HIRAGANA_TO_ROMAJI, **KATAKANA_TO_ROMAJI}


def kana_to_romaji(text: str) -> str:
    """Convert Japanese kana (hiragana/katakana) to romaji.

    Handles both hiragana and katakana, including:
    - Basic syllables (あ -> a, カ -> ka)
    - Voiced consonants (が -> ga, ダ -> da)
    - Combinations with small kana (しゃ -> sha, チョ -> cho)
    - Long vowel marks (ー extends previous vowel)
    - Geminate consonants (っ/ッ -> cl)

    Non-kana characters (romaji, numbers, symbols) are passed through unchanged.

    Args:
        text: Input text containing Japanese kana

    Returns:
        Romaji representation of the text

    Examples:
        >>> kana_to_romaji("あ")
        'a'
        >>> kana_to_romaji("かきくけこ")
        'ka ki ku ke ko'
        >>> kana_to_romaji("しゃしゅしょ")
        'sha shu sho'
        >>> kana_to_romaji("ka")  # Already romaji
        'ka'
    """
    result = []
    i = 0

    while i < len(text):
        # Check for two-character combinations first
        if i + 1 < len(text):
            two_char = text[i : i + 2]
            if two_char in KANA_COMBINATIONS:
                result.append(KANA_COMBINATIONS[two_char])
                i += 2
                continue

        # Check single character
        char = text[i]

        # Handle long vowel mark (ー) by repeating previous vowel
        if char == "ー" and result:
            # Get the last vowel from the previous romaji
            prev = result[-1]
            if prev and prev[-1] in "aiueo":
                result.append(prev[-1])
        elif char in _ALL_SINGLE_KANA:
            result.append(_ALL_SINGLE_KANA[char])
        else:
            # Pass through non-kana characters (romaji, numbers, etc.)
            result.append(char)

        i += 1

    # Join with spaces for SOFA transcript format
    # SOFA expects space-separated phonemes/words
    return " ".join(result)


def contains_kana(text: str) -> bool:
    """Check if text contains any Japanese kana characters.

    Args:
        text: Text to check

    Returns:
        True if the text contains hiragana or katakana
    """
    for char in text:
        if char in _ALL_SINGLE_KANA or char in KANA_COMBINATIONS:
            return True
        # Also check for kana Unicode ranges
        cp = ord(char)
        # Hiragana: U+3040-U+309F
        # Katakana: U+30A0-U+30FF
        if 0x3040 <= cp <= 0x309F or 0x30A0 <= cp <= 0x30FF:
            return True
    return False


def normalize_transcript(text: str) -> str:
    """Normalize a transcript for SOFA alignment.

    Performs the following:
    1. Converts kana to romaji if present
    2. Lowercases romaji
    3. Strips whitespace

    Args:
        text: Raw transcript text

    Returns:
        Normalized transcript ready for SOFA
    """
    if contains_kana(text):
        text = kana_to_romaji(text)

    return text.lower().strip()
