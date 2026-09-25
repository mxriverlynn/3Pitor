// Preloaded by `make test-ui`: gives UI tests a browser-like DOM (happy-dom) and unmounts
// whatever each test rendered, so tests don't see each other's output.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Testing Library reads the DOM globals when it loads, so it has to come after register().
const { cleanup } = await import('@testing-library/react');
const { afterEach } = await import('bun:test');

afterEach(cleanup);
