import { expect, test } from 'bun:test';
import type { Engine } from '../../../engine/engine';
import type { ModelCatalog } from '../../../shared/wire';
import { modelRoutes } from './models.routes';

test('GET /api/models answers with the engine\'s catalog', async () => {
  const catalog: ModelCatalog = {
    providers: [{ id: 'ollama', label: 'Ollama', access: 'local', problem: 'Ollama is not running at http://localhost:11434', models: [] }],
    selected: { provider: 'claude-api', model: 'claude-haiku-5-5', thinking: 'medium' },
  };
  const models = { list: async () => catalog } as Engine['models'];
  const res = await modelRoutes(models).request('/api/models');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(catalog);
});
