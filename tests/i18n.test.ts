import { describe, expect, it } from "vitest";
import { en, type Plural } from "../src/client/i18n/en";
import { pickLanguage } from "../src/client/i18n";
import { googleCalendarUrl, prefers24Hour } from "../src/client/format";
import { calendarFile, zonedToUtc } from "../src/worker/ics";

const files = import.meta.glob<{ default: Record<string, string | Plural> }>("../src/client/i18n/locales/*.ts", { eager: true });
const locales = Object.entries(files).map(([path, module]) => [path.split("/").pop()!.replace(".ts", ""), module.default] as const);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const allPlaceholders = (entry: string | Plural) =>
  [...new Set((typeof entry === "string" ? [entry] : Object.values(entry)).flatMap((text) => placeholders(text!)))].sort();

describe("translations", () => {
  it("has no Russian", () => {
    expect(locales.map(([code]) => code)).not.toContain("ru");
  });

  it.each(locales)("%s has every key and nothing extra", (_, messages) => {
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(locales)("%s keeps the placeholders of the English text", (_, messages) => {
    for (const [key, source] of Object.entries(en)) {
      const entry = messages[key];
      // A form like Polish "one" may spell out the number, so {count} can be missing from some forms.
      expect([key, allPlaceholders(entry).filter((name) => name !== "count")]).toEqual([key, allPlaceholders(source).filter((name) => name !== "count")]);
      if (typeof source === "string") expect([key, placeholders(entry as string)]).toEqual([key, placeholders(source)]);
    }
  });

  it.each(locales)("%s has every plural form its language needs", (code, messages) => {
    const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [key, source] of Object.entries(en)) {
      if (typeof source === "string") continue;
      for (const category of categories) expect([key, category, typeof (messages[key] as Plural)[category]]).toEqual([key, category, "string"]);
    }
  });
});

describe("pickLanguage", () => {
  const codes = ["de", "pt", "nb"];
  it("takes the first language with a translation and keeps its region", () => {
    expect(pickLanguage(["pt-BR", "de"], codes)).toEqual({ code: "pt", tag: "pt-BR" });
  });
  it("skips languages without a translation", () => {
    expect(pickLanguage(["ru-RU", "de-AT"], codes)).toEqual({ code: "de", tag: "de-AT" });
  });
  it("falls back to English", () => {
    expect(pickLanguage(["ru"], codes)).toEqual({ code: "en", tag: "en" });
  });
  it("treats all Norwegian tags as one language", () => {
    expect(pickLanguage(["nn-NO"], codes).code).toBe("nb");
    expect(pickLanguage(["no"], codes).code).toBe("nb");
  });
});

describe("clock format", () => {
  it("uses 24-hour time in Europe, whatever the browser's language", () => {
    expect(prefers24Hour("en-US", "Europe/Warsaw")).toBe(true);
    expect(prefers24Hour("en-GB", "Europe/London")).toBe(true);
  });
  it("follows the language elsewhere", () => {
    expect(prefers24Hour("en-US", "America/New_York")).toBe(false);
    expect(prefers24Hour("de-DE", "America/New_York")).toBe(true);
  });
});

describe("googleCalendarUrl", () => {
  it("sends wall-clock times with the group's time zone", () => {
    const url = new URL(
      googleCalendarUrl({ title: "Dinner & drinks", startsAt: "2026-11-13T18:30", endsAt: "2026-11-14T01:00", timezone: "Europe/Warsaw", details: "https://whenucan.app/g/abc" }),
    );
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      action: "TEMPLATE",
      text: "Dinner & drinks",
      dates: "20261113T183000/20261114T010000",
      ctz: "Europe/Warsaw",
      details: "https://whenucan.app/g/abc",
    });
  });
});

describe("calendar files", () => {
  const iso = (local: string, zone: string) => new Date(zonedToUtc(local, zone)).toISOString();
  it("converts wall-clock times across clock changes", () => {
    expect(iso("2026-01-15T18:30", "Europe/Warsaw")).toBe("2026-01-15T17:30:00.000Z");
    expect(iso("2026-07-15T18:30", "Europe/Warsaw")).toBe("2026-07-15T16:30:00.000Z");
    expect(iso("2026-07-15T18:30", "America/New_York")).toBe("2026-07-15T22:30:00.000Z");
    expect(iso("2026-03-29T12:00", "Europe/Warsaw")).toBe("2026-03-29T10:00:00.000Z");
    expect(iso("2026-07-15T18:30", "UTC")).toBe("2026-07-15T18:30:00.000Z");
  });

  it("escapes text and keeps every line within 75 bytes", () => {
    const text = calendarFile({
      uid: "abc@example.com", title: "Żółć, ".repeat(30), description: "line one\nline two; end", url: "https://example.com/g/abc",
      startsAt: "2026-07-15T18:30", endsAt: "2026-07-15T20:00", timezone: "UTC", now: 0,
    });
    const lines = text.split("\r\n");
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(text.replaceAll("\r\n ", "")).toContain("DESCRIPTION:line one\\nline two\\; end");
    expect(text.replaceAll("\r\n ", "")).toContain("SUMMARY:Żółć\\, Żółć");
    expect(lines.at(-1)).toBe("");
    expect(text).not.toMatch(/[^\r]\n/);
  });
});
