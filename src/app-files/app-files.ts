// The app-files package: finds and embeds files from the app's own source tree, which only a Bun host can do. cli and
// the check script import it; the engine never does. It imports no other package.
import { appSkillFiles } from './app-skills.macro' with { type: 'macro' };

export { SRC, WORKSPACE_FIXTURE } from './paths';

// The app's own skills from src/skills/, embedded when the app is bundled; keys are relative to that folder. cli hands
// them to the engine as its appSkillFiles.
export const APP_SKILL_FILES: Readonly<Record<string, string>> = appSkillFiles();
