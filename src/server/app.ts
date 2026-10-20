import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
}

export function buildApp(opts?: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts?.logger ?? false });
  void app.register(healthRoutes, { prefix: '/api' });
  return app;
}
