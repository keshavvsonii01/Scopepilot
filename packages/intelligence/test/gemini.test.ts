import { describe, expect, it } from "vitest";
import { AiProviderError, createGeminiProvider } from "../src/gemini.js";

const KEY = "test-secret-key-123";
const request = { system: "sys", user: "user prompt", responseSchema: { type: "OBJECT" } };

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

async function failure(promise: Promise<unknown>): Promise<AiProviderError> {
  try { await promise; }
  catch (error) {
    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as Error).message).not.toContain(KEY);
    return error as AiProviderError;
  }
  throw new Error("Expected the provider to fail.");
}

describe("createGeminiProvider", () => {
  it("sends a structured JSON request with the key in a header and returns the text", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const provider = createGeminiProvider({
      apiKey: KEY,
      model: "gemini-test",
      fetchImpl: async (url, init) => {
        captured = { url: String(url), init: init! };
        return json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "thinking", thought: true }, { text: "{\"a\":" }, { text: "1}" }] } }] });
      },
    });
    await expect(provider.generate(request)).resolves.toBe("{\"a\":1}");
    expect(captured!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(captured!.url).not.toContain(KEY);
    expect((captured!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(String(captured!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(body.contents[0].parts[0].text).toBe("user prompt");
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseSchema: { type: "OBJECT" } });
  });

  it("maps 429 responses to AI_RATE_LIMITED with retry information", async () => {
    const provider = createGeminiProvider({
      apiKey: KEY,
      model: "m",
      fetchImpl: async () => json({ error: { status: "RESOURCE_EXHAUSTED", message: `quota for ${KEY}`, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17.2s" }] } }, { status: 429 }),
    });
    const error = await failure(provider.generate(request));
    expect(error.code).toBe("AI_RATE_LIMITED");
    expect(error.retryAfterSeconds).toBe(18);
  });

  it.each([
    [500, "AI_PROVIDER_ERROR"],
    [503, "AI_PROVIDER_ERROR"],
    [403, "AI_AUTH_FAILED"],
    [404, "AI_REQUEST_REJECTED"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const provider = createGeminiProvider({ apiKey: KEY, model: "m", fetchImpl: async () => json({ error: { status: "X" } }, { status }) });
    expect((await failure(provider.generate(request))).code).toBe(code);
  });

  it("maps an invalid API key response to AI_AUTH_FAILED", async () => {
    const provider = createGeminiProvider({ apiKey: KEY, model: "m", fetchImpl: async () => json({ error: { status: "INVALID_ARGUMENT", message: "API key not valid." } }, { status: 400 }) });
    expect((await failure(provider.generate(request))).code).toBe("AI_AUTH_FAILED");
  });

  it.each([
    [{ promptFeedback: { blockReason: "SAFETY" } }, "AI_BLOCKED"],
    [{ candidates: [{ finishReason: "SAFETY" }] }, "AI_BLOCKED"],
    [{ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{\"over" }] } }] }, "AI_OUTPUT_TRUNCATED"],
    [{ candidates: [] }, "AI_EMPTY_RESPONSE"],
    [{ candidates: [{ finishReason: "STOP", content: { parts: [] } }] }, "AI_EMPTY_RESPONSE"],
  ])("maps unusable responses (%#) to %s", async (body, code) => {
    const provider = createGeminiProvider({ apiKey: KEY, model: "m", fetchImpl: async () => json(body) });
    expect((await failure(provider.generate(request))).code).toBe(code);
  });

  it("reports timeouts", async () => {
    const provider = createGeminiProvider({
      apiKey: KEY,
      model: "m",
      timeoutMs: 20,
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    expect((await failure(provider.generate(request))).code).toBe("AI_TIMEOUT");
  });

  it("distinguishes caller cancellation and network errors", async () => {
    const hanging = createGeminiProvider({
      apiKey: KEY,
      model: "m",
      fetchImpl: (_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    });
    const controller = new AbortController();
    const pending = hanging.generate(request, controller.signal);
    controller.abort();
    expect((await failure(pending)).code).toBe("AI_ABORTED");

    const offline = createGeminiProvider({ apiKey: KEY, model: "m", fetchImpl: async () => { throw new TypeError(`fetch failed for ${KEY}`); } });
    expect((await failure(offline.generate(request))).code).toBe("AI_NETWORK_ERROR");
  });
});
