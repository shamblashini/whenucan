# Contributing

Thanks for helping. Issues and pull requests are both welcome. If you plan a large change, open an issue first so we can agree on it.

To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Fix a translation

All translations were written by a machine, and no native speaker has reviewed them. If something reads wrong in your language, please fix it.

If you only want to point out a mistake, open an issue with the language, the wrong text and what it should say.

To fix it yourself, edit your language in `src/client/i18n/locales/`. You can do this directly on GitHub with the pencil icon. The file is named after the language code, such as `de.ts` for German.

These rules apply to every language:

- **Keep the tone plain and friendly.** Use everyday words. Keep the text about as short as the English, because a lot of it goes on buttons.
- **Keep `{placeholders}` as they are.** Don't translate the word inside the braces. You can move a placeholder to another position in the sentence.
- **Avoid grammar that changes the inserted text.** Names and dates go in exactly as typed. If your language would change the ending of a name, reword the sentence, for example as `Proposed by: {name}`.
- **Use one word for each main term:** organiser, group, proposal and marker.
- **Keep product names as they are:** whenucan, GitHub, Google, Apple, Outlook and Cloudflare. Use the official local name for Google Calendar if there is one.
- **Keep the exact meaning of the privacy text** (`privacy.*`). Don't soften it or add promises.

### Plurals

Keys with an object as their value change with a number:

```ts
"dash.summary": { one: "{range}, {count} person", other: "{range}, {count} people" },
```

Each language needs its own set of forms. To see which forms your language needs, run this with your language code:

```bash
node -e "console.log(new Intl.PluralRules('pl').resolvedOptions().pluralCategories)"
```

Other messages with `{count}`, such as `error.groupFull`, have no plural forms, and the number is normally 10 or more. Word them so the grammar works for any such number.

### Vote labels

`vote.yes`, `vote.ok` and `vote.no` are button labels, so keep them very short. "OK" means "this works, but it isn't ideal", so it sits between yes and no. Japanese and Korean use ○ △ × instead, because schedules there conventionally do.

## Add a language

1. Copy `src/client/i18n/locales/de.ts` to `<language code>.ts` in the same folder.
2. Translate the values, following the rules above. Don't change the keys.
3. Run `pnpm test`.

The app finds the new file by itself. `pnpm test` checks that every key, placeholder and plural form is there.

There are two cases that need a code change in `src/client/i18n/index.ts`:

- **Right-to-left languages:** add the code to `RIGHT_TO_LEFT`.
- **Several browser codes for one language:** add them to `ALIASES`.

Russian is left out on purpose, and Russian browsers get Ukrainian. Please don't add a Russian translation.

## Change the code

Follow the steps in [Run it locally](README.md#run-it-locally). You don't need any Google or Cloudflare credentials.

- `src/client` is the React app, and `src/worker` is the API.
- `src/shared` is code that both use.
- Text belongs in `src/client/i18n/en.ts`, or in `src/shared/errors.ts` for API errors. If you add a key, add it to every language. An English copy is fine if you can't translate it, because `pnpm test` only checks that it is there.
- [docs/design.md](docs/design.md) explains the main decisions.

Before you open a pull request, run these and make sure they pass:

```bash
pnpm typecheck
```

```bash
pnpm test
```

```bash
pnpm test:e2e
```

By contributing, you agree that your work is released under the [MIT License](LICENSE).
