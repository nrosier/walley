import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { deriveUserKey } from '../crypto/keys.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { UserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { sendFailure } from './integrations.js';
import { validateServiceUrl } from './service-url.js';

export interface SettingsWallosDeps {
  readonly repoFor: (userId: string) => UserRepo;
  readonly wallos: Pick<WallosClient, 'listCurrencies'>;
  readonly appSecret: string;
}

export interface SettingsWallosOptions {
  readonly deps: SettingsWallosDeps;
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
      return reply.code(500).send({ error: 'internal_error' });
    }
    const saved = repo.getConfig();
    return reply.code(200).send({
      wallosUrl: saved?.wallosUrl ?? '',
      hasWallosApiKey: Boolean(saved?.wallosApiKeyEnc),
    });
  });

  // READ only, with the saved credentials. Form values are not accepted (owner has not decided).
  app.post('/settings/wallos/test', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    try {
      await deps.wallos.listCurrencies(request.auth.userId);
      return await reply.code(200).send({ ok: true });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};
