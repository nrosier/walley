import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';

const FORWARDED = '203.0.113.9';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function clientIp(
  trustProxy: string[] | false,
  peer: string,
): Promise<string> {
  app = buildApp({ trustProxy });
  app.get('/api/ip', { config: { public: true } }, (request) => request.ip);
  const response = await app.inject({
    method: 'GET',
    url: '/api/ip',
    remoteAddress: peer,
    headers: { 'x-forwarded-for': FORWARDED },
  });
  return response.body;
}

describe('trustProxy', () => {
  it('uses X-Forwarded-For from a trusted peer address', async () => {
    expect(await clientIp(['127.0.0.1'], '127.0.0.1')).toBe(FORWARDED);
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    expect(await clientIp(false, '127.0.0.1')).toBe('127.0.0.1');
  });

  it('ignores X-Forwarded-For from a peer outside the trusted CIDR', async () => {
    expect(await clientIp(['10.0.0.0/8'], '127.0.0.1')).toBe('127.0.0.1');
  });

  it('uses X-Forwarded-For from a peer inside the trusted CIDR', async () => {
    expect(await clientIp(['10.0.0.0/8'], '10.1.2.3')).toBe(FORWARDED);
  });
});
