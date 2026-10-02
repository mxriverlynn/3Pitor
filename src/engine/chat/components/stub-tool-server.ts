// Stands in for the server's serveTools in engine tests: serves nothing, records every call, and counts stops.
import type { LanguageModelV4FunctionTool, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import type { ServeTools } from '../claude-cli/claude-cli';

// What every stubbed call hands claude as its 3pitor MCP server: opaque, JSON-serializable, and not HTTP.
export const STUB_MCP_SERVER = { stub: 'stub-tool-server' } as const;

export interface StubToolServer {
  readonly serveTools: ServeTools;
  readonly served: ReadonlyArray<{
    defs: LanguageModelV4FunctionTool[];
    emit: (part: LanguageModelV4StreamPart) => void;
    abortSignal?: AbortSignal;
  }>;
  readonly stops: number;
}

export function stubToolServer(): StubToolServer {
  const served: StubToolServer['served'][number][] = [];
  let stops = 0;
  return {
    serveTools: (defs, _tools, emit, abortSignal) => {
      served.push({ defs, emit, abortSignal });
      return { mcpServer: STUB_MCP_SERVER, stop: () => void stops++ };
    },
    served,
    get stops() {
      return stops;
    },
  };
}
