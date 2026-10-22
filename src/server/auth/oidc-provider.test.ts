import { SignJWT, exportJWK, generateKeyPair, type CryptoKey, type JWK } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import type { OidcConfig } from "../config.js";
import { createOidcProvider, OidcError, type OidcFetch, type OidcFlow } from "./oidc.js";

const ISSUER = "https://idp.example.test";
const CLIENT_ID = "walley-client";
const CLIENT_SECRET = "s3cret-client-value";
const CALLBACK = "https://walley.example.test/api/auth/oidc/callback";
const CONFIG: OidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  clientSecret: CLIENT_SECRET,
  callbackUrl: CALLBACK,
};

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

interface Idp {
  fetch: OidcFetch;
  requests: { url: string; method: string; body: string; auth: string | null }[];
  tokenRequests: () => number;
}

interface IdpOptions {
  claims?: Record<string, unknown>;
  omit?: string[];
  key?: () => CryptoKey;
  metadataIssuer?: string;
  failDiscoveryTimes?: number;
  tokenError?: boolean;
  /** Challenge the token endpoint verifies the verifier against. */
  challenge?: () => string | undefined;
}

function makeIdp(flow: () => OidcFlow, opts: IdpOptions = {}): Idp {
  const requests: Idp["requests"] = [];
  let failures = opts.failDiscoveryTimes ?? 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const impl: OidcFetch = async (input, init) => {
    const url = new URL(input);
    const raw: unknown = init.body;
    const body =
      typeof raw === "string" ? raw : raw instanceof URLSearchParams ? raw.toString() : "";
    const headers = new Headers(init.headers);
    requests.push({
      url: url.href,
      method: init.method,
      body,
      auth: headers.get("authorization"),
    });
    if (url.pathname === "/.well-known/openid-configuration") {
      if (failures > 0) {
        failures -= 1;
        return json({ error: "boom" }, 500);
      }
      return json({
        issuer: opts.metadataIssuer ?? ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json({ keys: [jwk] });
    if (url.pathname === "/token") {
      if (opts.tokenError) {
        return json({ error: "invalid_grant", error_description: "MARKER" }, 400);
      }
      const params = new URLSearchParams(body);
      const expected = opts.challenge?.();
      if (expected !== undefined) {
        const { createHash } = await import("node:crypto");
        const got = createHash("sha256")
          .update(params.get("code_verifier") ?? "")
          .digest("base64url");
        if (got !== expected) return json({ error: "invalid_grant" }, 400);
      }
      const claims: Record<string, unknown> = {
        iss: ISSUER,
        sub: "sub-1",
        aud: CLIENT_ID,
        nonce: flow().nonce,
        email: "kate@x.com",
        email_verified: true,
        ...opts.claims,
      };
      const omit = new Set(opts.omit ?? []);
      const kept = Object.fromEntries(Object.entries(claims).filter(([k]) => !omit.has(k)));
      const now = Math.floor(Date.now() / 1000);
      const idToken = await new SignJWT({ iat: now, exp: now + 300, ...kept })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .sign(opts.key?.() ?? signingKey);
      return json({ access_token: "at", token_type: "Bearer", id_token: idToken, expires_in: 300 });
    }
    return json({ error: "not_found" }, 404);
  };
  return {
    fetch: impl,
    requests,
    tokenRequests: () => requests.filter((r) => r.url.endsWith("/token")).length,
  };
}

function callbackUrl(flow: OidcFlow, extra: Record<string, string> = {}): URL {
  const url = new URL(CALLBACK);
  url.searchParams.set("code", "auth-code");
  url.searchParams.set("state", flow.state);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url;
}

async function setup(opts: IdpOptions = {}) {
  const box: { flow: OidcFlow } = { flow: { state: "", nonce: "", codeVerifier: "" } };
  const idp = makeIdp(() => box.flow, opts);
  const provider = createOidcProvider(CONFIG, idp.fetch);
  const started = await provider.start();
  box.flow = started.flow;
  return { idp, provider, ...started };
}

const failure = async (p: Promise<unknown>): Promise<OidcError> => {
  const error: unknown = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(OidcError);
  return error as OidcError;
};

describe("createOidcProvider", () => {
  it("start builds a code request with PKCE S256, state and nonce, and no response_mode", async () => {
    const { url, flow } = await setup();
    expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
    const q = url.searchParams;
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe(CLIENT_ID);
    expect(q.get("redirect_uri")).toBe(CALLBACK);
    expect(q.get("scope")).toBe("openid email");
    expect(q.get("state")).toBe(flow.state);
    expect(q.get("nonce")).toBe(flow.nonce);
    expect(q.get("code_challenge_method")).toBe("S256");
    expect(q.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(q.has("response_mode")).toBe(false);
    expect(q.has("code_verifier")).toBe(false);
    expect(url.href).not.toContain(flow.codeVerifier);
  });

  it("finish returns the verified identity and authenticates with client_secret_basic", async () => {
    const { idp, provider, flow } = await setup();
    const identity = await provider.finish(callbackUrl(flow), flow);
    expect(identity).toEqual({
      issuer: ISSUER,
      subject: "sub-1",
      email: "kate@x.com",
      emailVerified: true,
    });
    const token = idp.requests.find((r) => r.url.endsWith("/token"));
    expect(token?.auth).toBe(
      // RFC 6749 2.3.1: both parts are form-urlencoded before base64.
      `Basic ${Buffer.from(
        `${encodeURIComponent(CLIENT_ID).replace(/-/g, "%2D")}:${encodeURIComponent(CLIENT_SECRET).replace(/-/g, "%2D")}`,
      ).toString("base64")}`,
    );
    const body = new URLSearchParams(token?.body);
    expect(body.get("redirect_uri")).toBe(CALLBACK);
    expect(body.get("code_verifier")).toBe(flow.codeVerifier);
    expect(body.get("client_secret")).toBeNull();
  });

  it("discovers once and caches the configuration", async () => {
    const { idp, provider, flow } = await setup();
    await provider.finish(callbackUrl(flow), flow);
    await provider.start();
    const discoveries = idp.requests.filter((r) =>
      r.url.endsWith("/.well-known/openid-configuration"),
    );
    expect(discoveries).toHaveLength(1);
  });

  it("a state mismatch fails before any token request", async () => {
    const { idp, provider, flow } = await setup();
    const error = await failure(
      provider.finish(callbackUrl(flow, { state: "other-state" }), flow),
    );
    expect(error.stage).toBe("finish");
    expect(idp.tokenRequests()).toBe(0);
  });

  it("a missing state fails before any token request", async () => {
    const { idp, provider, flow } = await setup();
    const url = callbackUrl(flow);
    url.searchParams.delete("state");
    await failure(provider.finish(url, flow));
    expect(idp.tokenRequests()).toBe(0);
  });

  it("a nonce mismatch is rejected", async () => {
    const { provider, flow } = await setup({ claims: { nonce: "other-nonce" } });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("a missing nonce claim is rejected", async () => {
    const { provider, flow } = await setup({ omit: ["nonce"] });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("rejects a wrong audience", async () => {
    const { provider, flow } = await setup({ claims: { aud: "someone-else" } });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("rejects a single audience with azp set to another party", async () => {
    const { provider, flow } = await setup({
      claims: { aud: CLIENT_ID, azp: "someone-else" },
    });
    const error = await failure(provider.finish(callbackUrl(flow), flow));
    expect(error.stage).toBe("claims");
    expect(error.code).toBe("AZP_MISMATCH");
  });

  it("accepts a single audience with azp equal to the client id", async () => {
    const { provider, flow } = await setup({
      claims: { aud: CLIENT_ID, azp: CLIENT_ID },
    });
    await expect(provider.finish(callbackUrl(flow), flow)).resolves.toMatchObject({
      subject: expect.any(String) as unknown,
    });
  });

  it("rejects a wrong iss", async () => {
    const { provider, flow } = await setup({ claims: { iss: `${ISSUER}/` } });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("rejects an expired token", async () => {
    const { provider, flow } = await setup({
      claims: { exp: Math.floor(Date.now() / 1000) - 3600 },
    });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  describe("iat", () => {
    const iatAt = (offsetSeconds: number) => Math.floor(Date.now() / 1000) + offsetSeconds;

    it("accepts an iat 30 seconds in the future", async () => {
      const { provider, flow } = await setup({ claims: { iat: iatAt(30) } });
      await expect(provider.finish(callbackUrl(flow), flow)).resolves.toBeTruthy();
    });

    it("refuses an iat 61 seconds in the future", async () => {
      const { provider, flow } = await setup({ claims: { iat: iatAt(61) } });
      const error = await failure(provider.finish(callbackUrl(flow), flow));
      expect(error.stage).toBe("claims");
      expect(error.code).toBe("IAT_IN_FUTURE");
    });

    it("accepts an iat of now", async () => {
      const { provider, flow } = await setup({ claims: { iat: iatAt(0) } });
      await expect(provider.finish(callbackUrl(flow), flow)).resolves.toBeTruthy();
    });

    it("accepts an iat 1 hour in the past", async () => {
      const { provider, flow } = await setup({ claims: { iat: iatAt(-3600) } });
      await expect(provider.finish(callbackUrl(flow), flow)).resolves.toBeTruthy();
    });
  });

  it("rejects a token with a bad signature", async () => {
    const { provider, flow } = await setup({ key: () => otherKey });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("rejects a missing sub", async () => {
    const { provider, flow } = await setup({ omit: ["sub"] });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("rejects an over-long sub", async () => {
    const { provider, flow } = await setup({ claims: { sub: "s".repeat(256) } });
    const error = await failure(provider.finish(callbackUrl(flow), flow));
    expect(error.code).toBe("BAD_SUBJECT");
  });

  it("rejects a wrong PKCE verifier at the provider", async () => {
    const { provider, flow } = await setup({ challenge: () => "not-the-challenge" });
    await failure(provider.finish(callbackUrl(flow), flow));
  });

  it("accepts the right PKCE verifier", async () => {
    const box: { challenge?: string } = {};
    const { provider, flow, url } = await setup({ challenge: () => box.challenge });
    box.challenge = url.searchParams.get("code_challenge") ?? undefined;
    await expect(provider.finish(callbackUrl(flow), flow)).resolves.toBeTruthy();
  });

  it("a provider error response gives an OidcError without the provider text", async () => {
    const { idp, provider, flow } = await setup();
    const url = new URL(CALLBACK);
    url.searchParams.set("error", "access_denied");
    url.searchParams.set("error_description", "MARKER");
    url.searchParams.set("state", flow.state);
    const error = await failure(provider.finish(url, flow));
    expect(JSON.stringify(error)).not.toContain("MARKER");
    expect(error.message).not.toContain("MARKER");
    expect(error.cause).toBeUndefined();
    expect(idp.tokenRequests()).toBe(0);
  });

  it("a token endpoint error gives an OidcError without the provider text", async () => {
    const { provider, flow } = await setup({ tokenError: true });
    const error = await failure(provider.finish(callbackUrl(flow), flow));
    expect(`${error.message}${error.code}`).not.toContain("MARKER");
    expect(error.cause).toBeUndefined();
  });

  it("maps email_verified strings and missing emails to unverified or absent", async () => {
    const a = await setup({ claims: { email_verified: "true" } });
    expect((await a.provider.finish(callbackUrl(a.flow), a.flow)).emailVerified).toBe(false);
    const b = await setup({ omit: ["email_verified", "email"] });
    const identity = await b.provider.finish(callbackUrl(b.flow), b.flow);
    expect(identity.emailVerified).toBe(false);
    expect(identity.email).toBeUndefined();
  });

  it("treats an email without exactly one @ as absent", async () => {
    const { provider, flow } = await setup({ claims: { email: "a@b@c" } });
    expect((await provider.finish(callbackUrl(flow), flow)).email).toBeUndefined();
  });

  it("a discovery failure throws, and the next call retries", async () => {
    const idp = makeIdp(() => ({ state: "", nonce: "", codeVerifier: "" }), {
      failDiscoveryTimes: 1,
    });
    const provider = createOidcProvider(CONFIG, idp.fetch);
    const error = await failure(provider.start());
    expect(error.stage).toBe("start");
    await expect(provider.start()).resolves.toBeTruthy();
  });

  it("a discovery document with another issuer fails", async () => {
    const idp = makeIdp(() => ({ state: "", nonce: "", codeVerifier: "" }), {
      metadataIssuer: "https://evil.example.test",
    });
    const provider = createOidcProvider(CONFIG, idp.fetch);
    await failure(provider.start());
  });
});
