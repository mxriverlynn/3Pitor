// The app-files package: finds and embeds files from the app's own source tree, which only a Bun host can do. cli and
// the check script import it; the engine never does. It imports no other package.
export { SRC, WORKSPACE_FIXTURE } from './paths';
