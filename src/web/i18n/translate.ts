/** Pure message lookup and formatting. No React. */
import { commonMessages } from './common.messages';
import type { Locale } from './locale';

/** A catalogue as exported by a *.messages.ts file: `{ en, nl }` with `nl: typeof en`. */
export interface Catalogue<T extends object> {
  en: T;
  nl: T;
}

export type MessageTree = { readonly [key: string]: string | MessageTree };

/** Dotted paths to the string leaves of a message object, e.g. 'errors.rate_limited'. */
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : T[K] extends object ? `${K}.${MessageKey<T[K]>}` : never;
}[keyof T & string];

export type Params = Readonly<Record<string, string | number>>;

export type TFunction<T> = (key: MessageKey<T>, params?: Params) => string;

/** Returns the string at a dotted path, or undefined when the path does not end at a string. */
export function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, part)) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Replaces {name} placeholders. Placeholders without a matching param are left as is. */
export function format(template: string, params?: Params): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

export function createT<T extends object>(catalogue: Catalogue<T>, locale: Locale): TFunction<T> {
  const messages = catalogue[locale];
  return (key, params) => format(lookup(messages, key) ?? key, params);
}

/** Translated text for a server error code; unknown codes give the generic message. */
export function errorText(code: string, locale: Locale): string {
  const errors = commonMessages[locale].errors;
  return Object.hasOwn(errors, code) ? errors[code as keyof typeof errors] : commonMessages[locale].genericError;
}
