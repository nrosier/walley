# src/web/i18n map

| File | What it holds | Touch when |
| --- | --- | --- |
| `index.ts` | Public entry (`@/i18n`): re-exports provider, hooks, `LanguageSelect`, locale and translate helpers | Exporting a new i18n helper |
| `I18nProvider.tsx` | `I18nProvider`: locale state (resolved once, or `initialLocale`), stores changes, sets `document.documentElement.lang` | Changing provider behaviour |
| `context.ts` | `LocaleContext`, `useLocale()` (`{ locale, setLocale }`), `useT(catalogue)` (`{ t, errorText, locale }`) | Changing hook API |
| `locale.ts` | Pure: `Locale` (`en`/`nl`), `resolveLocale` (stored `walley-locale`, then first `navigator.languages` with `nl`/`en` prefix, then `en`; storage errors count as missing), `writeLocale` | Locale rules |
| `translate.ts` | Pure: `createT` (dotted, type-checked `MessageKey`, `{name}` params), `format`, `lookup`, `errorText(code, locale)` with generic fallback, `Catalogue` type | Lookup or formatting rules |
| `common.messages.ts` | Shared catalogue: `genericError`, `errors.<server code>`, `language.*` | A new server error code reaches the web app |
| `catalogues.ts` | Registry of every `*.messages.ts` catalogue; read by the parity test | Adding a catalogue (one line) |
| `LanguageSelect.tsx` | Labelled `<select>` (English / Nederlands) with "This device" scope label | Language picker UI |
| `no-literals.test.tsx` | Renders navbar, login (both modes), settings, verify-email and health views in en and nl; asserts nl differs and contains no English-only catalogue sentence | |
| `no-jsx-literals.test.ts` | TypeScript-AST scan of every non-test `src/web/**/*.tsx`: fails with `file:line` on JSX text, literal `{'...'}` children, or literal visible attributes (placeholder, aria-label, title, alt, label, ...) holding a word; `ALLOWED` lists exceptions with a reason | A visible string must stay literal (add to `ALLOWED` with a reason) |
| `i18n.test.tsx` | Parity test over the registry (non-empty nl, same placeholders), translate, locale and picker tests | |

Adding a catalogue: create `Feature.messages.ts` exporting `{ en, nl }` with `nl: typeof en`, then add it to `catalogues.ts`.
