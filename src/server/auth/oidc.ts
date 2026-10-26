import * as client from "openid-client";
import type { OidcConfig } from "../config.js";
import type { OidcFlowState } from "./oidc-flow.js";
import type { OidcClaims } from "./oidc-link.js";

/** The state, nonce and PKCE verifier of one login, kept between login and callback. */
export type OidcFlow = OidcFlowState;
/** The verified claims Walley uses. `emailVerified` is the boolean true or false, never a string. */
export type OidcIdentity = OidcClaims;

export interface OidcProvider {
  start(): Promise<{ url: URL; flow: OidcFlow }>;
  /** Exchanges the code and validates the ID token. Throws OidcError on any failure. */
  finish(currentUrl: URL, flow: OidcFlow): Promise<OidcIdentity>;
}

export interface OidcRuntime {
  readonly provider: OidcProvider;
  readonly flowKey: Buffer;
  readonly callbackUrl: string;
}

/** Fixed message and no cause: provider text must never reach a log or a browser. */
export class OidcError extends Error {
  readonly stage: "start" | "finish" | "claims";
  readonly code: string;
  constructor(stage: OidcError["stage"], code: string) {
    super("OIDC failure");
    this.name = "OidcError";
    this.stage = stage;
    this.code = code;
  }
}

const CODE_SHAPE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_SUBJECT_LENGTH = 255;
const MAX_EMAIL_LENGTH = 254;
const IAT_SKEW_SECONDS = 60;

function codeOf(error: unknown): string {
  if (error instanceof OidcError) return error.code;
  if (typeof error === "object" && error !== null) {
    const { code } = error as { code?: unknown };
    if (typeof code === "string" && CODE_SHAPE.test(code)) return code;
  }
  return "UNKNOWN";
}

function wrap(stage: OidcError["stage"], error: unknown): OidcError {
  return error instanceof OidcError
    ? error
    : new OidcError(stage, codeOf(error));
}

function emailOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMAIL_LENGTH)
    return undefined;
  return trimmed.split("@").length === 2 ? trimmed : undefined;
}

/**
 * Production provider. Discovery runs lazily on first use; the configuration is cached on
 * success and the cache is dropped on failure. Tests inject `fetchImpl`.
 */
/** The library's fetch hook type. Its body type is wider than the global fetch accepts. */
export type OidcFetch = NonNullable<
  client.DiscoveryRequestOptions[typeof client.customFetch]
>;

export function createOidcProvider(
  config: OidcConfig,
  fetchImpl?: OidcFetch,
): OidcProvider {
  let discovered: Promise<client.Configuration> | undefined;

  async function discover(): Promise<client.Configuration> {
    const issuerUrl = new URL(config.issuer);
    // Config accepts http only for loopback hosts, so http here means loopback.
    const insecure = issuerUrl.protocol === "http:";
    const options: client.DiscoveryRequestOptions = {
      // Deprecated only to discourage use; here it is gated to an http loopback issuer.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
      ...(fetchImpl === undefined
        ? {}
        : {
            [client.customFetch]: fetchImpl,
          }),
    };
    const configuration = await client.discovery(
      issuerUrl,
      config.clientId,
      undefined,
      client.ClientSecretBasic(config.clientSecret),
      options,
    );
    // Without this the library skips the ID token signature check for token-endpoint responses.
    client.enableNonRepudiationChecks(configuration);
    return configuration;
  }

  function configuration(): Promise<client.Configuration> {
    discovered ??= discover().catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
    return discovered;
  }

  return {
    async start() {
      try {
        const cfg = await configuration();
        const flow: OidcFlow = {
          state: client.randomState(),
          nonce: client.randomNonce(),
          codeVerifier: client.randomPKCECodeVerifier(),
        };
        const url = client.buildAuthorizationUrl(cfg, {
          redirect_uri: config.callbackUrl,
          scope: "openid email",
          state: flow.state,
          nonce: flow.nonce,
          code_challenge: await client.calculatePKCECodeChallenge(
            flow.codeVerifier,
          ),
          code_challenge_method: "S256",
        });
        return { url, flow };
      } catch (error) {
        throw wrap("start", error);
      }
    },

    async finish(currentUrl, flow) {
      let claims: ReturnType<
        Awaited<ReturnType<typeof client.authorizationCodeGrant>>["claims"]
      >;
      let issuer: string | undefined;
      try {
        const cfg = await configuration();
        issuer = cfg.serverMetadata().issuer;
        const tokens = await client.authorizationCodeGrant(cfg, currentUrl, {
          expectedState: flow.state,
          expectedNonce: flow.nonce,
          pkceCodeVerifier: flow.codeVerifier,
          idTokenExpected: true,
        });
        claims = tokens.claims();
      } catch (error) {
        throw wrap("finish", error);
      }
      if (claims === undefined) throw new OidcError("claims", "NO_ID_TOKEN");
      if (claims.iss !== issuer) throw new OidcError("claims", "ISSUER_MISMATCH");
      const { sub } = claims;
      if (
        typeof sub !== "string" ||
        sub === "" ||
        sub.length > MAX_SUBJECT_LENGTH
      ) {
        throw new OidcError("claims", "BAD_SUBJECT");
      }
      // The library checks azp only when aud lists more than one audience.
      if (claims.azp !== undefined && claims.azp !== config.clientId) {
        throw new OidcError("claims", "AZP_MISMATCH");
      }
      // No injectable clock exists in this provider, so Date.now() is the time source.
      if (
        typeof claims.iat === "number" &&
        claims.iat > Math.floor(Date.now() / 1000) + IAT_SKEW_SECONDS
      ) {
        throw new OidcError("claims", "IAT_IN_FUTURE");
      }
      return {
        issuer,
        subject: sub,
        email: emailOf(claims["email"]),
        emailVerified: claims["email_verified"] === true,
      };
    },
  };
}
