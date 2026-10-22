import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "../crypto/secrets.js";
import { deriveFlowKey } from "../crypto/keys.js";
import {
  OIDC_FLOW_COOKIE,
  OIDC_FLOW_TTL_MS,
  openFlow,
  sealFlow,
} from "./oidc-flow.js";

const NOW = Date.UTC(2030, 0, 1);
const flow = {
  state: "STATE-abc123",
  nonce: "NONCE-xyz789",
  codeVerifier: "VERIFIER-qwerty",
};
const key = deriveFlowKey("app-secret");

describe("oidc flow cookie", () => {
  it("derives a deterministic 32 byte key that depends on the secret", () => {
    expect(key).toHaveLength(32);
    expect(deriveFlowKey("app-secret").equals(key)).toBe(true);
    expect(deriveFlowKey("other").equals(key)).toBe(false);
  });

  it("round trips", () => {
    expect(openFlow(sealFlow(flow, key, NOW), key, NOW)).toEqual(flow);
  });

  it("does not contain the plaintext", () => {
    const value = sealFlow(flow, key, NOW);
    const raw = Buffer.from(value.slice(3), "base64").toString("latin1");
    for (const secret of [flow.state, flow.nonce, flow.codeVerifier]) {
      expect(value).not.toContain(secret);
      expect(raw).not.toContain(secret);
    }
  });

  it("rejects a flipped byte", () => {
    const value = sealFlow(flow, key, NOW);
    const bytes = Buffer.from(value.slice(3), "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(openFlow(`v1:${bytes.toString("base64")}`, key, NOW)).toBeNull();
  });

  it("rejects a wrong key", () => {
    const value = sealFlow(flow, key, NOW);
    expect(openFlow(value, deriveFlowKey("other"), NOW)).toBeNull();
  });

  it("accepts at 599 seconds and rejects at 601 seconds", () => {
    const value = sealFlow(flow, key, NOW);
    expect(openFlow(value, key, NOW + 599_000)).toEqual(flow);
    expect(openFlow(value, key, NOW + 601_000)).toBeNull();
  });

  it("returns null for missing, garbage, non-JSON and wrong-shape values", () => {
    expect(openFlow(undefined, key, NOW)).toBeNull();
    expect(openFlow("garbage", key, NOW)).toBeNull();
    expect(openFlow(encryptSecret("not json", key), key, NOW)).toBeNull();
    expect(openFlow(encryptSecret("null", key), key, NOW)).toBeNull();
    expect(openFlow(encryptSecret("[]", key), key, NOW)).toBeNull();
    expect(
      openFlow(encryptSecret(JSON.stringify({ state: "s" }), key), key, NOW),
    ).toBeNull();
    expect(
      openFlow(
        encryptSecret(JSON.stringify({ v: 1, ...flow, exp: "soon" }), key),
        key,
        NOW,
      ),
    ).toBeNull();
  });

  it("rejects a payload whose version is not 1 or is missing", () => {
    const exp = NOW + 1000;
    for (const v of [2, 0, "1", undefined]) {
      const payload = JSON.stringify({ v, ...flow, exp });
      expect(openFlow(encryptSecret(payload, key), key, NOW)).toBeNull();
    }
    const good = JSON.stringify({ v: 1, ...flow, exp });
    expect(openFlow(encryptSecret(good, key), key, NOW)).toEqual(flow);
  });

  it("refuses at exactly the expiry instant (now >= exp)", () => {
    const value = sealFlow(flow, key, NOW);
    expect(openFlow(value, key, NOW + OIDC_FLOW_TTL_MS - 1)).toEqual(flow);
    expect(openFlow(value, key, NOW + OIDC_FLOW_TTL_MS)).toBeNull();
    expect(openFlow(value, key, NOW + OIDC_FLOW_TTL_MS + 1)).toBeNull();
  });

  it("exposes the cookie name and seals v and exp", () => {
    expect(OIDC_FLOW_COOKIE).toBe("walley_oidc");
    const payload: unknown = JSON.parse(
      decryptSecret(sealFlow(flow, key, NOW), key),
    );
    expect(payload).toEqual({ v: 1, ...flow, exp: NOW + OIDC_FLOW_TTL_MS });
  });
});
