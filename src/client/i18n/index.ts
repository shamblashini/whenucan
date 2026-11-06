import { Fragment, createElement, type ReactNode } from "react";
import { en, type MessageKey, type Messages, type Plural } from "./en";

type Vars = Record<string, string | number>;

// Each language loads on its own, so visitors only download the one they use.
const locales = import.meta.glob<{ default: Messages }>("./locales/*.ts");
const available = Object.keys(locales).map((path) => path.slice("./locales/".length, -".ts".length));

// Browsers report some languages in several ways.
const ALIASES: Record<string, string> = { no: "nb", nn: "nb", iw: "he", in: "id", tl: "fil" };
const RIGHT_TO_LEFT = new Set(["ar", "he", "fa"]);

// There is no Russian translation on purpose. Russian browsers get Ukrainian, dates included.
const REPLACEMENTS: Record<string, string> = { ru: "uk" };

let messages: Messages = en;
let tag = "en";

/** Chinese is two translations, chosen by the script or region in the tag. */
function languageCode(language: string): string {
  const lower = language.toLowerCase();
  const base = lower.split("-")[0];
  if (base === "zh") return /-(hant|tw|hk|mo)\b/.test(lower) ? "zh-Hant" : "zh-Hans";
  return ALIASES[base] ?? base;
}

/** The first browser language we have a translation for. Regional tags like pt-BR keep their date formats. */
export function pickLanguage(preferred: readonly string[], codes: readonly string[] = available): { code: string; tag: string } {
  for (const language of preferred) {
    const base = language.toLowerCase().split("-")[0];
    const replacement = REPLACEMENTS[base];
    if (replacement && codes.includes(replacement)) return { code: replacement, tag: replacement };
    const code = languageCode(language);
    if (code === "en" || codes.includes(code)) return { code, tag: language };
  }
  return { code: "en", tag: "en" };
}

export async function initI18n(): Promise<void> {
  const picked = pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
  tag = picked.tag;
  if (picked.code !== "en") {
    try {
      messages = (await locales[`./locales/${picked.code}.ts`]()).default;
    } catch {
      // The translation did not download, so the page still works in English.
      tag = "en";
    }
  }
  document.documentElement.lang = tag;
  if (tag !== "en" && RIGHT_TO_LEFT.has(picked.code)) document.documentElement.dir = "rtl";
}

/** The language tag for Intl formatters, so dates match the page's language. */
export function localeTag(): string {
  return tag;
}

function template(key: MessageKey, vars?: Vars): string {
  const entry: string | Plural = messages[key] ?? en[key];
  if (typeof entry === "string") return entry;
  const category = new Intl.PluralRules(tag).select(Number(vars?.count ?? 0));
  return entry[category] ?? entry.other;
}

export function t(key: MessageKey, vars?: Vars): string {
  return template(key, vars).replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

/** Like t, for text with a link or other element in the middle of the sentence. */
export function rich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode[] {
  return template(key)
    .split(/\{(\w+)\}/)
    .map((part, index) => createElement(Fragment, { key: index }, index % 2 ? nodes[part] : part));
}
