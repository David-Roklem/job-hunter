/**
 * Провайдер z.ai (Zhipu AI, GLM-семейство).
 *
 * Документация (актуально на 2026-06, docs.z.ai):
 *   POST https://api.z.ai/api/paas/v4/chat/completions
 *   Authorization: Bearer <ZAI_API_KEY>
 *   Body: { model, messages, temperature, stream: false }
 *   Response: { choices: [{ message: { content } }] }
 *
 * Ошибки: HTTP status (401/429/500) + внутренний business code в теле
 * { code, message } (1311 — подписка не покрывает модель; 1312 — перегрузка
 * модели; 1313 — rate limit; 1002/1003 — токен невалиден/истёк; 1113 — arrears).
 */
import { z } from "zod";
import { env } from "~/env.server";
import {
  AiProviderError,
  isRetryableError,
  type AiProvider,
  type ChatRequest,
  type ChatResponse,
} from "../types";

const DEFAULT_ENDPOINT = "https://api.z.ai/api/coding/paas/v4/chat/completions";

/** Узкая zod-схема ответа — вытащить choices[0].message.content. */
const responseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1, "ответ не содержит choices"),
});

/** Задержка перед повторной попыткой (мс). */
const RETRY_DELAY_MS = 2000;

export class ZaiProvider implements AiProvider {
  readonly name = "zai";

  constructor(
    private readonly apiKey: string | undefined = env.ZAI_API_KEY,
    private readonly defaultModel: string = env.ZAI_MODEL,
    private readonly endpoint: string = `${env.ZAI_BASE_URL}/chat/completions`,
  ) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (!this.apiKey) {
      throw new AiProviderError(
        "ZAI_API_KEY не задан в окружении",
        this.name,
      );
    }
    const model = req.model ?? this.defaultModel;

    // Одна повторная попытка на retryable-ошибки (429 / 1312).
    try {
      return await this.callOnce(req, model);
    } catch (err) {
      if (err instanceof AiProviderError && isRetryableError(err)) {
        await sleep(RETRY_DELAY_MS);
        return this.callOnce(req, model);
      }
      throw err;
    }
  }

  private async callOnce(
    req: ChatRequest,
    model: string,
  ): Promise<ChatResponse> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        stream: false,
      }),
    });

    // HTTP-ошибка: разобрать тело для классификации. z.ai вкладывает
    // ошибку либо в корень {code,message}, либо в {error:{code,message}}.
    if (!res.ok) {
      const body = await safeJson(res);
      const err = extractErrorFields(body);
      throw new AiProviderError(
        err.message ?? `z.ai HTTP ${res.status}`,
        this.name,
        res.status,
        err.code,
      );
    }

    // Успех оболочки, но внутри может быть business-код (z.ai так делает для
    // некоторых ошибок, например 1312 — перегрузка модели, приходит с 200).
    const data = await res.json().catch(() => null);
    const biz = extractErrorFields(data).code;
    if (biz !== undefined) {
      throw new AiProviderError(
        businessMessage(biz) ?? `z.ai business code ${biz}`,
        this.name,
        res.status,
        biz,
      );
    }

    // Валидация формы ответа.
    const parsed = responseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AiProviderError(
        `неожиданная форма ответа z.ai: ${parsed.error.issues[0]?.message ?? "невалидный JSON"}`,
        this.name,
        res.status,
      );
    }

    return {
      content: parsed.data.choices[0]!.message.content,
      model,
      provider: this.name,
    };
  }
}

/** Дефолтный синглтон для feature-кода. */
export const zai = new ZaiProvider();

// --- хелперы ---------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type ErrorBody = { code?: number; message?: string } | null;

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * z.ai вкладывает ошибку либо в корень {code,message}, либо в
 * {error:{code,message}}. Нормализуем оба варианта.
 * code может быть строкой (z.ai иногда отдаёт "1113") — приводим к number.
 */
function extractErrorFields(
  data: unknown,
): { code?: number; message?: string } {
  if (typeof data !== "object" || data === null) return {};
  const d = data as Record<string, unknown>;
  // Приоритет: вложенный error{}, затем корень.
  const src =
    (typeof d.error === "object" && d.error !== null
      ? (d.error as Record<string, unknown>)
      : null) ?? d;
  const rawCode = src.code;
  const code =
    typeof rawCode === "number"
      ? rawCode
      : typeof rawCode === "string" && /^\d+$/.test(rawCode)
        ? Number(rawCode)
        : undefined;
  const message = typeof src.message === "string" ? src.message : undefined;
  return { code, message };
}

/** Человекочитаемые сообщения для известных business-кодов z.ai. */
function businessMessage(code: number): string | undefined {
  const messages: Record<number, string> = {
    1002: "невалидный Authentication Token (проверьте ZAI_API_KEY)",
    1003: "Authentication Token истёк — перегенерируйте ключ",
    1113: "баланс аккаунта исчерпан — пополните счёт",
    1311: "текущая подписка не включает доступ к модели (проверьте ZAI_MODEL)",
    1312: "модель перегружена — повторите позже или смените модель",
    1313: "превышен лимит запросов (Fair Use Policy)",
  };
  return messages[code];
}
