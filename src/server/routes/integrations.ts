import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { ActualSessionError } from '../integrations/actual/session.js';
import { ActualWriteError, type PayeeChoice } from '../integrations/actual/write.js';
import {
  createActualScheduleFromWallos,
  createWallosSubscriptionFromActualSchedule,
  CreateFlowError,
  prefillActualScheduleFromWallos,
  prefillWallosSubscriptionFromSchedule,
  type CreateDeps,
} from '../integrations/create.js';
import {
  WallosAuthError,
  WallosConfigMissing,
  WallosHttpError,
  WallosNetworkError,
  WallosRejectedError,
} from '../integrations/wallos/client.js';
import { WallosMappingError } from '../integrations/wallos/map.js';
import { linkCreatedPair } from '../matching/link-created.js';
import { checkRecreate, repointAfterRecreate, type OrphanRow, type RecreateTarget } from '../matching/relink-orphan.js';

export interface IntegrationRoutesOptions {
  readonly deps: CreateDeps;
}

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH;
}

/** Optional Wallos id: absent or null means "not chosen"; otherwise digit strings only (no numbers). */
function readOptionalDigitId(value: unknown): string | undefined | false {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value.length <= MAX_ID_LENGTH && /^\d+$/.test(value) ? value : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPayee(value: unknown): PayeeChoice | null {
  if (!isRecord(value)) return null;
  if (value['kind'] === 'existing' && isId(value['id'])) {
    return { kind: 'existing', id: value['id'] };
  }
  const name = value['name'];
  if (
    value['kind'] === 'new' &&
    typeof name === 'string' &&
    name.trim() !== '' &&
    name.length <= MAX_NAME_LENGTH
  ) {
    return { kind: 'new', name };
  }
  return null;
}

const INVALID = { error: 'invalid_request' };

/**
 * Maps a failure to a fixed code and status. Never reads error.message: messages and mapping
 * fields can name subscriptions or amounts. Only the class and its typed code decide the answer.
 */
export function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
  const send = (status: number, code: string): FastifyReply => reply.code(status).send({ error: code });
  if (error instanceof CreateFlowError) {
    return send(error.code.endsWith('_not_found') ? 404 : 400, error.code);
  }
  if (error instanceof ActualWriteError) {
    return error.code === 'sync_failed'
      ? send(502, 'actual_sync_failed')
      : send(400, 'invalid_request');
  }
  if (error instanceof ActualSessionError) {
    return error.code === 'not_configured'
      ? send(400, 'actual_not_configured')
      : send(502, 'actual_unavailable');
  }
  if (error instanceof WallosConfigMissing) return send(400, 'wallos_not_configured');
  // 502, not 401: a 401 would read as "your Walley session ended".
  if (error instanceof WallosAuthError) return send(502, 'wallos_auth_failed');
  if (error instanceof WallosRejectedError) return send(502, 'wallos_rejected');
  if (error instanceof WallosHttpError || error instanceof WallosNetworkError) {
    return send(502, 'wallos_unavailable');
  }
  if (error instanceof FrequencyMappingError && error.code === 'patterns_unsupported') {
    return send(400, 'patterns_unsupported');
  }
  if (error instanceof WallosMappingError) return send(400, 'mapping_failed');
  if (error instanceof CurrencyConversionError) return send(400, 'currency_conversion_failed');
  return send(500, 'internal_error');
}

/** Only a plain upper-case code (e.g. SQLITE_FULL) is logged; anything else becomes UNKNOWN. */
function errorCode(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN';
}

/**
 * The remote item already exists, so a failed match insert must not become a 500 (the retry would
 * create a duplicate). Answer with matchCreated false and no matchId, and log one fixed line:
 * route and error code only, never ids or credentials.
 */
async function linkAfterCreate(
  request: FastifyRequest,
  route: string,
  deps: CreateDeps,
  userId: string,
  wallosId: string,
  scheduleId: string,
): Promise<Record<string, unknown>> {
  try {
    const linked = await linkCreatedPair(deps, userId, wallosId, scheduleId);
    return linked === null ? {} : { ...linked };
  } catch (error: unknown) {
    request.log.warn({ route, code: errorCode(error) }, 'match insert failed after create');
    return { matchCreated: false };
  }
}

/**
 * #109 Recreate: the remote item exists, so a failed repoint must not become a 500. Answer 201 with
 * matchRelinked false and log route and code only. The existing row id is always reported.
 */
async function repointAfterCreate(
  request: FastifyRequest,
  route: string,
  deps: CreateDeps,
  userId: string,
  row: OrphanRow,
  target: RecreateTarget,
  newItemId: string,
): Promise<Record<string, unknown>> {
  try {
    const relinked = await repointAfterRecreate(deps, userId, row, target, newItemId);
    if (!relinked) request.log.warn({ route, code: 'NOT_RELINKED' }, 'match repoint failed after create');
    return { matchId: row.id, matchCreated: false, matchRelinked: relinked };
  } catch (error: unknown) {
    request.log.warn({ route, code: errorCode(error) }, 'match repoint failed after create');
    return { matchId: row.id, matchCreated: false, matchRelinked: false };
  }
}

export const integrationRoutes: FastifyPluginAsync<IntegrationRoutesOptions> = async (app, opts) => {
  const { deps } = opts;

  app.post('/integrations/actual-schedules', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body)) return reply.code(400).send(INVALID);
    const payee = readPayee(body['payee']);
    const categoryId = body['categoryId'];
    if (
      !isId(body['wallosSubscriptionId']) ||
      !isId(body['accountId']) ||
      payee === null ||
      (categoryId !== undefined && !isId(categoryId)) ||
      (body['matchId'] !== undefined && !isId(body['matchId']))
    ) {
      return reply.code(400).send(INVALID);
    }
    const matchId = body['matchId'];
    try {
      const row =
        matchId === undefined
          ? undefined
          : await checkRecreate(deps, request.auth.userId, matchId, 'actual', body['wallosSubscriptionId']);
      const result = await createActualScheduleFromWallos(deps, request.auth.userId, {
        wallosSubscriptionId: body['wallosSubscriptionId'],
        accountId: body['accountId'],
        payee,
        ...(categoryId === undefined ? {} : { categoryId }),
      });
      const linked =
        row === undefined
          ? await linkAfterCreate(
              request,
              'actual-schedules',
              deps,
              request.auth.userId,
              body['wallosSubscriptionId'],
              result.scheduleId,
            )
          : await repointAfterCreate(request, 'actual-schedules', deps, request.auth.userId, row, 'actual', result.scheduleId);
      return await reply.code(201).send({
        scheduleId: result.scheduleId,
        payeeId: result.payeeId,
        payeeCreated: result.payeeCreated,
        categoryApplied: result.categoryApplied,
        ...(result.categoryError === true ? { categoryError: true } : {}),
        ...linked,
      });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });

  app.post('/integrations/wallos-subscriptions', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !isId(body['scheduleId']) || (body['matchId'] !== undefined && !isId(body['matchId']))) {
      return reply.code(400).send(INVALID);
    }
    const paymentMethodId = readOptionalDigitId(body['paymentMethodId']);
    const categoryId = readOptionalDigitId(body['categoryId']);
    if (paymentMethodId === false || categoryId === false) return reply.code(400).send(INVALID);
    const matchId = body['matchId'];
    try {
      const row =
        matchId === undefined
          ? undefined
          : await checkRecreate(deps, request.auth.userId, matchId, 'wallos', body['scheduleId']);
      const result = await createWallosSubscriptionFromActualSchedule(deps, request.auth.userId, {
        scheduleId: body['scheduleId'],
        ...(paymentMethodId === undefined ? {} : { paymentMethodId }),
        ...(categoryId === undefined ? {} : { categoryId }),
      });
      const linked =
        row === undefined
          ? await linkAfterCreate(
              request,
              'wallos-subscriptions',
              deps,
              request.auth.userId,
              result.wallosSubscriptionId,
              body['scheduleId'],
            )
          : await repointAfterCreate(
              request,
              'wallos-subscriptions',
              deps,
              request.auth.userId,
              row,
              'wallos',
              result.wallosSubscriptionId,
            );
      return await reply.code(201).send({
        wallosSubscriptionId: result.wallosSubscriptionId,
        ...linked,
      });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });

  // Read-only previews: same derivation as the create routes, no write client is called.
  app.post('/integrations/actual-schedules/prefill', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !isId(body['wallosSubscriptionId'])) {
      return reply.code(400).send(INVALID);
    }
    try {
      const result = await prefillActualScheduleFromWallos(deps, request.auth.userId, {
        wallosSubscriptionId: body['wallosSubscriptionId'],
      });
      return await reply.code(200).send(result);
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });

  app.post('/integrations/wallos-subscriptions/prefill', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !isId(body['scheduleId'])) {
      return reply.code(400).send(INVALID);
    }
    try {
      const result = await prefillWallosSubscriptionFromSchedule(deps, request.auth.userId, {
        scheduleId: body['scheduleId'],
      });
      return await reply.code(200).send(result);
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};
