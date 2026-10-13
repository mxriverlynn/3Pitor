// The Claude models both Claude backends offer. All four took every level, through the API and through claude, on
// 2026-10-13.
import type { ModelInfo, ThinkingLevel } from '../../../shared/wire';

const LEVELS: ThinkingLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export const CLAUDE_MODELS: readonly ModelInfo[] = [
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', thinking: LEVELS },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', thinking: LEVELS },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', thinking: LEVELS },
  { id: 'claude-fable-5-1', label: 'Fable 5.1', thinking: LEVELS },
];
