import { LIMITS } from "./limits";

/** Removes control and bidi characters and tidies spaces. This is the name people see. */
export function cleanText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanName(input: string): string {
  return cleanText(input).slice(0, LIMITS.nameLength).trim();
}

/** Two names with the same key are the same person: "Anna", " anna " and "ANNA". */
export function nameKey(name: string): string {
  return cleanName(name).normalize("NFKC").toLowerCase();
}
