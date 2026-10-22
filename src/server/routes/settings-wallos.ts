import type { FastifyPluginAsync } from 'fastify';
import { deriveUserKey } from '../crypto/keys.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { UserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { sendFailure } from './integrations.js';

export interface SettingsWallosDeps {
  readonly repoFor: (userId: string) => UserRepo;
  readonly wallos: Pick<WallosClient, 'listCurrencies'>;
  readonly appSecret: string;
}

export interface SettingsWallosOptions {
  readonly deps: SettingsWallosDeps;
}

const MAX_URL_LENGTH = 2000;
const MAX_KEY_LENGTH = 1000;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns the trimmed URL when it is https (or http on a loopback host) with no credentials, query or fragment. */
export function validateWallosUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '' || value.length > MAX_URL_LENGTH || value.includes('?') || value.includes('#')) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== '' || url.password !== '') return null;
  if (url.protocol === 'https:') return value;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return value;
  return null;
}

/**
 * Per-user Wallos settings. The user id comes from the session. The API key is write-only: it is
 * encrypted on save and no response ever carries it, in full or in part.
 */
export const settingsWallosRoutes: FastifyPluginAsync<SettingsWallosOptions> = async (app, opts) => {
  const { deps } = opts;

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
