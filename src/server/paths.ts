// The one place that finds src/ from a file's own location, so every other file can sit at any depth.
// It must stay directly under src/server/; paths.test.ts fails if it moves.
import { resolve } from 'node:path';

export const SRC = resolve(import.meta.dir, '..');
