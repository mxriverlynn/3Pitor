// The providers, models, and thinking levels the New chat picker offers, and the saved selection it starts on.
import { Hono } from 'hono';
import type { Engine } from '../../../engine/engine';
import type { ModelCatalog } from '../../../shared/wire';

export function modelRoutes(models: Engine['models']): Hono {
  const app = new Hono();

  app.get('/api/models', async (c) => c.json<ModelCatalog>(await models.list()));

  return app;
}
