import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { ActualSessionError } from '../integrations/actual/session.js';
import { ActualWriteError, type PayeeChoice } from '../integrations/actual/write.js';
import {
  createActualScheduleFromWallos,
  createWallosSubscriptionFromActualSchedule,
  CreateFlowError,
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

export interface IntegrationRoutesOptions {
  readonly deps: CreateDeps;
}

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH;
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
function sendFailure(reply: FastifyReply, error: unknown): FastifyReply {
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
      (categoryId !== undefined && !isId(categoryId))
    ) {
      return reply.code(400).send(INVALID);
    }
    try {
      const result = await createActualScheduleFromWallos(deps, request.auth.userId, {
        wallosSubscriptionId: body['wallosSubscriptionId'],
        accountId: body['accountId'],
        payee,
        ...(categoryId === undefined ? {} : { categoryId }),
      });
      return await reply.code(201).send({
        scheduleId: result.scheduleId,
        payeeId: result.payeeId,
        payeeCreated: result.payeeCreated,
        categoryApplied: result.categoryApplied,
        ...(result.categoryError === true ? { categoryError: true } : {}),
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
    if (!isRecord(body) || !isId(body['scheduleId'])) {
      return reply.code(400).send(INVALID);
    }
    try {
      const result = await createWallosSubscriptionFromActualSchedule(deps, request.auth.userId, {
        scheduleId: body['scheduleId'],
      });
      return await reply.code(201).send({ wallosSubscriptionId: result.wallosSubscriptionId });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};
