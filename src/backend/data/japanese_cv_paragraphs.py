"""Japanese CV paragraph prompts for efficient voicebank recording.

This module provides natural Japanese sentences designed to cover all
Japanese CV (consonant-vowel) phonemes with minimal recording overhead.
Instead of recording 111+ individual mora prompts, users record ~15
sentences that together provide complete phoneme coverage.

Japanese CV phonemes covered:
- 5 vowels: a, i, u, e, o
- K-row: ka, ki, ku, ke, ko
- S-row: sa, shi, su, se, so
- T-row: ta, chi, tsu, te, to
- N-row: na, ni, nu, ne, no
- H-row: ha, hi, fu, he, ho
- M-row: ma, mi, mu, me, mo
- Y-row: ya, yu, yo
- R-row: ra, ri, ru, re, ro
- W-row: wa, wo
- N: n (syllabic)
- Voiced (G): ga, gi, gu, ge, go
- Voiced (Z): za, ji, zu, ze, zo
- Voiced (D): da, de, do
- Voiced (B): ba, bi, bu, be, bo
- Half-voiced (P): pa, pi, pu, pe, po
"""

from src.backend.domain.paragraph_prompt import (
    ParagraphLibrary,
    ParagraphPrompt,
    Word,
)

# Complete list of Japanese CV phonemes to cover
JAPANESE_CV_PHONEMES: list[str] = [
    # Vowels
    "a",
    "i",
    "u",
    "e",
    "o",
    # K-row
    "ka",
    "ki",
    "ku",
    "ke",
    "ko",
    # S-row
    "sa",
    "shi",
    "su",
    "se",
    "so",
    # T-row
    "ta",
    "chi",
    "tsu",
    "te",
    "to",
    # N-row
    "na",
    "ni",
    "nu",
    "ne",
    "no",
    # H-row
    "ha",
    "hi",
    "fu",
    "he",
    "ho",
    # M-row
    "ma",
    "mi",
    "mu",
    "me",
    "mo",
    # Y-row
    "ya",
    "yu",
    "yo",
    # R-row
    "ra",
    "ri",
    "ru",
    "re",
    "ro",
    # W-row and syllabic N
    "wa",
    "wo",
    "n",
    # Voiced G-row
    "ga",
    "gi",
    "gu",
    "ge",
    "go",
    # Voiced Z-row
    "za",
    "ji",
    "zu",
    "ze",
    "zo",
    # Voiced D-row (di/du don't exist in native Japanese)
    "da",
    "de",
    "do",
    # Voiced B-row
    "ba",
    "bi",
    "bu",
    "be",
    "bo",
    # Half-voiced P-row
    "pa",
    "pi",
    "pu",
    "pe",
    "po",
]


def _create_paragraph_prompts() -> list[ParagraphPrompt]:
    """Create the Japanese CV paragraph prompts.

    Each sentence is designed to:
    - Be natural Japanese that sounds fluent when read aloud
    - Cover multiple phonemes efficiently
    - Have clear word boundaries for ML segmentation
    - Be easy to pronounce for voice actors
    """
    return [
        # Sentence 1: Covers vowels and basic consonants
        ParagraphPrompt(
            id="ja-cv-para-001",
            text="青い海を見た",
            romaji="aoi umi wo mita",
            words=[
                Word(text="青い", romaji="aoi", phonemes=["a", "o", "i"], start_char=0),
                Word(text="海", romaji="umi", phonemes=["u", "mi"], start_char=2),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=3),
                Word(text="見た", romaji="mita", phonemes=["mi", "ta"], start_char=4),
            ],
            expected_phonemes=["a", "o", "i", "u", "mi", "wo", "ta"],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Speak naturally with clear vowel articulation",
        ),
        # Sentence 2: K-row focus
        ParagraphPrompt(
            id="ja-cv-para-002",
            text="風が来て木の葉が落ちた",
            romaji="kaze ga kite ko no ha ga ochita",
            words=[
                Word(text="風", romaji="kaze", phonemes=["ka", "ze"], start_char=0),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=1),
                Word(text="来て", romaji="kite", phonemes=["ki", "te"], start_char=2),
                Word(text="木", romaji="ko", phonemes=["ko"], start_char=4),
                Word(text="の", romaji="no", phonemes=["no"], start_char=5),
                Word(text="葉", romaji="ha", phonemes=["ha"], start_char=6),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=7),
                Word(
                    text="落ちた",
                    romaji="ochita",
                    phonemes=["o", "chi", "ta"],
                    start_char=8,
                ),
            ],
            expected_phonemes=[
                "ka",
                "ze",
                "ga",
                "ki",
                "te",
                "ko",
                "no",
                "ha",
                "o",
                "chi",
                "ta",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Natural tempo, clear ka/ki/ko sounds",
        ),
        # Sentence 3: S-row and T-row
        ParagraphPrompt(
            id="ja-cv-para-003",
            text="静かな月が空に出た",
            romaji="shizuka na tsuki ga sora ni deta",
            words=[
                Word(
                    text="静かな",
                    romaji="shizuka na",
                    phonemes=["shi", "zu", "ka", "na"],
                    start_char=0,
                ),
                Word(text="月", romaji="tsuki", phonemes=["tsu", "ki"], start_char=3),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=4),
                Word(text="空", romaji="sora", phonemes=["so", "ra"], start_char=5),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=6),
                Word(text="出た", romaji="deta", phonemes=["de", "ta"], start_char=7),
            ],
            expected_phonemes=[
                "shi",
                "zu",
                "ka",
                "na",
                "tsu",
                "ki",
                "ga",
                "so",
                "ra",
                "ni",
                "de",
                "ta",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Poetic rhythm, clear shi/tsu distinction",
        ),
        # Sentence 4: N-row and H-row
        ParagraphPrompt(
            id="ja-cv-para-004",
            text="花火の夜に夏祭りへ行く",
            romaji="hanabi no yoru ni natsu matsuri he iku",
            words=[
                Word(
                    text="花火",
                    romaji="hanabi",
                    phonemes=["ha", "na", "bi"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=2),
                Word(text="夜", romaji="yoru", phonemes=["yo", "ru"], start_char=3),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=4),
                Word(text="夏", romaji="natsu", phonemes=["na", "tsu"], start_char=5),
                Word(
                    text="祭り",
                    romaji="matsuri",
                    phonemes=["ma", "tsu", "ri"],
                    start_char=6,
                ),
                Word(text="へ", romaji="he", phonemes=["he"], start_char=8),
                Word(text="行く", romaji="iku", phonemes=["i", "ku"], start_char=9),
            ],
            expected_phonemes=[
                "ha",
                "na",
                "bi",
                "no",
                "yo",
                "ru",
                "ni",
                "tsu",
                "ma",
                "ri",
                "he",
                "i",
                "ku",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Festive imagery, covers ha/na/ni/no/he",
        ),
        # Sentence 5: M-row focus
        ParagraphPrompt(
            id="ja-cv-para-005",
            text="水を飲む前に目を閉じた",
            romaji="mizu wo nomu mae ni me wo tojita",
            words=[
                Word(text="水", romaji="mizu", phonemes=["mi", "zu"], start_char=0),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=1),
                Word(text="飲む", romaji="nomu", phonemes=["no", "mu"], start_char=2),
                Word(text="前", romaji="mae", phonemes=["ma", "e"], start_char=4),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=5),
                Word(text="目", romaji="me", phonemes=["me"], start_char=6),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=7),
                Word(
                    text="閉じた",
                    romaji="tojita",
                    phonemes=["to", "ji", "ta"],
                    start_char=8,
                ),
            ],
            expected_phonemes=[
                "mi",
                "zu",
                "wo",
                "no",
                "mu",
                "ma",
                "e",
                "ni",
                "me",
                "to",
                "ji",
                "ta",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Covers ma/mi/mu/me, natural pacing",
        ),
        # Sentence 6: R-row and Y-row
        ParagraphPrompt(
            id="ja-cv-para-006",
            text="夕焼けの中で友達と遊んだ",
            romaji="yuuyake no naka de tomodachi to asonda",
            words=[
                Word(
                    text="夕焼け",
                    romaji="yuuyake",
                    phonemes=["yu", "u", "ya", "ke"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=3),
                Word(text="中", romaji="naka", phonemes=["na", "ka"], start_char=4),
                Word(text="で", romaji="de", phonemes=["de"], start_char=5),
                Word(
                    text="友達",
                    romaji="tomodachi",
                    phonemes=["to", "mo", "da", "chi"],
                    start_char=6,
                ),
                Word(text="と", romaji="to", phonemes=["to"], start_char=8),
                Word(
                    text="遊んだ",
                    romaji="asonda",
                    phonemes=["a", "so", "n", "da"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "yu",
                "u",
                "ya",
                "ke",
                "no",
                "na",
                "ka",
                "de",
                "to",
                "mo",
                "da",
                "chi",
                "a",
                "so",
                "n",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Covers ya/yu/yo sounds and syllabic n",
        ),
        # Sentence 7: More R-row
        ParagraphPrompt(
            id="ja-cv-para-007",
            text="緑の森で鳥が歌う声を聞いた",
            romaji="midori no mori de tori ga utau koe wo kiita",
            words=[
                Word(
                    text="緑",
                    romaji="midori",
                    phonemes=["mi", "do", "ri"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=2),
                Word(text="森", romaji="mori", phonemes=["mo", "ri"], start_char=3),
                Word(text="で", romaji="de", phonemes=["de"], start_char=4),
                Word(text="鳥", romaji="tori", phonemes=["to", "ri"], start_char=5),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=6),
                Word(
                    text="歌う", romaji="utau", phonemes=["u", "ta", "u"], start_char=7
                ),
                Word(text="声", romaji="koe", phonemes=["ko", "e"], start_char=9),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=10),
                Word(
                    text="聞いた",
                    romaji="kiita",
                    phonemes=["ki", "i", "ta"],
                    start_char=11,
                ),
            ],
            expected_phonemes=[
                "mi",
                "do",
                "ri",
                "no",
                "mo",
                "de",
                "to",
                "ga",
                "u",
                "ta",
                "ko",
                "e",
                "wo",
                "ki",
                "i",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Covers ri/ro sounds, nature imagery",
        ),
        # Sentence 8: Voiced consonants (G/Z)
        ParagraphPrompt(
            id="ja-cv-para-008",
            text="銀色の魚が川を泳ぐ",
            romaji="gin'iro no sakana ga kawa wo oyogu",
            words=[
                Word(
                    text="銀色",
                    romaji="gin'iro",
                    phonemes=["gi", "n", "i", "ro"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=2),
                Word(
                    text="魚",
                    romaji="sakana",
                    phonemes=["sa", "ka", "na"],
                    start_char=3,
                ),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=4),
                Word(text="川", romaji="kawa", phonemes=["ka", "wa"], start_char=5),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=6),
                Word(
                    text="泳ぐ",
                    romaji="oyogu",
                    phonemes=["o", "yo", "gu"],
                    start_char=7,
                ),
            ],
            expected_phonemes=[
                "gi",
                "n",
                "i",
                "ro",
                "no",
                "sa",
                "ka",
                "na",
                "ga",
                "wa",
                "wo",
                "o",
                "yo",
                "gu",
            ],
            style="cv",
            language="ja",
            category="voiced-sounds",
            difficulty="basic",
            notes="Covers ga/gi/gu, clear voiced consonants",
        ),
        # Sentence 9: More voiced consonants
        ParagraphPrompt(
            id="ja-cv-para-009",
            text="座って雑誌を読む時間が好きだ",
            romaji="suwatte zasshi wo yomu jikan ga suki da",
            words=[
                Word(
                    text="座って",
                    romaji="suwatte",
                    phonemes=["su", "wa", "t", "te"],
                    start_char=0,
                ),
                Word(
                    text="雑誌",
                    romaji="zasshi",
                    phonemes=["za", "s", "shi"],
                    start_char=3,
                ),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=5),
                Word(text="読む", romaji="yomu", phonemes=["yo", "mu"], start_char=6),
                Word(
                    text="時間",
                    romaji="jikan",
                    phonemes=["ji", "ka", "n"],
                    start_char=8,
                ),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=10),
                Word(text="好き", romaji="suki", phonemes=["su", "ki"], start_char=11),
                Word(text="だ", romaji="da", phonemes=["da"], start_char=13),
            ],
            expected_phonemes=[
                "su",
                "wa",
                "te",
                "za",
                "shi",
                "wo",
                "yo",
                "mu",
                "ji",
                "ka",
                "n",
                "ga",
                "ki",
                "da",
            ],
            style="cv",
            language="ja",
            category="voiced-sounds",
            difficulty="basic",
            notes="Covers za/ji/zu/ze/zo row sounds",
        ),
        # Sentence 10: B-row (voiced)
        ParagraphPrompt(
            id="ja-cv-para-010",
            text="美しい花瓶を部屋に置いた",
            romaji="utsukushii kabin wo heya ni oita",
            words=[
                Word(
                    text="美しい",
                    romaji="utsukushii",
                    phonemes=["u", "tsu", "ku", "shi", "i"],
                    start_char=0,
                ),
                Word(
                    text="花瓶",
                    romaji="kabin",
                    phonemes=["ka", "bi", "n"],
                    start_char=3,
                ),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=5),
                Word(text="部屋", romaji="heya", phonemes=["he", "ya"], start_char=6),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=8),
                Word(
                    text="置いた",
                    romaji="oita",
                    phonemes=["o", "i", "ta"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "u",
                "tsu",
                "ku",
                "shi",
                "i",
                "ka",
                "bi",
                "n",
                "wo",
                "he",
                "ya",
                "ni",
                "o",
                "ta",
            ],
            style="cv",
            language="ja",
            category="voiced-sounds",
            difficulty="basic",
            notes="Covers bi from B-row",
        ),
        # Sentence 11: More B-row
        ParagraphPrompt(
            id="ja-cv-para-011",
            text="馬が走る姿はとても美しい",
            romaji="uma ga hashiru sugata wa totemo utsukushii",
            words=[
                Word(text="馬", romaji="uma", phonemes=["u", "ma"], start_char=0),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=1),
                Word(
                    text="走る",
                    romaji="hashiru",
                    phonemes=["ha", "shi", "ru"],
                    start_char=2,
                ),
                Word(
                    text="姿",
                    romaji="sugata",
                    phonemes=["su", "ga", "ta"],
                    start_char=4,
                ),
                Word(text="は", romaji="wa", phonemes=["wa"], start_char=5),
                Word(
                    text="とても",
                    romaji="totemo",
                    phonemes=["to", "te", "mo"],
                    start_char=6,
                ),
                Word(
                    text="美しい",
                    romaji="utsukushii",
                    phonemes=["u", "tsu", "ku", "shi", "i"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "u",
                "ma",
                "ga",
                "ha",
                "shi",
                "ru",
                "su",
                "ta",
                "wa",
                "to",
                "te",
                "mo",
                "tsu",
                "ku",
                "i",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Covers ru from R-row",
        ),
        # Sentence 12: P-row (half-voiced)
        ParagraphPrompt(
            id="ja-cv-para-012",
            text="ピアノの音がポンポンと響く",
            romaji="piano no oto ga ponpon to hibiku",
            words=[
                Word(
                    text="ピアノ",
                    romaji="piano",
                    phonemes=["pi", "a", "no"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=3),
                Word(text="音", romaji="oto", phonemes=["o", "to"], start_char=4),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=5),
                Word(
                    text="ポンポン",
                    romaji="ponpon",
                    phonemes=["po", "n", "po", "n"],
                    start_char=6,
                ),
                Word(text="と", romaji="to", phonemes=["to"], start_char=10),
                Word(
                    text="響く",
                    romaji="hibiku",
                    phonemes=["hi", "bi", "ku"],
                    start_char=11,
                ),
            ],
            expected_phonemes=[
                "pi",
                "a",
                "no",
                "o",
                "to",
                "ga",
                "po",
                "n",
                "hi",
                "bi",
                "ku",
            ],
            style="cv",
            language="ja",
            category="half-voiced",
            difficulty="basic",
            notes="Covers pi/po from P-row",
        ),
        # Sentence 13: More P-row and remaining sounds
        ParagraphPrompt(
            id="ja-cv-para-013",
            text="ペンを使ってプレゼントの絵を描いた",
            romaji="pen wo tsukatte purezento no e wo kaita",
            words=[
                Word(text="ペン", romaji="pen", phonemes=["pe", "n"], start_char=0),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=2),
                Word(
                    text="使って",
                    romaji="tsukatte",
                    phonemes=["tsu", "ka", "t", "te"],
                    start_char=3,
                ),
                Word(
                    text="プレゼント",
                    romaji="purezento",
                    phonemes=["pu", "re", "ze", "n", "to"],
                    start_char=6,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=11),
                Word(text="絵", romaji="e", phonemes=["e"], start_char=12),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=13),
                Word(
                    text="描いた",
                    romaji="kaita",
                    phonemes=["ka", "i", "ta"],
                    start_char=14,
                ),
            ],
            expected_phonemes=[
                "pe",
                "n",
                "wo",
                "tsu",
                "ka",
                "te",
                "pu",
                "re",
                "ze",
                "to",
                "no",
                "e",
                "i",
                "ta",
            ],
            style="cv",
            language="ja",
            category="half-voiced",
            difficulty="basic",
            notes="Covers pe/pu from P-row, re from R-row",
        ),
        # Sentence 14: Remaining voiced and coverage gaps
        ParagraphPrompt(
            id="ja-cv-para-014",
            text="午後にバスで温泉へ行こう",
            romaji="gogo ni basu de onsen he ikou",
            words=[
                Word(text="午後", romaji="gogo", phonemes=["go", "go"], start_char=0),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=2),
                Word(text="バス", romaji="basu", phonemes=["ba", "su"], start_char=3),
                Word(text="で", romaji="de", phonemes=["de"], start_char=5),
                Word(
                    text="温泉",
                    romaji="onsen",
                    phonemes=["o", "n", "se", "n"],
                    start_char=6,
                ),
                Word(text="へ", romaji="he", phonemes=["he"], start_char=8),
                Word(
                    text="行こう",
                    romaji="ikou",
                    phonemes=["i", "ko", "u"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "go",
                "ni",
                "ba",
                "su",
                "de",
                "o",
                "n",
                "se",
                "he",
                "i",
                "ko",
                "u",
            ],
            style="cv",
            language="ja",
            category="voiced-sounds",
            difficulty="basic",
            notes="Covers go/ba/se sounds",
        ),
        # Sentence 15: Fill remaining gaps (bu/be/bo, fu, nu, ge, zo, pa)
        ParagraphPrompt(
            id="ja-cv-para-015",
            text="文房具を買う時は値段を比べる",
            romaji="bunbougu wo kau toki wa nedan wo kuraberu",
            words=[
                Word(
                    text="文房具",
                    romaji="bunbougu",
                    phonemes=["bu", "n", "bo", "u", "gu"],
                    start_char=0,
                ),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=3),
                Word(text="買う", romaji="kau", phonemes=["ka", "u"], start_char=4),
                Word(text="時", romaji="toki", phonemes=["to", "ki"], start_char=6),
                Word(text="は", romaji="wa", phonemes=["wa"], start_char=7),
                Word(
                    text="値段",
                    romaji="nedan",
                    phonemes=["ne", "da", "n"],
                    start_char=8,
                ),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=10),
                Word(
                    text="比べる",
                    romaji="kuraberu",
                    phonemes=["ku", "ra", "be", "ru"],
                    start_char=11,
                ),
            ],
            expected_phonemes=[
                "bu",
                "n",
                "bo",
                "u",
                "gu",
                "wo",
                "ka",
                "to",
                "ki",
                "wa",
                "ne",
                "da",
                "ra",
                "be",
                "ru",
            ],
            style="cv",
            language="ja",
            category="voiced-sounds",
            difficulty="basic",
            notes="Covers bu/bo/be from B-row, ne from N-row",
        ),
        # Sentence 16: Remaining gaps (fu, nu, ge, zo, pa)
        ParagraphPrompt(
            id="ja-cv-para-016",
            text="布団の上でパパが元気に象の絵を描く",
            romaji="futon no ue de papa ga genki ni zou no e wo kaku",
            words=[
                Word(
                    text="布団",
                    romaji="futon",
                    phonemes=["fu", "to", "n"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=2),
                Word(text="上", romaji="ue", phonemes=["u", "e"], start_char=3),
                Word(text="で", romaji="de", phonemes=["de"], start_char=4),
                Word(text="パパ", romaji="papa", phonemes=["pa", "pa"], start_char=5),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=7),
                Word(
                    text="元気",
                    romaji="genki",
                    phonemes=["ge", "n", "ki"],
                    start_char=8,
                ),
                Word(text="に", romaji="ni", phonemes=["ni"], start_char=10),
                Word(text="象", romaji="zou", phonemes=["zo", "u"], start_char=11),
                Word(text="の", romaji="no", phonemes=["no"], start_char=12),
                Word(text="絵", romaji="e", phonemes=["e"], start_char=13),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=14),
                Word(text="描く", romaji="kaku", phonemes=["ka", "ku"], start_char=15),
            ],
            expected_phonemes=[
                "fu",
                "to",
                "n",
                "no",
                "u",
                "e",
                "de",
                "pa",
                "ga",
                "ge",
                "ki",
                "ni",
                "zo",
                "wo",
                "ka",
                "ku",
            ],
            style="cv",
            language="ja",
            category="special-sounds",
            difficulty="basic",
            notes="Covers fu/ge/zo/pa - final coverage gaps",
        ),
        # Sentence 17: nu coverage (rare sound)
        ParagraphPrompt(
            id="ja-cv-para-017",
            text="犬が庭を走り回る",
            romaji="inu ga niwa wo hashiri mawaru",
            words=[
                Word(text="犬", romaji="inu", phonemes=["i", "nu"], start_char=0),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=1),
                Word(text="庭", romaji="niwa", phonemes=["ni", "wa"], start_char=2),
                Word(text="を", romaji="wo", phonemes=["wo"], start_char=3),
                Word(
                    text="走り回る",
                    romaji="hashiri mawaru",
                    phonemes=["ha", "shi", "ri", "ma", "wa", "ru"],
                    start_char=4,
                ),
            ],
            expected_phonemes=[
                "i",
                "nu",
                "ga",
                "ni",
                "wa",
                "wo",
                "ha",
                "shi",
                "ri",
                "ma",
                "ru",
            ],
            style="cv",
            language="ja",
            category="special-sounds",
            difficulty="basic",
            notes="Covers nu from N-row (rare in Japanese)",
        ),
        # Sentence 18: ra/ro coverage reinforcement
        ParagraphPrompt(
            id="ja-cv-para-018",
            text="六月の雨が降る朝は涼しい",
            romaji="rokugatsu no ame ga furu asa wa suzushii",
            words=[
                Word(
                    text="六月",
                    romaji="rokugatsu",
                    phonemes=["ro", "ku", "ga", "tsu"],
                    start_char=0,
                ),
                Word(text="の", romaji="no", phonemes=["no"], start_char=2),
                Word(text="雨", romaji="ame", phonemes=["a", "me"], start_char=3),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=4),
                Word(text="降る", romaji="furu", phonemes=["fu", "ru"], start_char=5),
                Word(text="朝", romaji="asa", phonemes=["a", "sa"], start_char=7),
                Word(text="は", romaji="wa", phonemes=["wa"], start_char=8),
                Word(
                    text="涼しい",
                    romaji="suzushii",
                    phonemes=["su", "zu", "shi", "i"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "ro",
                "ku",
                "ga",
                "tsu",
                "no",
                "a",
                "me",
                "fu",
                "ru",
                "sa",
                "wa",
                "su",
                "zu",
                "shi",
                "i",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Reinforces ro/ra sounds, covers fu",
        ),
        # Sentence 19: ho coverage (completes H-row)
        ParagraphPrompt(
            id="ja-cv-para-019",
            text="星が本当に美しい夜だった",
            romaji="hoshi ga hontou ni utsukushii yoru datta",
            words=[
                Word(text="星", romaji="hoshi", phonemes=["ho", "shi"], start_char=0),
                Word(text="が", romaji="ga", phonemes=["ga"], start_char=1),
                Word(
                    text="本当に",
                    romaji="hontou ni",
                    phonemes=["ho", "n", "to", "u", "ni"],
                    start_char=2,
                ),
                Word(
                    text="美しい",
                    romaji="utsukushii",
                    phonemes=["u", "tsu", "ku", "shi", "i"],
                    start_char=5,
                ),
                Word(text="夜", romaji="yoru", phonemes=["yo", "ru"], start_char=8),
                Word(
                    text="だった",
                    romaji="datta",
                    phonemes=["da", "t", "ta"],
                    start_char=9,
                ),
            ],
            expected_phonemes=[
                "ho",
                "shi",
                "ga",
                "n",
                "to",
                "u",
                "ni",
                "tsu",
                "ku",
                "i",
                "yo",
                "ru",
                "da",
                "ta",
            ],
            style="cv",
            language="ja",
            category="basic-coverage",
            difficulty="basic",
            notes="Covers ho from H-row, completes full phoneme coverage",
        ),
    ]


def get_japanese_cv_paragraph_library() -> ParagraphLibrary:
    """Get the complete Japanese CV paragraph library.

    Returns a ParagraphLibrary containing all Japanese CV paragraph prompts
    with complete phoneme coverage metadata.
    """
    return ParagraphLibrary(
        id="ja-cv-paragraphs-v1",
        name="Japanese CV Paragraphs",
        language="ja",
        language_name="Japanese",
        style="cv",
        paragraphs=_create_paragraph_prompts(),
        target_phonemes=JAPANESE_CV_PHONEMES,
        version="1.0",
        notes=(
            "Natural Japanese sentences designed for efficient CV voicebank recording. "
            "Each sentence covers multiple phonemes, reducing total recording time from "
            "111+ individual prompts to 19 natural sentences while maintaining complete "
            "phoneme coverage."
        ),
    )


# Convenience function to check coverage
def analyze_coverage() -> dict[str, list[str]]:
    """Analyze phoneme coverage of the paragraph library.

    Returns a dict with:
    - 'covered': phonemes covered by the library
    - 'missing': phonemes from target list not covered
    - 'extra': phonemes covered but not in target list
    """
    library = get_japanese_cv_paragraph_library()
    target = set(JAPANESE_CV_PHONEMES)
    covered = set(library.covered_phonemes)

    return {
        "covered": sorted(covered & target),
        "missing": sorted(target - covered),
        "extra": sorted(covered - target),
    }
