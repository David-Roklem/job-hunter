/**
 * Контракт AI-провайдера и общие типы для chat completion.
 *
 * Общий интерфейс позволяет добавить других провайдеров (Yandex GPT,
 * GigaChat) без переделки feature-кода. Формат — OpenAI-совместимый
 * (role/content), что совпадает с API z.ai.
 */

/** Роль сообщения в chat completion (OpenAI-совместимая). */
export type ChatRole = "system" | "user" | "assistant";

/** Сообщение диалога. */
export type ChatMessage = { role: ChatRole; content: string };

/** Вход провайдера — минимальный общий контракт. */
export type ChatRequest = {
  messages: ChatMessage[];
  /** Переопределить дефолт env. Если не задан — провайдер берёт свой дефолт. */
  model?: string;
  /** Температура генерации. Если не задана — промпт/провайдер дают дефолт. */
  temperature?: number;
};

/** Выход провайдера. */
export type ChatResponse = {
  /** choices[0].message.content. */
  content: string;
  /** Фактически использованная модель (для записи в БД). */
  model: string;
  /** Имя провайдера ("zai" | ...). */
  provider: string;
};

/**
 * Ошибка провайдера — несёт HTTP status и внутренний business code (z.ai),
 * чтобы feature-код мог различать auth / rate-limit / model-not-available.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** true для кодов/статусов, на которые имеет смысл повторить запрос. */
export function isRetryableError(err: AiProviderError): boolean {
  // Business-код 1312 (модель перегружена) или 1313 (rate limit Fair Use) —
  // повтор имеет смысл. 429 сам по себе НЕ retryable: z.ai отдаёт 429 и для
  // 1113 (баланс), что не лечится повтором.
  if (err.code === 1312 || err.code === 1313) return true;
  return false;
}

/** Контракт, который реализует каждый провайдер. */
export interface AiProvider {
  /** Имя провайдера (соответствует значению enum aiProviders). */
  readonly name: string;
  /** Выполнить chat completion. Бросает AiProviderError при сбое. */
  chat(req: ChatRequest): Promise<ChatResponse>;
}
