// Preloaded by `make test-ui`: gives UI tests a browser-like DOM (happy-dom) and unmounts
// whatever each test rendered, so tests don't see each other's output.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// happy-dom swaps in its own TransformStream but keeps Bun's ReadableStream, and the two don't pipe into
// each other; the AI SDK's chat stream parser needs them to. Keep Bun's.
const { TransformStream } = globalThis;
GlobalRegistrator.register();
globalThis.TransformStream = TransformStream;

// Testing Library reads the DOM globals when it loads, so it has to come after register().
const { cleanup } = await import('@testing-library/react');
const { afterEach } = await import('bun:test');

afterEach(cleanup);
