import { Student } from '../types';

// Standard Thai Kedmanee keyboard to US-QWERTY ASCII map for hardware USB/BT barcode scanners
// when the host OS keyboard input language happens to be set to Thai.
const KEDMANEE_TO_ASCII: Record<string, string> = {
  'ๅ': '1',
  '/': '2',
  '-': '3',
  'ภ': '4',
  'ถ': '5',
  'ุ': '6',
  'ึ': '7',
  'ค': '8',
  'ต': '9',
  'จ': '0',
  'ข': '-',
  'ช': '=',
  '+': '!',
  '๑': '@',
  '๒': '#',
  '๓': '$',
  '๔': '%',
  'ู': '^',
  '฿': '&',
  '๕': '*',
  '๖': '(',
  '๗': ')',
  '๘': '_',
  '๙': '+',
  'ๆ': 'q',
  'ไ': 'w',
  'ำ': 'e',
  'พ': 'r',
  'ะ': 't',
  'ั': 'y',
  'ี': 'u',
  'ร': 'i',
  'น': 'o',
  'ย': 'p',
  'บ': '[',
  'ล': ']',
  'ฃ': '\\',
  '๐': 'Q',
  '"': 'W',
  'ฎ': 'E',
  'ฑ': 'R',
  'ธ': 'T',
  'ํ': 'Y',
  '๊': 'U',
  'ณ': 'I',
  'ฯ': 'O',
  'ญ': 'P',
  'ฐ': '{',
  ',': '}',
  'ฅ': '|',
  'ฟ': 'a',
  'ห': 's',
  'ก': 'd',
  'ด': 'f',
  'เ': 'g',
  '้': 'h',
  '่': 'j',
  'า': 'k',
  'ส': 'l',
  'ว': ';',
  'ง': "'",
  'ฤ': 'A',
  'ฆ': 'S',
  'ฏ': 'D',
  'โ': 'F',
  'ฌ': 'G',
  '็': 'H',
  '๋': 'J',
  'ษ': 'K',
  'ศ': 'L',
  'ซ': ':',
  '.': '"',
  'ผ': 'z',
  'ป': 'x',
  'แ': 'c',
  'อ': 'v',
  'ิ': 'b',
  'ื': 'n',
  'ท': 'm',
  'ม': ',',
  'ใ': '.',
  'ฝ': '/',
  '(': 'Z',
  ')': 'X',
  'ฉ': 'C',
  'ฮ': 'V',
  'ฺ': 'B',
  '์': 'N',
  '?': 'M',
  'ฒ': '<',
  'ฬ': '>',
  'ฦ': '?',
  '_': '`',
  '%': '~',
};

const THAI_CHAR_REGEX = /[\u0E00-\u0E7F]/;

export function kedmaneeToAscii(input: string): string {
  let out = '';
  for (const ch of input) {
    out += KEDMANEE_TO_ASCII[ch] ?? ch;
  }
  return out;
}

/**
 * Normalizes barcode/QR scanner text, automatically recovering accidental Thai Kedmanee
 * keyboard output when it resolves to JSON payload, an existing student code, or a standard ID.
 */
export function normalizeScannedPayload(rawText: string, students: Student[]): string {
  const trimmed = rawText.trim();
  if (!trimmed) return '';

  if (!THAI_CHAR_REGEX.test(trimmed)) {
    return trimmed;
  }

  // If the raw Thai text directly matches a student's name or nickname, keep it as-is
  const directThaiMatch = students.some(
    (s) =>
      s.name.includes(trimmed) ||
      (s.nickname && s.nickname.toLowerCase() === trimmed.toLowerCase())
  );
  if (directThaiMatch) {
    return trimmed;
  }

  // Try converting from Thai Kedmanee keyboard mapping back to English ASCII
  const converted = kedmaneeToAscii(trimmed).trim();
  if (!converted || converted === trimmed) {
    return trimmed;
  }

  // Accept conversion if it parses as valid JSON QR payload
  try {
    const parsed = JSON.parse(converted);
    if (parsed && (parsed.code || parsed.studentCode || parsed.studentID)) {
      return converted;
    }
  } catch {
    // Not JSON; check student match or standard barcode code format
  }

  const upperConverted = converted.toUpperCase();
  const matchedConvertedStudent = students.some(
    (s) =>
      s.studentCode.trim().toUpperCase() === upperConverted ||
      s.id.trim().toUpperCase() === upperConverted
  );
  if (
    matchedConvertedStudent ||
    /^(STD|EMP|CAR)[0-9A-Z_\-]+$/i.test(converted) ||
    /^\d{1,12}$/.test(converted) ||
    converted.includes('text=')
  ) {
    return converted;
  }

  return trimmed;
}
