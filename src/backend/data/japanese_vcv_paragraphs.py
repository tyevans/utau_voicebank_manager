"""Japanese VCV paragraph prompts for efficient voicebank recording.

This module provides VCV (連続音/Renzokuon) recording strings based on the
Wasteland UTAU Efficiency VCV v3.5.1 reclist by Salem Wasteland.

VCV recording uses continuous vowel-consonant-vowel transitions for smoother
synthesis. Each recording string produces multiple VCV aliases:
- Initial CV: `- [syllable]` (start of phrase)
- VCV transition: `[vowel] [syllable]` (vowel-to-CV transition)
- Nasal transition: `n [syllable]` (nasal-to-CV transition)

Source: https://utau.felinewasteland.com/jp/vcv
"""

from src.backend.domain.paragraph_prompt import (
    ParagraphLibrary,
    ParagraphPrompt,
    Word,
)

# Mapping from romaji syllable to its ending vowel
# Used to determine the VCV alias prefix for the next syllable
SYLLABLE_VOWEL_MAP: dict[str, str] = {
    # Vowels
    "a": "a",
    "i": "i",
    "u": "u",
    "e": "e",
    "o": "o",
    "n": "n",  # Moraic nasal
    "N": "n",  # Alias for moraic nasal in recording strings
    # K-row
    "ka": "a",
    "ki": "i",
    "ku": "u",
    "ke": "e",
    "ko": "o",
    # K-row palatalized
    "kya": "a",
    "kyu": "u",
    "kye": "e",
    "kyo": "o",
    # G-row
    "ga": "a",
    "gi": "i",
    "gu": "u",
    "ge": "e",
    "go": "o",
    # G-row palatalized
    "gya": "a",
    "gyu": "u",
    "gye": "e",
    "gyo": "o",
    # S-row
    "sa": "a",
    "si": "i",
    "su": "u",
    "se": "e",
    "so": "o",
    # SH-row (palatalized S)
    "sha": "a",
    "shi": "i",
    "shu": "u",
    "she": "e",
    "sho": "o",
    # Z-row
    "za": "a",
    "zi": "i",
    "zu": "u",
    "ze": "e",
    "zo": "o",
    # J-row (palatalized Z)
    "ja": "a",
    "ji": "i",
    "ju": "u",
    "je": "e",
    "jo": "o",
    # T-row
    "ta": "a",
    "ti": "i",
    "tu": "u",
    "te": "e",
    "to": "o",
    # CH-row (palatalized T)
    "cha": "a",
    "chi": "i",
    "chu": "u",
    "che": "e",
    "cho": "o",
    # TS-row
    "tsa": "a",
    "tsi": "i",
    "tsu": "u",
    "tse": "e",
    "tso": "o",
    # D-row
    "da": "a",
    "di": "i",
    "du": "u",
    "de": "e",
    "do": "o",
    # N-row
    "na": "a",
    "ni": "i",
    "nu": "u",
    "ne": "e",
    "no": "o",
    # N-row palatalized
    "nya": "a",
    "nyu": "u",
    "nye": "e",
    "nyo": "o",
    # H-row
    "ha": "a",
    "hi": "i",
    "hu": "u",
    "he": "e",
    "ho": "o",
    # H-row palatalized
    "hya": "a",
    "hyu": "u",
    "hye": "e",
    "hyo": "o",
    # F-row
    "fa": "a",
    "fi": "i",
    "fu": "u",
    "fe": "e",
    "fo": "o",
    # B-row
    "ba": "a",
    "bi": "i",
    "bu": "u",
    "be": "e",
    "bo": "o",
    # B-row palatalized
    "bya": "a",
    "byu": "u",
    "bye": "e",
    "byo": "o",
    # P-row
    "pa": "a",
    "pi": "i",
    "pu": "u",
    "pe": "e",
    "po": "o",
    # P-row palatalized
    "pya": "a",
    "pyu": "u",
    "pye": "e",
    "pyo": "o",
    # M-row
    "ma": "a",
    "mi": "i",
    "mu": "u",
    "me": "e",
    "mo": "o",
    # M-row palatalized
    "mya": "a",
    "myu": "u",
    "mye": "e",
    "myo": "o",
    # Y-row
    "ya": "a",
    "yu": "u",
    "ye": "e",
    "yo": "o",
    # R-row
    "ra": "a",
    "ri": "i",
    "ru": "u",
    "re": "e",
    "ro": "o",
    # R-row palatalized
    "rya": "a",
    "ryu": "u",
    "rye": "e",
    "ryo": "o",
    # W-row
    "wa": "a",
    "wi": "i",
    "we": "e",
    "wo": "o",
    # V-row
    "va": "a",
    "vi": "i",
    "vu": "u",
    "ve": "e",
    "vo": "o",
}


def get_vowel_from_syllable(syllable: str) -> str:
    """Get the ending vowel of a syllable for VCV prefix calculation.

    Args:
        syllable: A romaji syllable (e.g., "ka", "shi", "n")

    Returns:
        The vowel that ends this syllable (e.g., "a", "i", "n")
    """
    return SYLLABLE_VOWEL_MAP.get(syllable, syllable[-1] if syllable else "a")


def parse_recording_string(recording_string: str) -> list[str]:
    """Parse a VCV recording string into individual syllables.

    Recording strings use `-` as a separator between syllables.
    Example: "ka-ka-ki-ka-ku-ka-N-ka" -> ["ka", "ka", "ki", "ka", "ku", "ka", "N", "ka"]

    Args:
        recording_string: A VCV recording string with `-` separators

    Returns:
        List of individual syllables
    """
    return recording_string.strip().split("-")


def extract_vcv_phonemes(recording_string: str) -> list[str]:
    """Extract VCV phoneme aliases from a recording string.

    Converts a recording string into the VCV aliases that will be produced:
    - First syllable produces initial CV alias: `- [syllable]`
    - Subsequent syllables produce VCV aliases: `[prev_vowel] [syllable]`
    - After `N`, produces nasal alias: `n [syllable]`

    Example:
        "ka-ka-ki-ka" produces:
        - "- ka" (initial)
        - "a ka" (a -> ka)
        - "a ki" (a -> ki)
        - "i ka" (i -> ka)

    Args:
        recording_string: A VCV recording string

    Returns:
        List of VCV phoneme aliases
    """
    syllables = parse_recording_string(recording_string)
    phonemes: list[str] = []

    for i, syllable in enumerate(syllables):
        # Normalize N to lowercase n
        current = syllable.lower() if syllable == "N" else syllable

        if i == 0:
            # First syllable: initial CV alias
            phonemes.append(f"- {current}")
        else:
            # Get the vowel from the previous syllable
            prev_vowel = get_vowel_from_syllable(syllables[i - 1])
            # Create VCV alias: [prev_vowel] [current_syllable]
            phonemes.append(f"{prev_vowel} {current}")

    return phonemes


def get_consonant_family(recording_string: str) -> str:
    """Determine the consonant family covered by a recording string.

    Args:
        recording_string: A VCV recording string

    Returns:
        Human-readable description of the consonant family
    """
    syllables = parse_recording_string(recording_string)
    if not syllables:
        return "Unknown"

    first = syllables[0].lower()

    # Check for palatalized forms first (longer patterns)
    if first.startswith("kya") or first.startswith("kyu") or first.startswith("kyo"):
        return "K-row palatalized (kya, kyu, kye, kyo)"
    if first.startswith("gya") or first.startswith("gyu") or first.startswith("gyo"):
        return "G-row palatalized (gya, gyu, gye, gyo)"
    if first.startswith("sha") or first.startswith("shi") or first.startswith("sho"):
        return "SH-row (sha, shi, shu, she, sho)"
    if first.startswith("ja") or first.startswith("ji") or first.startswith("jo"):
        return "J-row (ja, ji, ju, je, jo)"
    if first.startswith("cha") or first.startswith("chi") or first.startswith("cho"):
        return "CH-row (cha, chi, chu, che, cho)"
    if first.startswith("tsa") or first.startswith("tsi") or first.startswith("tso"):
        return "TS-row (tsa, tsi, tsu, tse, tso)"
    if first.startswith("nya") or first.startswith("nyu") or first.startswith("nyo"):
        return "N-row palatalized (nya, nyu, nye, nyo)"
    if first.startswith("hya") or first.startswith("hyu") or first.startswith("hyo"):
        return "H-row palatalized (hya, hyu, hye, hyo)"
    if first.startswith("fa") or first.startswith("fi") or first.startswith("fo"):
        return "F-row (fa, fi, fu, fe, fo)"
    if first.startswith("bya") or first.startswith("byu") or first.startswith("byo"):
        return "B-row palatalized (bya, byu, bye, byo)"
    if first.startswith("pya") or first.startswith("pyu") or first.startswith("pyo"):
        return "P-row palatalized (pya, pyu, pye, pyo)"
    if first.startswith("mya") or first.startswith("myu") or first.startswith("myo"):
        return "M-row palatalized (mya, myu, mye, myo)"
    if first.startswith("rya") or first.startswith("ryu") or first.startswith("ryo"):
        return "R-row palatalized (rya, ryu, rye, ryo)"
    if first.startswith("va") or first.startswith("vi") or first.startswith("vo"):
        return "V-row (va, vi, vu, ve, vo)"

    # Basic consonants
    if first.startswith("k"):
        return "K-row (ka, ki, ku, ke, ko)"
    if first.startswith("g"):
        return "G-row (ga, gi, gu, ge, go)"
    if first.startswith("s"):
        return "S-row (sa, si, su, se, so)"
    if first.startswith("z"):
        return "Z-row (za, zi, zu, ze, zo)"
    if first.startswith("t"):
        return "T-row (ta, ti, tu, te, to)"
    if first.startswith("d"):
        return "D-row (da, di, du, de, do)"
    if first.startswith("n"):
        return "N-row (na, ni, nu, ne, no)"
    if first.startswith("h"):
        return "H-row (ha, hi, hu, he, ho)"
    if first.startswith("b"):
        return "B-row (ba, bi, bu, be, bo)"
    if first.startswith("p"):
        return "P-row (pa, pi, pu, pe, po)"
    if first.startswith("m"):
        return "M-row (ma, mi, mu, me, mo)"
    if first.startswith("y"):
        return "Y-row (ya, yu, ye, yo)"
    if first.startswith("r"):
        return "R-row (ra, ri, ru, re, ro)"
    if first.startswith("w"):
        return "W-row (wa, wi, we, wo)"

    # Pure vowels
    if first in ("a", "i", "u", "e", "o", "n"):
        return "Vowels and nasal (a, i, u, e, o, n)"

    return "Mixed consonants"


# All 136 recording strings from Wasteland UTAU Efficiency VCV v3.5.1
RECORDING_STRINGS: list[str] = [
    # K-row (5 strings)
    "ka-ka-ki-ka-ku-ka-N-ka",
    "ki-ki-ku-ki-ke-ki-N-ki",
    "ku-ku-ke-ku-ko-ku-N-ku",
    "ke-ke-ko-ke-ka-ke-N-ke",
    "ko-ko-ka-ko-ki-ko-N-ko",
    # K-row palatalized (4 strings)
    "kya-kya-kyu-kya-kye-ki-kya-N-kya",
    "kyu-kyu-kye-kyu-kyo-ki-kyu-N-kyu",
    "kye-kye-kyo-kye-kya-ki-kye-N-kye",
    "kyo-kyo-kya-kyo-kyu-ki-kyo-N-kyo",
    # G-row (5 strings)
    "ga-ga-gi-ga-gu-ga-N-ga",
    "gi-gi-gu-gi-ge-gi-N-gi",
    "gu-gu-ge-gu-go-gu-N-gu",
    "ge-ge-go-ge-ga-ge-N-ge",
    "go-go-ga-go-gi-go-N-go",
    # G-row palatalized (4 strings)
    "gya-gya-gyu-gya-gye-gi-gya-N-gya",
    "gyu-gyu-gye-gyu-gyo-gi-gyu-N-gyu",
    "gye-gye-gyo-gye-gya-gi-gye-N-gye",
    "gyo-gyo-gya-gyo-gyu-gi-gyo-N-gyo",
    # S-row (5 strings)
    "sa-sa-si-sa-su-sa-N-sa",
    "si-si-su-si-se-si-N-si",
    "su-su-se-su-so-su-N-su",
    "se-se-so-se-sa-se-N-se",
    "so-so-sa-so-si-so-N-so",
    # SH-row (5 strings)
    "sha-sha-shi-sha-shu-sha-N-sha",
    "shi-shi-shu-shi-she-shi-N-shi",
    "shu-shu-she-shu-sho-shu-N-shu",
    "she-she-sho-she-sha-she-N-she",
    "sho-sho-sha-sho-shi-sho-N-sho",
    # Z-row (5 strings)
    "za-za-zi-za-zu-za-N-za",
    "zi-zi-zu-zi-ze-zi-N-zi",
    "zu-zu-ze-zu-zo-zu-N-zu",
    "ze-ze-zo-ze-za-ze-N-ze",
    "zo-zo-za-zo-zi-zo-N-zo",
    # J-row (5 strings)
    "ja-ja-ji-ja-ju-ja-N-ja",
    "ji-ji-ju-ji-je-ji-N-ji",
    "ju-ju-je-ju-jo-ju-N-ju",
    "je-je-jo-je-ja-je-N-je",
    "jo-jo-ja-jo-ji-jo-N-jo",
    # T-row (5 strings)
    "ta-ta-ti-ta-tu-ta-N-ta",
    "ti-ti-tu-ti-te-ti-N-ti",
    "tu-tu-te-tu-to-tu-N-tu",
    "te-te-to-te-ta-te-N-te",
    "to-to-ta-to-ti-to-N-to",
    # CH-row (5 strings)
    "cha-cha-chi-cha-chu-cha-N-cha",
    "chi-chi-chu-chi-che-chi-N-chi",
    "chu-chu-che-chu-cho-chu-N-chu",
    "che-che-cho-che-cha-che-N-che",
    "cho-cho-cha-cho-chi-cho-N-cho",
    # TS-row (5 strings)
    "tsa-tsa-tsi-tsa-tsu-tsa-N-tsa",
    "tsi-tsi-tsu-tsi-tse-tsi-N-tsi",
    "tsu-tsu-tse-tsu-tso-tsu-N-tsu",
    "tse-tse-tso-tse-tsa-tse-N-tse",
    "tso-tso-tsa-tso-tsi-tso-N-tso",
    # D-row (5 strings)
    "da-da-di-da-du-da-N-da",
    "di-di-du-di-de-di-N-di",
    "du-du-de-du-do-du-N-du",
    "de-de-do-de-da-de-N-de",
    "do-do-da-do-di-do-N-do",
    # N-row (5 strings)
    "na-na-ni-na-nu-na-N-na",
    "ni-ni-nu-ni-ne-ni-N-ni",
    "nu-nu-ne-nu-no-nu-N-nu",
    "ne-ne-no-ne-na-ne-N-ne",
    "no-no-na-no-ni-no-N-no",
    # N-row palatalized (4 strings)
    "nya-nya-nyu-nya-nye-ni-nya-N-nya",
    "nyu-nyu-nye-nyu-nyo-ni-nyu-N-nyu",
    "nye-nye-nyo-nye-nya-ni-nye-N-nye",
    "nyo-nyo-nya-nyo-nyu-ni-nyo-N-nyo",
    # H-row (5 strings)
    "ha-ha-hi-ha-hu-ha-N-ha",
    "hi-hi-hu-hi-he-hi-N-hi",
    "hu-hu-he-hu-ho-hu-N-hu",
    "he-he-ho-he-ha-he-N-he",
    "ho-ho-ha-ho-hi-ho-N-ho",
    # H-row palatalized (4 strings)
    "hya-hya-hyu-hya-hye-hi-hya-N-hya",
    "hyu-hyu-hye-hyu-hyo-hi-hyu-N-hyu",
    "hye-hye-hyo-hye-hya-hi-hye-N-hye",
    "hyo-hyo-hya-hyo-hyu-hi-hyo-N-hyo",
    # F-row (5 strings)
    "fa-fa-fi-fa-fu-fa-N-fa",
    "fi-fi-fu-fi-fe-fi-N-fi",
    "fu-fu-fe-fu-fo-fu-N-fu",
    "fe-fe-fo-fe-fa-fe-N-fe",
    "fo-fo-fa-fo-fi-fo-N-fo",
    # B-row (5 strings)
    "ba-ba-bi-ba-bu-ba-N-ba",
    "bi-bi-bu-bi-be-bi-N-bi",
    "bu-bu-be-bu-bo-bu-N-bu",
    "be-be-bo-be-ba-be-N-be",
    "bo-bo-ba-bo-bi-bo-N-bo",
    # B-row palatalized (4 strings)
    "bya-bya-byu-bya-bye-bi-bya-N-bya",
    "byu-byu-bye-byu-byo-bi-byu-N-byu",
    "bye-bye-byo-bye-bya-bi-bye-N-bye",
    "byo-byo-bya-byo-byu-bi-byo-N-byo",
    # P-row (5 strings)
    "pa-pa-pi-pa-pu-pa-N-pa",
    "pi-pi-pu-pi-pe-pi-N-pi",
    "pu-pu-pe-pu-po-pu-N-pu",
    "pe-pe-po-pe-pa-pe-N-pe",
    "po-po-pa-po-pi-po-N-po",
    # P-row palatalized (4 strings)
    "pya-pya-pyu-pya-pye-pi-pya-N-pya",
    "pyu-pyu-pye-pyu-pyo-pi-pyu-N-pyu",
    "pye-pye-pyo-pye-pya-pi-pye-N-pye",
    "pyo-pyo-pya-pyo-pyu-pi-pyo-N-pyo",
    # M-row (5 strings)
    "ma-ma-mi-ma-mu-ma-N-ma",
    "mi-mi-mu-mi-me-mi-N-mi",
    "mu-mu-me-mu-mo-mu-N-mu",
    "me-me-mo-me-ma-me-N-me",
    "mo-mo-ma-mo-mi-mo-N-mo",
    # M-row palatalized (4 strings)
    "mya-mya-myu-mya-mye-mi-mya-N-mya",
    "myu-myu-mye-myu-myo-mi-myu-N-myu",
    "mye-mye-myo-mye-mya-mi-mye-N-mye",
    "myo-myo-mya-myo-myu-mi-myo-N-myo",
    # Y-row (4 strings)
    "ya-ya-yu-ya-ye-i-ya-N-ya",
    "yu-yu-ye-yu-yo-i-yu-N-yu",
    "ye-ye-yo-ye-ya-i-ye-N-ye",
    "yo-yo-ya-yo-yu-i-yo-N-yo",
    # R-row (5 strings)
    "ra-ra-ri-ra-ru-ra-N-ra",
    "ri-ri-ru-ri-re-ri-N-ri",
    "ru-ru-re-ru-ro-ru-N-ru",
    "re-re-ro-re-ra-re-N-re",
    "ro-ro-ra-ro-ri-ro-N-ro",
    # R-row palatalized (4 strings)
    "rya-rya-ryu-rya-rye-ri-rya-N-rya",
    "ryu-ryu-rye-ryu-ryo-ri-ryu-N-ryu",
    "rye-rye-ryo-rye-rya-ri-rye-N-rye",
    "ryo-ryo-rya-ryo-ryu-ri-ryo-N-ryo",
    # W-row (4 strings)
    "wa-wa-wi-wa-we-u-wa-N-wa",
    "wi-wi-we-wi-wo-u-wi-N-wi",
    "we-we-wo-we-wa-u-we-N-we",
    "wo-wo-wa-wo-wi-u-wo-N-wo",
    # V-row (5 strings)
    "va-va-vi-va-vu-va-N-va",
    "vi-vi-vu-vi-ve-vi-N-vi",
    "vu-vu-ve-vu-vo-vu-N-vu",
    "ve-ve-vo-ve-va-ve-N-ve",
    "vo-vo-va-vo-vi-vo-N-vo",
    # Vowels and nasal (6 strings)
    "a-a-i-a-u-a-e",
    "i-i-u-i-e-i-o",
    "u-u-e-u-o-u-n",
    "e-e-o-e-n-e-a",
    "o-o-n-o-a-o-i",
    "n-n-a-n-i-n-u",
]


def _collect_all_vcv_phonemes() -> list[str]:
    """Collect all unique VCV phonemes from all recording strings.

    Returns:
        Sorted list of all unique VCV phoneme aliases
    """
    all_phonemes: set[str] = set()
    for recording_string in RECORDING_STRINGS:
        phonemes = extract_vcv_phonemes(recording_string)
        all_phonemes.update(phonemes)
    return sorted(all_phonemes)


# Complete list of all VCV phonemes covered by this reclist
JAPANESE_VCV_PHONEMES: list[str] = _collect_all_vcv_phonemes()


def _create_paragraph_prompts() -> list[ParagraphPrompt]:
    """Create the Japanese VCV paragraph prompts from recording strings.

    Each recording string becomes a ParagraphPrompt with:
    - The recording string as the prompt text and romaji
    - VCV phoneme aliases extracted from the transitions
    - Metadata about the consonant family covered
    """
    prompts: list[ParagraphPrompt] = []

    for idx, recording_string in enumerate(RECORDING_STRINGS, start=1):
        paragraph_id = f"ja-vcv-para-{idx:03d}"
        phonemes = extract_vcv_phonemes(recording_string)
        consonant_family = get_consonant_family(recording_string)

        # Determine category based on consonant type
        if "palatalized" in consonant_family.lower():
            category = "palatalized"
        elif "Vowels" in consonant_family:
            category = "vowels"
        elif any(
            row in consonant_family
            for row in ["SH-row", "CH-row", "TS-row", "J-row", "F-row", "V-row"]
        ):
            category = "extended"
        else:
            category = "basic"

        # Create a single "word" representing the entire recording string
        # VCV recording is done as continuous utterance, not separate words
        words = [
            Word(
                text=recording_string,
                romaji=recording_string.replace("-", " "),
                phonemes=phonemes,
                start_char=0,
            )
        ]

        prompt = ParagraphPrompt(
            id=paragraph_id,
            text=recording_string,
            romaji=recording_string,
            words=words,
            expected_phonemes=phonemes,
            style="vcv",
            language="ja",
            category=category,
            difficulty="basic",
            notes=f"Covers {consonant_family}. Record continuously without pauses.",
        )
        prompts.append(prompt)

    return prompts


def get_japanese_vcv_paragraph_library() -> ParagraphLibrary:
    """Get the complete Japanese VCV paragraph library.

    Returns a ParagraphLibrary containing all 136 Japanese VCV recording strings
    based on the Wasteland UTAU Efficiency VCV v3.5.1 reclist.
    """
    return ParagraphLibrary(
        id="ja-vcv-paragraphs-v1",
        name="Japanese VCV Paragraphs (Wasteland Efficiency)",
        language="ja",
        language_name="Japanese",
        style="vcv",
        paragraphs=_create_paragraph_prompts(),
        target_phonemes=JAPANESE_VCV_PHONEMES,
        version="1.0",
        notes=(
            "VCV (連続音) recording strings based on Wasteland UTAU Efficiency VCV v3.5.1 "
            "by Salem Wasteland. Contains 136 recording strings producing 958 OTO entries. "
            "Record each string continuously at 100-120 BPM without pauses between syllables. "
            "Source: https://utau.felinewasteland.com/jp/vcv"
        ),
    )


def analyze_coverage() -> dict[str, list[str] | int]:
    """Analyze phoneme coverage of the VCV paragraph library.

    Returns a dict with:
    - 'total_strings': Number of recording strings
    - 'total_phonemes': Number of unique VCV phonemes
    - 'phonemes': List of all VCV phonemes covered
    - 'initial_cv': List of initial CV aliases (- [syllable])
    - 'vcv_transitions': List of VCV transition aliases ([vowel] [syllable])
    - 'nasal_transitions': List of nasal transition aliases (n [syllable])
    """
    all_phonemes = JAPANESE_VCV_PHONEMES

    initial_cv = [p for p in all_phonemes if p.startswith("- ")]
    nasal_transitions = [p for p in all_phonemes if p.startswith("n ")]
    vcv_transitions = [
        p
        for p in all_phonemes
        if not p.startswith("- ") and not p.startswith("n ") and " " in p
    ]

    return {
        "total_strings": len(RECORDING_STRINGS),
        "total_phonemes": len(all_phonemes),
        "phonemes": all_phonemes,
        "initial_cv": initial_cv,
        "vcv_transitions": vcv_transitions,
        "nasal_transitions": nasal_transitions,
    }


def get_phonemes_for_recording_string(recording_string: str) -> list[str]:
    """Helper function to get VCV phonemes from a specific recording string.

    Args:
        recording_string: A VCV recording string (e.g., "ka-ka-ki-ka-ku-ka-N-ka")

    Returns:
        List of VCV phoneme aliases that will be produced
    """
    return extract_vcv_phonemes(recording_string)


def get_recording_strings_by_consonant(consonant: str) -> list[str]:
    """Get all recording strings for a specific consonant family.

    Args:
        consonant: Consonant to filter by (e.g., "k", "sh", "ky")

    Returns:
        List of recording strings starting with that consonant
    """
    result: list[str] = []
    for recording_string in RECORDING_STRINGS:
        syllables = parse_recording_string(recording_string)
        if syllables and syllables[0].lower().startswith(consonant.lower()):
            result.append(recording_string)
    return result
