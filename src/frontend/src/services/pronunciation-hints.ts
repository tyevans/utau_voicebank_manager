/**
 * Pronunciation hints for Japanese and English phonemes.
 * Each hint includes English word examples with the target sound highlighted.
 */
export interface PronunciationHint {
  phoneme: string;           // e.g., "ka" or "aa"
  description: string;       // e.g., "Like 'ca' in car"
  examples: string[];        // e.g., ["**ka**raoke", "**ca**r", "**ca**t"]
}

/**
 * Get pronunciation hint for a Japanese phoneme.
 */
export function getPronunciationHint(phoneme: string): PronunciationHint | null {
  return JAPANESE_HINTS[phoneme.toLowerCase()] ?? null;
}

/**
 * Get pronunciation hint for an English ARPABET phoneme.
 */
export function getEnglishPronunciationHint(phoneme: string): PronunciationHint | null {
  return ENGLISH_HINTS[phoneme.toLowerCase()] ?? null;
}

/**
 * Get hints for multiple Japanese phonemes (e.g., from a romaji string like "ka ki ku").
 */
export function getHintsForPrompt(romaji: string): PronunciationHint[] {
  const phonemes = romaji.split(/\s+/);
  // Return unique hints (deduplicated)
  const seen = new Set<string>();
  return phonemes
    .map(p => getPronunciationHint(p))
    .filter((h): h is PronunciationHint => {
      if (h === null || seen.has(h.phoneme)) return false;
      seen.add(h.phoneme);
      return true;
    });
}

/**
 * Get hints for multiple English ARPABET phonemes (e.g., from a string like "k ae t").
 */
export function getEnglishHintsForPrompt(arpabet: string): PronunciationHint[] {
  const phonemes = arpabet.split(/\s+/);
  // Return unique hints (deduplicated)
  const seen = new Set<string>();
  return phonemes
    .map(p => getEnglishPronunciationHint(p))
    .filter((h): h is PronunciationHint => {
      if (h === null || seen.has(h.phoneme)) return false;
      seen.add(h.phoneme);
      return true;
    });
}

const JAPANESE_HINTS: Record<string, PronunciationHint> = {
  // Vowels
  'a': { phoneme: 'a', description: "Like 'a' in father", examples: ['f**a**ther', '**a**rt'] },
  'i': { phoneme: 'i', description: "Like 'ee' in feet", examples: ['f**ee**t', 's**ee**'] },
  'u': { phoneme: 'u', description: "Like 'oo' in food", examples: ['f**oo**d', 'bl**ue**'] },
  'e': { phoneme: 'e', description: "Like 'e' in bed", examples: ['b**e**d', 'r**e**d'] },
  'o': { phoneme: 'o', description: "Like 'o' in go", examples: ['g**o**', 'n**o**'] },

  // K-row
  'ka': { phoneme: 'ka', description: "Like 'ca' in car", examples: ['**ka**raoke', '**ca**r'] },
  'ki': { phoneme: 'ki', description: "Like 'kee' in key", examples: ['**key**', '**ki**ss'] },
  'ku': { phoneme: 'ku', description: "Like 'coo' in cool", examples: ['**coo**l', '**cu**te'] },
  'ke': { phoneme: 'ke', description: "Like 'ke' in kept", examples: ['**ke**pt', '**ca**re'] },
  'ko': { phoneme: 'ko', description: "Like 'co' in code", examples: ['**co**de', '**co**ld'] },

  // S-row
  'sa': { phoneme: 'sa', description: "Like 'sa' in saw", examples: ['**sa**w', '**sa**d'] },
  'shi': { phoneme: 'shi', description: "Like 'she' in sheep", examples: ['**she**ep', '**shi**p'] },
  'su': { phoneme: 'su', description: "Like 'soo' in soon", examples: ['**soo**n', '**su**per'] },
  'se': { phoneme: 'se', description: "Like 'se' in set", examples: ['**se**t', '**se**nd'] },
  'so': { phoneme: 'so', description: "Like 'so' in so", examples: ['**so**', '**so**ft'] },

  // T-row
  'ta': { phoneme: 'ta', description: "Like 'ta' in top", examples: ['**ta**lk', '**ta**p'] },
  'chi': { phoneme: 'chi', description: "Like 'chee' in cheese", examples: ['**chee**se', '**chi**ll'] },
  'tsu': { phoneme: 'tsu', description: "Like 'ts' in cats", examples: ['ca**ts**', 'nu**ts**'] },
  'te': { phoneme: 'te', description: "Like 'te' in ten", examples: ['**te**n', '**te**ll'] },
  'to': { phoneme: 'to', description: "Like 'to' in toe", examples: ['**to**e', '**to**ast'] },

  // N-row
  'na': { phoneme: 'na', description: "Like 'na' in nap", examples: ['**na**p', '**na**me'] },
  'ni': { phoneme: 'ni', description: "Like 'nee' in knee", examples: ['**knee**', '**nee**d'] },
  'nu': { phoneme: 'nu', description: "Like 'noo' in noon", examples: ['**noo**n', '**new**'] },
  'ne': { phoneme: 'ne', description: "Like 'ne' in net", examples: ['**ne**t', '**ne**ver'] },
  'no': { phoneme: 'no', description: "Like 'no' in no", examples: ['**no**', '**no**te'] },

  // H-row
  'ha': { phoneme: 'ha', description: "Like 'ha' in hot", examples: ['**ha**t', '**ha**nd'] },
  'hi': { phoneme: 'hi', description: "Like 'hee' in heat", examples: ['**hea**t', '**he**ro'] },
  'fu': { phoneme: 'fu', description: "Soft 'f', between 'f' and 'h'", examples: ['**foo**d', '**who**'] },
  'he': { phoneme: 'he', description: "Like 'he' in help", examples: ['**he**lp', '**he**ad'] },
  'ho': { phoneme: 'ho', description: "Like 'ho' in hope", examples: ['**ho**pe', '**ho**me'] },

  // M-row
  'ma': { phoneme: 'ma', description: "Like 'ma' in mom", examples: ['**ma**ma', '**ma**p'] },
  'mi': { phoneme: 'mi', description: "Like 'me' in meet", examples: ['**mee**t', '**me**at'] },
  'mu': { phoneme: 'mu', description: "Like 'moo' in moon", examples: ['**moo**n', '**moo**d'] },
  'me': { phoneme: 'me', description: "Like 'me' in met", examples: ['**me**t', '**me**ss'] },
  'mo': { phoneme: 'mo', description: "Like 'mo' in mode", examples: ['**mo**de', '**mo**re'] },

  // Y-row
  'ya': { phoneme: 'ya', description: "Like 'ya' in yard", examples: ['**ya**rd', '**ya**m'] },
  'yu': { phoneme: 'yu', description: "Like 'you'", examples: ['**you**', '**u**se'] },
  'yo': { phoneme: 'yo', description: "Like 'yo' in yoke", examples: ['**yo**ke', '**yo**ga'] },

  // R-row (Japanese R is between L and R)
  'ra': { phoneme: 'ra', description: "Soft R, like 'la' or 'da'", examples: ['**la**ugh', '**ra**in'] },
  'ri': { phoneme: 'ri', description: "Soft R, like 'ree'", examples: ['**ree**d', '**lea**f'] },
  'ru': { phoneme: 'ru', description: "Soft R, like 'roo' or 'loo'", examples: ['**roo**m', '**loo**k'] },
  're': { phoneme: 're', description: "Soft R, like 're' or 'le'", examples: ['**re**d', '**le**t'] },
  'ro': { phoneme: 'ro', description: "Soft R, like 'ro' or 'lo'", examples: ['**ro**ll', '**lo**w'] },

  // W-row
  'wa': { phoneme: 'wa', description: "Like 'wa' in want", examples: ['**wa**nt', '**wa**ter'] },
  'wo': { phoneme: 'wo', description: "Like 'o' in oh", examples: ['**o**h', '**o**wn'] },

  // N (standalone)
  'n': { phoneme: 'n', description: "Humming 'n' sound", examples: ['hu**m**', 'su**n**'] },

  // G-row (voiced K)
  'ga': { phoneme: 'ga', description: "Like 'ga' in garden", examples: ['**ga**rden', '**ga**p'] },
  'gi': { phoneme: 'gi', description: "Like 'gee' in geese", examples: ['**gee**se', '**gi**ft'] },
  'gu': { phoneme: 'gu', description: "Like 'goo' in good", examples: ['**goo**d', '**goo**se'] },
  'ge': { phoneme: 'ge', description: "Like 'ge' in get", examples: ['**ge**t', '**ge**m'] },
  'go': { phoneme: 'go', description: "Like 'go' in go", examples: ['**go**', '**go**ld'] },

  // Z-row (voiced S)
  'za': { phoneme: 'za', description: "Like 'za' in pizza", examples: ['piz**za**', '**za**p'] },
  'ji': { phoneme: 'ji', description: "Like 'jee' in jeep", examples: ['**jee**p', '**gi**ant'] },
  'zu': { phoneme: 'zu', description: "Like 'zoo'", examples: ['**zoo**', '**zu**m'] },
  'ze': { phoneme: 'ze', description: "Like 'ze' in zest", examples: ['**ze**st', '**ze**ro'] },
  'zo': { phoneme: 'zo', description: "Like 'zo' in zone", examples: ['**zo**ne', '**zo**o'] },

  // D-row (voiced T)
  'da': { phoneme: 'da', description: "Like 'da' in dad", examples: ['**da**d', '**da**y'] },
  'di': { phoneme: 'di', description: "Like 'dee' in deep", examples: ['**dee**p', '**di**g'] },
  'du': { phoneme: 'du', description: "Like 'do' in do", examples: ['**do**', '**doo**r'] },
  'de': { phoneme: 'de', description: "Like 'de' in desk", examples: ['**de**sk', '**de**n'] },
  'do': { phoneme: 'do', description: "Like 'do' in dome", examples: ['**do**me', '**do**nut'] },

  // B-row (voiced H)
  'ba': { phoneme: 'ba', description: "Like 'ba' in bat", examples: ['**ba**t', '**ba**ll'] },
  'bi': { phoneme: 'bi', description: "Like 'bee'", examples: ['**bee**', '**bi**g'] },
  'bu': { phoneme: 'bu', description: "Like 'boo'", examples: ['**boo**k', '**boo**t'] },
  'be': { phoneme: 'be', description: "Like 'be' in bed", examples: ['**be**d', '**be**st'] },
  'bo': { phoneme: 'bo', description: "Like 'bo' in boat", examples: ['**bo**at', '**bo**ne'] },

  // P-row
  'pa': { phoneme: 'pa', description: "Like 'pa' in pat", examples: ['**pa**t', '**pa**rk'] },
  'pi': { phoneme: 'pi', description: "Like 'pee' in peel", examples: ['**pee**l', '**pi**n'] },
  'pu': { phoneme: 'pu', description: "Like 'poo' in pool", examples: ['**poo**l', '**pu**sh'] },
  'pe': { phoneme: 'pe', description: "Like 'pe' in pet", examples: ['**pe**t', '**pe**n'] },
  'po': { phoneme: 'po', description: "Like 'po' in pole", examples: ['**po**le', '**po**st'] },
};

/**
 * English ARPABET phoneme pronunciation hints.
 * ARPABET is used by ARPAsing voicebanks for English synthesis.
 */
const ENGLISH_HINTS: Record<string, PronunciationHint> = {
  // Vowels
  'aa': { phoneme: 'aa', description: "'ah' sound as in father", examples: ['f**a**ther', 'h**o**t'] },
  'ae': { phoneme: 'ae', description: "'a' sound as in cat", examples: ['c**a**t', 'b**a**t'] },
  'ah': { phoneme: 'ah', description: "Schwa, as in about", examples: ['**a**bout', 'sof**a**'] },
  'ao': { phoneme: 'ao', description: "'aw' sound as in caught", examples: ['c**au**ght', 'l**aw**'] },
  'aw': { phoneme: 'aw', description: "'ow' sound as in how", examples: ['h**ow**', 'n**ow**'] },
  'ax': { phoneme: 'ax', description: "Reduced schwa", examples: ['ros**e**s', 'tak**e**n'] },
  'ay': { phoneme: 'ay', description: "'i' sound as in buy", examples: ['b**uy**', 'm**y**'] },

  // R-colored vowels
  'er': { phoneme: 'er', description: "R-colored vowel as in bird", examples: ['b**ir**d', 'h**er**'] },

  // Other vowels
  'eh': { phoneme: 'eh', description: "'e' sound as in bed", examples: ['b**e**d', 'r**e**d'] },
  'ey': { phoneme: 'ey', description: "'ay' sound as in say", examples: ['s**ay**', 'd**ay**'] },
  'ih': { phoneme: 'ih', description: "'i' sound as in kit", examples: ['k**i**t', 'b**i**t'] },
  'iy': { phoneme: 'iy', description: "'ee' sound as in bee", examples: ['b**ee**', 's**ee**'] },
  'ow': { phoneme: 'ow', description: "'o' sound as in go", examples: ['g**o**', 'n**o**'] },
  'oy': { phoneme: 'oy', description: "'oy' sound as in boy", examples: ['b**oy**', 't**oy**'] },
  'uh': { phoneme: 'uh', description: "'u' sound as in put", examples: ['p**u**t', 'b**oo**k'] },
  'uw': { phoneme: 'uw', description: "'oo' sound as in food", examples: ['f**oo**d', 'bl**ue**'] },

  // Stops
  'b': { phoneme: 'b', description: "As in bat", examples: ['**b**at', '**b**all'] },
  'd': { phoneme: 'd', description: "As in dog", examples: ['**d**og', '**d**ay'] },
  'g': { phoneme: 'g', description: "As in go", examples: ['**g**o', '**g**ame'] },
  'k': { phoneme: 'k', description: "As in cat", examples: ['**c**at', '**k**ey'] },
  'p': { phoneme: 'p', description: "As in pat", examples: ['**p**at', '**p**en'] },
  't': { phoneme: 't', description: "As in top", examples: ['**t**op', '**t**en'] },

  // Fricatives
  'ch': { phoneme: 'ch', description: "As in cheese", examples: ['**ch**eese', '**ch**air'] },
  'dh': { phoneme: 'dh', description: "Voiced 'th' as in this", examples: ['**th**is', '**th**at'] },
  'f': { phoneme: 'f', description: "As in fish", examples: ['**f**ish', '**f**un'] },
  'hh': { phoneme: 'hh', description: "As in hat", examples: ['**h**at', '**h**ome'] },
  'jh': { phoneme: 'jh', description: "As in judge", examples: ['**j**udge', '**j**ump'] },
  's': { phoneme: 's', description: "As in sun", examples: ['**s**un', '**s**it'] },
  'sh': { phoneme: 'sh', description: "As in ship", examples: ['**sh**ip', '**sh**oe'] },
  'th': { phoneme: 'th', description: "Voiceless 'th' as in think", examples: ['**th**ink', '**th**ree'] },
  'v': { phoneme: 'v', description: "As in van", examples: ['**v**an', '**v**ery'] },
  'z': { phoneme: 'z', description: "As in zoo", examples: ['**z**oo', '**z**ero'] },
  'zh': { phoneme: 'zh', description: "As in measure", examples: ['mea**s**ure', 'vi**s**ion'] },

  // Nasals
  'm': { phoneme: 'm', description: "As in map", examples: ['**m**ap', '**m**om'] },
  'n': { phoneme: 'n', description: "As in not", examples: ['**n**ot', '**n**ine'] },
  'ng': { phoneme: 'ng', description: "As in ring", examples: ['ri**ng**', 'si**ng**'] },

  // Liquids
  'l': { phoneme: 'l', description: "As in love", examples: ['**l**ove', '**l**ight'] },
  'r': { phoneme: 'r', description: "As in run", examples: ['**r**un', '**r**ed'] },

  // Semivowels
  'w': { phoneme: 'w', description: "As in win", examples: ['**w**in', '**w**ay'] },
  'y': { phoneme: 'y', description: "As in yes", examples: ['**y**es', '**y**ou'] },
};
