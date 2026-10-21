import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    config: { public: true },
    schema: {
      response: {
        200: {
          type: 'object',
          properties: { status: { type: 'string', const: 'ok' } },
          required: ['status'],
          additionalProperties: false,
        },
      },
    },
  }, async () => ({ status: 'ok' }));
};
