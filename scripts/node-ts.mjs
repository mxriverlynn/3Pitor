// Lets Node load the engine's TypeScript, whose relative imports name no file extension: a relative specifier that
// does not resolve as written is retried with .ts. Used with --experimental-transform-types by `make check-node`.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith('.') || specifier.endsWith('.ts')) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});
