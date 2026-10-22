import { decryptSecret, encryptSecret } from "../crypto/secrets.js";

/** Name of the cookie that carries the sealed flow between login and callback. */
export const OIDC_FLOW_COOKIE = "walley_oidc";
/** Flow cookie lifetime: 600 seconds (orchestrator choice, for owner review). */
export const OIDC_FLOW_TTL_MS = 600_000;
const FLOW_VERSION = 1;

export interface OidcFlowState {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
}

/** Seals the flow with its version and expiry (`exp`, clock plus the TTL). */
export function sealFlow(
  flow: OidcFlowState,
  key: Buffer,
  now: number,
): string {
  return encryptSecret(
    JSON.stringify({
      v: FLOW_VERSION,
      state: flow.state,
      nonce: flow.nonce,
      codeVerifier: flow.codeVerifier,
      exp: now + OIDC_FLOW_TTL_MS,
    }),
    key,
  );
}

/**
 * Returns the flow, or null for any tampered, wrong-key, malformed, wrong-version
 * or expired value. Expired means now >= exp.
 */
export function openFlow(
  value: string | undefined,
  key: Buffer,
  now: number,
): OidcFlowState | null {
  try {
    if (typeof value !== "string") return null;
    const parsed: unknown = JSON.parse(decryptSecret(value, key));
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    const { v, state, nonce, codeVerifier, exp } = p;
    if (
      v !== FLOW_VERSION ||
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof exp !== "number" ||
      !Number.isFinite(exp) ||
      state === "" ||
      nonce === "" ||
      codeVerifier === ""
    ) {
      return null;
    }
    if (now >= exp) return null;
    return { state, nonce, codeVerifier };
  } catch {
    return null;
  }
}
