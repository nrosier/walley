import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { deriveUserKey } from '../crypto/keys.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { UpstreamCache } from '../cache/upstream-cache.js';
import type { UserRepo } from '../db/repo.js';
import type { WallosClient, WallosOverride } from '../integrations/wallos/client.js';
import { sendFailure } from './integrations.js';
import { validateServiceUrl } from './service-url.js';
import { createTypedTestGuard } from './typed-test-limit.js';

export interface SettingsWallosDeps {
  readonly repoFor: (userId: string) => UserRepo;
  readonly wallos: Pick<WallosClient, 'listCurrencies'>;
  readonly appSecret: string;
}

export interface SettingsWallosOptions {
  readonly deps: SettingsWallosDeps;
  /** Dropped when the saved Wallos URL or key changes. */
  readonly cache?: UpstreamCache;
}

const MAX_KEY_LENGTH = 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Kept for existing callers; the rules live in validateServiceUrl. */
export const validateWallosUrl = validateServiceUrl;

/**
 * Per-user Wallos settings. The user id comes from the session. The API key is write-only: it is
 * encrypted on save and no response ever carries it, in full or in part.
 */
export const settingsWallosRoutes: FastifyPluginAsync<SettingsWallosOptions> = async (app, opts) => {
  const { deps } = opts;
  // Own limiter for the typed-value test: a separate counter from login and every other route.
  const testGuard = createTypedTestGuard();

  // Body parse failures (malformed JSON, empty body, wrong media type) get a fixed body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/settings/wallos', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const config = deps.repoFor(request.auth.userId).getConfig();
    return reply.code(200).send({
      wallosUrl: config?.wallosUrl ?? '',
      hasWallosApiKey: Boolean(config?.wallosApiKeyEnc),
    });
  });

  app.put('/settings/wallos', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const body: unknown = request.body;
    if (!isRecord(body)) return reply.code(400).send({ error: 'invalid_request' });
    const wallosUrl = validateWallosUrl(body['wallosUrl']);
    const rawKey = body['apiKey'];
    if (wallosUrl === null) return reply.code(400).send({ error: 'invalid_url' });
    if (rawKey !== undefined && rawKey !== null && typeof rawKey !== 'string') {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (apiKey.length > MAX_KEY_LENGTH) return reply.code(400).send({ error: 'invalid_request' });

    const repo = deps.repoFor(request.auth.userId);
    try {
      if (apiKey === '') {
        // Empty keeps the stored key: the key column is not part of the write.
        repo.upsertConfig({ wallosUrl });
      } else {
        const salt = repo.getKeySalt();
        if (salt === undefined) return await reply.code(500).send({ error: 'internal_error' });
        const key = deriveUserKey(deps.appSecret, salt, request.auth.userId);
        repo.upsertConfig({ wallosUrl, wallosApiKeyEnc: encryptSecret(apiKey, key) });
      }
    } catch {
      return await reply.code(500).send({ error: 'internal_error' });
    } finally {
      // The saved URL or key decides which Wallos the cache describes.
      opts.cache?.invalidate(request.auth.userId);
    }
    const saved = repo.getConfig();
    return reply.code(200).send({
      wallosUrl: saved?.wallosUrl ?? '',
      hasWallosApiKey: Boolean(saved?.wallosApiKeyEnc),
    });
  });

  // READ only; nothing is written. The optional body carries the typed, unsaved url and apiKey.
  // A field that is absent or blank falls back to the caller's own saved value. The body is never
  // logged and no response carries a key.
  app.post('/settings/wallos/test', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const userId = request.auth.userId;
    // Before the body is read or any outside call.
    if (testGuard(request, reply, userId)) return reply;
    const body: unknown = request.body;
    if (body !== undefined && body !== null && !isRecord(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const override: { url?: string; apiKey?: string } = {};
    const rawUrl = isRecord(body) ? body['wallosUrl'] : undefined;
    if (rawUrl !== undefined && rawUrl !== null && !(typeof rawUrl === 'string' && rawUrl.trim() === '')) {
      const wallosUrl = validateWallosUrl(rawUrl);
      if (wallosUrl === null) return reply.code(400).send({ error: 'invalid_url' });
      override.url = wallosUrl;
    }
    const rawKey = isRecord(body) ? body['apiKey'] : undefined;
    if (rawKey !== undefined && rawKey !== null) {
      if (typeof rawKey !== 'string' || rawKey.length > MAX_KEY_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (rawKey.trim() !== '') override.apiKey = rawKey.trim();
    }
    // The saved key is sent to whatever host the URL names. A different URL needs the key typed,
    // so a stolen session cannot point the saved secret at another host.
    if (override.url !== undefined && override.apiKey === undefined) {
      const saved = deps.repoFor(userId).getConfig();
      if (saved?.wallosApiKeyEnc && saved.wallosUrl !== override.url) {
        return reply.code(400).send({ error: 'api_key_required' });
      }
    }
    const typed: WallosOverride = override;
    try {
      if (typed.url === undefined && typed.apiKey === undefined) {
        await deps.wallos.listCurrencies(userId);
      } else {
        await deps.wallos.listCurrencies(userId, typed);
      }
      return await reply.code(200).send({ ok: true });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};
