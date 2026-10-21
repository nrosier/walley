export const AUTH_METHODS = ['local', 'oidc'] as const;

export type AuthMethod = (typeof AUTH_METHODS)[number];

/** The mode Walley runs in is one of the methods a session can be created with. */
export type AuthMode = AuthMethod;

export function isAuthMethod(value: unknown): value is AuthMethod {
  return typeof value === 'string' && (AUTH_METHODS as readonly string[]).includes(value);
}
