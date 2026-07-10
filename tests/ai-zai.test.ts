/**
 * Юнит-тесты провайдера z.ai (ZaiProvider) с моком globalThis.fetch.
 *
 * Реальная сеть не дёргается. Проверяем: успешный ответ, отсутствие ключа,
 * классификацию ошибок (auth/rate-limit/model-not-available), retry-логику,
 * валидацию формы ответа.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZaiProvider } from "~/ai/providers/zai";
import { AiProviderError, isRetryableError } from "~/ai/types";

/** Успешный ответ z.ai. */
function okResponse(content: string, model = "glm-5.2") {
  return new Response(
    JSON.stringify({
      id: "test",
      model,
      choices: [{ index: 0, message: { role: "assistant", content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** HTTP-ошибка с телом { code, message }. */
function errResponse(status: number, code?: number, message?: string) {
  return new Response(JSON.stringify({ code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ZaiProvider", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("успешный ответ → возвращает content + model", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("письмо текст"));
    const provider = new ZaiProvider("test-key", "glm-5.2", "https://test.example/chat/completions");

    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.content).toBe("письмо текст");
    expect(res.model).toBe("glm-5.2");
    expect(res.provider).toBe("zai");

    // Проверяем формирование запроса.
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test.example/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("glm-5.2");
    expect(body.stream).toBe(false);
    expect(body.messages).toHaveLength(1);
  });

  it("нет API-ключа → AiProviderError без вызова fetch", async () => {
    const provider = new ZaiProvider(undefined, "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({
      name: "AiProviderError",
      message: expect.stringContaining("ZAI_API_KEY"),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("401 auth → AiProviderError, без retry", async () => {
    fetchMock.mockResolvedValueOnce(
      errResponse(401, 1002, "Invalid Authentication Token"),
    );
    const provider = new ZaiProvider("bad-key", "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 401, code: 1002 });
    // auth-ошибка не retryable → ровно 1 вызов.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 → retry → успех (2 вызова)", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429, 1313, "rate limited"))
      .mockResolvedValueOnce(okResponse("письмо после retry"));
    const provider = new ZaiProvider("test-key", "glm-5.2");

    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.content).toBe("письмо после retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("business code 1312 (перегрузка модели, HTTP 200) → retry → успех", async () => {
    // z.ai иногда вкладывает business-код в успешный HTTP-ответ.
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 1312, message: "модель перегружена" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(okResponse("ок"));
    const provider = new ZaiProvider("test-key", "glm-5.2");

    const res = await provider.chat({
      messages: [{ role: "user", content: "hi" }],
    });

    expect(res.content).toBe("ок");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("business code 1311 (модель недоступна в подписке) → ошибка БЕЗ retry", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 1311, message: "no access" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new ZaiProvider("test-key", "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ code: 1311 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 оба раза → ошибка пробрасывается после retry", async () => {
    fetchMock
      .mockResolvedValueOnce(errResponse(429, 1313, "rate limited"))
      .mockResolvedValueOnce(errResponse(429, 1313, "rate limited"));
    const provider = new ZaiProvider("test-key", "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("невалидная форма ответа → AiProviderError от zod", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ foo: "bar" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const provider = new ZaiProvider("test-key", "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ name: "AiProviderError" });
  });

  it("isRetryableError: 1312/1313 → true, 429/401/1113/1311 → false", () => {
    expect(isRetryableError(new AiProviderError("x", "zai", 200, 1312))).toBe(true);
    expect(isRetryableError(new AiProviderError("x", "zai", 429, 1313))).toBe(true);
    // 429 без retryable-кода (баланс 1113) — повтор не поможет.
    expect(isRetryableError(new AiProviderError("x", "zai", 429, 1113))).toBe(false);
    expect(isRetryableError(new AiProviderError("x", "zai", 429))).toBe(false);
    expect(isRetryableError(new AiProviderError("x", "zai", 401, 1002))).toBe(false);
    expect(isRetryableError(new AiProviderError("x", "zai", 200, 1311))).toBe(false);
  });

  it("balance error 1113 (вложенный {error:{}}) → понятное сообщение", async () => {
    // z.ai для PRO/Coding-плана отдаёт 1113 как {error:{code,message}} с HTTP 429.
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: "1113", message: "Insufficient balance" },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    const provider = new ZaiProvider("test-key", "glm-5.2");

    await expect(
      provider.chat({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toMatchObject({ status: 429, code: 1113, message: /Insufficient balance/ });
  });
});
