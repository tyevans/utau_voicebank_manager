# Japanese VCV Reclist Reference

Reference documentation for implementing Japanese VCV (連続音/Renzokuon) reclists.

## Source

**Wasteland UTAU Efficiency VCV v3.5.1**
- Author: Salem Wasteland (American linguist, 15+ years UTAU experience)
- URL: https://utau.felinewasteland.com/jp/vcv
- License: Community resource for UTAU voicebank creation

Files copied to `vendor/wasteland_utau/`:
- `felinewasteland_jp_vcv_eff_roma_v3.5.1.txt` - Romaji recording strings
- `felinewasteland_jp_vcv_eff_kana_v3.5.1.txt` - Kana recording strings
- `felinewasteland_jp_vcv_eff_roma_v3.5.1_oto.ini` - Romaji OTO template
- `felinewasteland_jp_vcv_eff_kana_v3.5.1_oto.ini` - Kana OTO template

## Statistics

| Metric | Value |
|--------|-------|
| Recording strings | 136 |
| OTO entries | 958 |
| Recording time | ~35 minutes |
| Mora per string | 7-9 |

## Recording String Format

Each line is a sequence of syllables separated by `-`:

```
ka-ka-ki-ka-ku-ka-N-ka
```

Where:
- Syllables are recorded continuously with no pause
- `-` is a separator for readability (not a pause)
- `N` represents the moraic nasal (ん)

### String Pattern

Basic consonant rows follow this pattern:
```
[C]a-[C]a-[C]i-[C]a-[C]u-[C]a-N-[C]a
[C]i-[C]i-[C]u-[C]i-[C]e-[C]i-N-[C]i
[C]u-[C]u-[C]e-[C]u-[C]o-[C]u-N-[C]u
[C]e-[C]e-[C]o-[C]e-[C]a-[C]e-N-[C]e
[C]o-[C]o-[C]a-[C]o-[C]i-[C]o-N-[C]o
```

Palatalized consonants include the base consonant:
```
kya-kya-kyu-kya-kye-ki-kya-N-kya
```

## Consonant Families Covered

### Basic Consonants (5 strings each)
| Row | Romaji | Kana |
|-----|--------|------|
| K | ka, ki, ku, ke, ko | か行 |
| G | ga, gi, gu, ge, go | が行 |
| S | sa, si, su, se, so | さ行 |
| Z | za, zi, zu, ze, zo | ざ行 |
| T | ta, ti, tu, te, to | た行 |
| D | da, di, du, de, do | だ行 |
| N | na, ni, nu, ne, no | な行 |
| H | ha, hi, hu, he, ho | は行 |
| B | ba, bi, bu, be, bo | ば行 |
| P | pa, pi, pu, pe, po | ぱ行 |
| M | ma, mi, mu, me, mo | ま行 |
| Y | ya, yu, ye, yo | や行 |
| R | ra, ri, ru, re, ro | ら行 |
| W | wa, wi, we, wo | わ行 |

### Palatalized Consonants (4 strings each)
| Row | Romaji | Kana |
|-----|--------|------|
| KY | kya, kyu, kye, kyo | きゃ行 |
| GY | gya, gyu, gye, gyo | ぎゃ行 |
| SH | sha, shi, shu, she, sho | しゃ行 |
| J | ja, ji, ju, je, jo | じゃ行 |
| CH | cha, chi, chu, che, cho | ちゃ行 |
| TS | tsa, tsi, tsu, tse, tso | つぁ行 |
| NY | nya, nyu, nye, nyo | にゃ行 |
| HY | hya, hyu, hye, hyo | ひゃ行 |
| F | fa, fi, fu, fe, fo | ふぁ行 |
| BY | bya, byu, bye, byo | びゃ行 |
| PY | pya, pyu, pye, pyo | ぴゃ行 |
| MY | mya, myu, mye, myo | みゃ行 |
| RY | rya, ryu, rye, ryo | りゃ行 |
| V | va, vi, vu, ve, vo | ヴ行 |

### Vowels (6 strings)
Pure vowel transitions and nasal:
```
a-a-i-a-u-a-e
i-i-u-i-e-i-o
u-u-e-u-o-u-n
e-e-o-e-n-e-a
o-o-n-o-a-o-i
n-n-a-n-i-n-u
```

## OTO Alias Format

Each recording string produces multiple VCV aliases:

```
filename.wav=alias,offset,consonant,cutoff,preutterance,overlap
```

### Alias Types

1. **Initial CV** (start of phrase): `- か` (dash + space + kana)
2. **VCV transition**: `a か` (vowel + space + kana)
3. **Nasal transition**: `n か` (n + space + kana)

### Example OTO Entry

From `ka-ka-ki-ka-ku-ka-N-ka.wav`:
```ini
ka-ka-ki-ka-ku-ka-N-ka.wav=- か,875,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=a か,1375,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=a き,1875,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=i か,2375,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=a く,2875,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=u か,3375,400,-600,300,100
ka-ka-ki-ka-ku-ka-N-ka.wav=n か,4375,400,-600,300,100
```

### Base OTO Values (at 120 BPM)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Initial offset | 875ms | First syllable start |
| Syllable spacing | 500ms | Between each CV |
| Consonant | 400 | Fixed consonant region |
| Cutoff | -600 | From end of sample |
| Preutterance | 300 | Lead time before note |
| Overlap | 100 | Crossfade with previous |

## Implementation Notes

### For Recording UI
- Display romaji strings as prompts (easier to read)
- Use kana for filename and alias generation
- Record at consistent tempo (100-120 BPM recommended)
- Each string should be one continuous utterance

### For OTO Generation
- Parse string to extract syllable sequence
- Generate VCV aliases from adjacent pairs
- First syllable gets `- [kana]` alias (initial CV)
- Subsequent syllables get `[prev_vowel] [kana]` alias
- `N` syllables produce `n [next_kana]` transitions

### Vowel Extraction
To get the vowel from a syllable for VCV alias:
- Most syllables: last character (ka → a, ki → i)
- Palatalized: second-to-last (kya → a, shu → u)
- Special cases: shi → i, chi → i, tsu → u, fu → u

## Resources

- [Wasteland UTAU JP VCV](https://utau.felinewasteland.com/jp/vcv)
- [Wasteland UTAU JP Overview](https://utau.felinewasteland.com/jp/overview)
- [UTAU Language Resources - Japanese](https://utaulanguageresources.weebly.com/japanese.html)
- [UtaForum VCV Reclists](https://utaforum.net/resources/7-mora-5-mora-vcv-reclists.68/)
- [VCV Generator (GitHub)](https://github.com/adlez27/vcv-generator/)
