import { createGeminiProvider, draftProposal, interpretAudit, PROMPT_VERSION } from "@scopepilot/intelligence";
import type { Drafter, Interpreter } from "./app.js";

/** The provider timeout bounds the synchronous interpretation request. */
export const AI_TIMEOUT_MS = 60_000;

export function createAiServices(config: { apiKey: string; model: string } | null): { interpreter: Interpreter | null; drafter: Drafter | null } {
  if (!config) return { interpreter: null, drafter: null };
  const provider = createGeminiProvider({ apiKey: config.apiKey, model: config.model, timeoutMs: AI_TIMEOUT_MS });
  return {
    interpreter: {
      provider: provider.name,
      model: provider.model,
      promptVersion: PROMPT_VERSION,
      interpret: ({ analysis, rootUrl }) => interpretAudit({ analysis, rootUrl, provider }),
    },
    drafter: {
      model: provider.model,
      draft: (input) => draftProposal({ ...input, provider }),
    },
  };
}

export function createInterpreter(config: { apiKey: string; model: string } | null): Interpreter | null {
  return createAiServices(config).interpreter;
}
