import type { InterpretationFailureCode } from "@scopepilot/contracts/interpretation";

export class AiProviderError extends Error {
  constructor(readonly code: InterpretationFailureCode, message: string, readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface GenerationRequest {
  system: string;
  user: string;
  responseSchema: unknown;
}

export interface AiProvider {
  readonly name: "gemini";
  readonly model: string;
  /** Returns the model's raw text output. Throws `AiProviderError` on any failure. */
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<string>;
}

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

interface GeminiErrorBody {
  error?: { status?: string; details?: Array<{ "@type"?: string; retryDelay?: string }> };
}

const BLOCKED_FINISH_REASONS = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "LANGUAGE", "IMAGE_SAFETY"]);

function retryAfter(response: Response, body: GeminiErrorBody | null): number | undefined {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header);
  const delay = body?.error?.details?.find((detail) => detail["@type"]?.endsWith("RetryInfo"))?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

function httpError(response: Response, body: GeminiErrorBody | null): AiProviderError {
  const status = body?.error?.status ? ` (${body.error.status})` : "";
  if (response.status === 429) return new AiProviderError("AI_RATE_LIMITED", `The AI provider rate limit or quota was reached${status}. Try again later.`, retryAfter(response, body));
  if (response.status === 401 || response.status === 403) return new AiProviderError("AI_AUTH_FAILED", `The AI provider rejected the configured credentials${status}.`);
  if (response.status >= 500) return new AiProviderError("AI_PROVIDER_ERROR", `The AI provider returned HTTP ${response.status}${status}.`);
  if (response.status === 400 && body?.error?.status === "INVALID_ARGUMENT" && /api key/i.test(JSON.stringify(body))) return new AiProviderError("AI_AUTH_FAILED", "The AI provider rejected the configured API key.");
  return new AiProviderError("AI_REQUEST_REJECTED", `The AI provider rejected the request with HTTP ${response.status}${status}.`);
}

export function createGeminiProvider(options: GeminiOptions): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const baseUrl = options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";

  return {
    name: "gemini",
    model: options.model,
    async generate(request, signal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}/models/${encodeURIComponent(options.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": options.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: "user", parts: [{ text: request.user }] }],
            generationConfig: { responseMimeType: "application/json", responseSchema: request.responseSchema, temperature: 0.2, maxOutputTokens: options.maxOutputTokens ?? 16_384 },
          }),
          signal: combined,
        });
      } catch {
        if (timeout.aborted) throw new AiProviderError("AI_TIMEOUT", `The AI provider did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
        if (signal?.aborted) throw new AiProviderError("AI_ABORTED", "The interpretation request was cancelled.");
        throw new AiProviderError("AI_NETWORK_ERROR", "The AI provider could not be reached.");
      }

      let body: unknown;
      try { body = await response.json(); }
      catch {
        if (timeout.aborted) throw new AiProviderError("AI_TIMEOUT", `The AI provider did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
        if (!response.ok) throw httpError(response, null);
        throw new AiProviderError("AI_PROVIDER_ERROR", "The AI provider returned a response that was not JSON.");
      }
      if (!response.ok) throw httpError(response, body as GeminiErrorBody);

      const data = body as GeminiResponse;
      if (data.promptFeedback?.blockReason) throw new AiProviderError("AI_BLOCKED", `The AI provider blocked the request (${data.promptFeedback.blockReason}).`);
      const candidate = data.candidates?.[0];
      if (!candidate) throw new AiProviderError("AI_EMPTY_RESPONSE", "The AI provider returned no candidates.");
      if (candidate.finishReason && BLOCKED_FINISH_REASONS.has(candidate.finishReason)) throw new AiProviderError("AI_BLOCKED", `The AI provider stopped generation (${candidate.finishReason}).`);
      if (candidate.finishReason === "MAX_TOKENS") throw new AiProviderError("AI_OUTPUT_TRUNCATED", "The AI response was truncated before it was complete.");
      const text = (candidate.content?.parts ?? []).filter((part) => !part.thought && typeof part.text === "string").map((part) => part.text).join("").trim();
      if (!text) throw new AiProviderError("AI_EMPTY_RESPONSE", "The AI provider returned an empty response.");
      return text;
    },
  };
}
