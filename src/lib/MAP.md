# src/lib

- `auth-mode.ts`: auth method constants and the `isAuthMethod` guard.
- `auth-mode.test.ts`: tests for `auth-mode.ts`.
- `currency-convert.ts`: pure Wallos-rate conversion of integer cents (`convertPriceCents`), rate parsing (`parseRate`), and override-over-Wallos rate selection (`selectRate`), plus `CurrencyConversionError`. No I/O.
- `currency-convert.test.ts`: tests for `currency-convert.ts`.
- `frequency-mapper.ts`: `wallosToActual` and `actualToWallos` frequency mapping, plus `FrequencyMappingError`.
- `frequency-mapper.test.ts`: tests for `frequency-mapper.ts`.
- `match-status.ts`: match status constants and the `isMatchStatus` guard.
- `money.ts`: `toActualCents` and `fromActualCents` conversions between decimals and Actual Budget integer cents.
- `money.test.ts`: tests for `money.ts`.
- `smoke.test.ts`: test runner smoke test.
- `tsconfig.json`: TypeScript config for this directory.
