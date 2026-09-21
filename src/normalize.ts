const QUOTE_CHARACTERS = /[\u0022\u0027\u0060\u2018\u2019\u201c\u201d]/g;
const SEPARATOR_CHARACTERS = /[-/_]/g;
const PUNCTUATION_CHARACTERS = /[^\p{L}\p{N}\s.]|(?<!\p{N})\.(?!\p{N})/gu;
const SPACES = /\s+/g;

export function normalize(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }

  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(QUOTE_CHARACTERS, "")
    .replace(SEPARATOR_CHARACTERS, " ")
    .replace(PUNCTUATION_CHARACTERS, " ")
    .replace(SPACES, " ")
    .trim();
}

export function matchKey(name: string, brand: string | null): string {
  return `${normalize(name)}\u0000${normalize(brand)}`;
}
