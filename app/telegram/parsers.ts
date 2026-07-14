/**
 * Парсеры постов Telegram-каналов вакансий — чистые функции.
 *
 * Посты в каналах неструктурированны (нет полей title/salary/skills как у
 * hh/wellfound). Парсеры извлекают скелет эвристиками/регэкспами; сложные поля
 * (зарплата из свободного текста) — через AI (см. salary.ts).
 *
 * НЕ зависят от gramjs/БД/сети — тестируются на синтетических ChannelPost.
 *
 * Соглашения:
 *  - всё best-effort: нет совпадения → null (не падать).
 *  - регистронезависимо (кроме email/url).
 *  - обрезка длины: title ≤ 200 символов (каналы иногда кладут абзац в первую строку).
 */
import type { Api } from "telegram";
import type { ChannelPost } from "./fetch";

/** Максимальная длина title (обрезка с многоточием). */
const TITLE_MAX = 200;

/** Результат извлечения скелета из поста. */
export type ParsedTelegramPost = {
  /** Заголовок вакансии (первая непустая строка / жирная entity). */
  title: string;
  /** Внешняя ссылка (t.me/... на вакансию) или ссылка на сам пост. */
  url: string;
  /** Контакты: @username / email / телефон (для будущего apply / outreach). */
  contacts: string[];
  /** Локация (Remote / город). null если не найдено. */
  location: string | null;
  /** Полный текст поста — идёт в vacancies.description. */
  description: string;
};

/**
 * Извлечь заголовок: первая непустая строка. Если на первой строке есть жирная
 * entity (MessageEntityBold) — берём её текст (вакансии часто выделяют роль жирным).
 *
 * Fallback: «(без заголовка)» — НЕ null, т.к. title NOT NULL в схеме.
 */
export function parseTitle(post: ChannelPost): string {
  // 1. Жирная entity на первой строке — приоритет.
  const boldOnFirstLine = firstLineBold(post);
  if (boldOnFirstLine) return truncate(boldOnFirstLine);

  // 2. Первая непустая строка.
  const firstLine = post.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) return truncate(firstLine);

  return "(без заголовка)";
}

/**
 * Извлечь URL: первая t.me-ссылка из entities (TextUrlEntity/url) или из текста.
 * Если ссылок нет — конструируем ссылку на сам пост: t.me/<channel>/<messageId>.
 *
 * @param channelUsername username канала (без @) — для fallback-ссылки.
 */
export function parseUrl(post: ChannelPost, channelUsername: string): string {
  // 1. Ссылки из entities (гиперссылки в посте — реальная внешняя вакансия).
  for (const e of post.entities) {
    const url = entityUrl(e, post.text);
    if (url) return normalizeTelegramUrl(url);
  }
  // 2. t.me-ссылка прямо в тексте.
  const inline = post.text.match(/https?:\/\/t\.me\/[^\s)<>"']+/i);
  if (inline) return normalizeTelegramUrl(inline[0]);
  // 3. Любая другая http-ссылка в тексте (внешний сайт вакансии).
  const http = post.text.match(/https?:\/\/[^\s)<>"']+/i);
  if (http) return http[0];
  // 4. Fallback: ссылка на сам пост канала.
  return `https://t.me/${channelUsername}/${post.messageId}`;
}

/**
 * Извлечь контакты: @username, email, телефон (российский/международный формат).
 * Без дублей.
 */
export function parseContacts(post: ChannelPost): string[] {
  const found = new Set<string>();
  // @username (Telegram handle). 5–32 символа, не начинающийся с цифры.
  for (const m of post.text.matchAll(/@([a-zA-Z][a-zA-Z0-9_]{4,31})/g)) {
    found.add(`@${m[1]}`);
  }
  // email.
  for (const m of post.text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)) {
    found.add(m[0]);
  }
  // Телефон: требует + в начале ИЛИ классические разделители (скобки/пробелы
  // между группами). Голые числовые диапазоны («250000-350000» — ЗП) так не
  // пишутся, а телефон почти всегда с + или (XXX). 10–15 цифр всего.
  for (const m of post.text.matchAll(/\+?\d[\d\s().-]{8,}\d/g)) {
    const raw = m[0];
    const digits = raw.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) continue;
    // Телефонный формат: либо ведущий «+», либо есть «(», либо пробелы
    // (голая «250000-350000» без + и скобок — не телефон).
    const looksPhone = /^[+]/.test(raw) || /\(/.test(raw) || /\d\s+\d/.test(raw);
    if (looksPhone) found.add(raw.trim());
  }
  return [...found];
}

/**
 * Список маркеров локации и соответствующих нормализованных значений.
 *
 * Границы слов — ЯВНЫЕ (не \b): JS \b по умолчанию ASCII-only и не работает
 * с кириллицей (москв[аы] не матчится с \b). Используем lookaround на
 * не-буквы любого алфавита через \p{L} с флагом u.
 */
const LOCATION_PATTERNS: Array<{ re: RegExp; value: string }> = [
  // Граница НАЧАЛА слова: перед корнем не-буква (\p{L} с флагом u, т.к. \b
  // ASCII-only и не работает с кириллицей). Конец НЕ ограничиваем — корень
  // покрывает все падежи (Москва/Москвы/Москве; удалёнка/удалёнку).
  // Для латиницы — точное совпадение слова (иначе 'remote' матчит 'remotely').
  { re: /(?:^|[^\p{L}])remote(?![\p{L}])/iu, value: "Remote" },
  { re: /(?:^|[^\p{L}])удал[её]нк/iu, value: "Remote" },
  { re: /(?:^|[^\p{L}])remotely(?![\p{L}])/iu, value: "Remote" },
  { re: /(?:^|[^\p{L}])(?:гибрид|hybrid)(?![\p{L}])/iu, value: "Hybrid" },
  { re: /(?:^|[^\p{L}])москв/iu, value: "Москва" },
  { re: /(?:^|[^\p{L}])moscow(?![\p{L}])/iu, value: "Москва" },
  { re: /(?:^|[^\p{L}])(?:санкт-петербург|спб|saint?\s?petersburg|petersburg)(?![\p{L}])/iu, value: "Санкт-Петербург" },
  { re: /(?:^|[^\p{L}])берлин|berlin/iu, value: "Berlin" },
  { re: /(?:^|[^\p{L}])лондон|london/iu, value: "London" },
  { re: /(?:^|[^\p{L}])амстердам|amsterdam/iu, value: "Amsterdam" },
  { re: /(?:^|[^\p{L}])(?:лиссабон|lisbon|lisboa)/iu, value: "Lisbon" },
  { re: /(?:^|[^\p{L}])(?:кипр|cyprus|лимассол|limassol|никосия|nicosia)/iu, value: "Cyprus" },
  { re: /(?:^|[^\p{L}])армени|armenia|ереван|yerevan/iu, value: "Армения" },
  { re: /(?:^|[^\p{L}])серби|serbia|белград|belgrade/iu, value: "Сербия" },
  { re: /(?:^|[^\p{L}])грузи|georgia|тбилиси|tbilisi/iu, value: "Грузия" },
  { re: /(?:^|[^\p{L}])казахстан|kazakhstan|алмат|almaty|астан|astana/iu, value: "Казахстан" },
  { re: /(?:^|[^\p{L}])дубай|dubai/iu, value: "Dubai" },
];

/**
 * Извлечь локацию по ключевым словам. Возвращает первое совпадение.
 * null если ни один маркер не найден.
 */
export function parseLocation(post: ChannelPost): string | null {
  const text = post.text;
  for (const { re, value } of LOCATION_PATTERNS) {
    if (re.test(text)) return value;
  }
  return null;
}

/** Полный текст поста → description (NOT NULL в схеме). */
export function parseDescription(post: ChannelPost): string {
  return post.text.trim() || "(пустой пост)";
}

/**
 * Распарсить пост целиком (для удобства collect.ts).
 */
export function parsePost(
  post: ChannelPost,
  channelUsername: string,
): ParsedTelegramPost {
  return {
    title: parseTitle(post),
    url: parseUrl(post, channelUsername),
    contacts: parseContacts(post),
    location: parseLocation(post),
    description: parseDescription(post),
  };
}

// ---------------------------------------------------------------------------
// Внутренние хелперы.
// ---------------------------------------------------------------------------

/** Текст первой жирной entity, попадающей на первую строку. */
function firstLineBold(post: ChannelPost): string | null {
  const firstLineEnd = post.text.indexOf("\n");
  const firstLineEndPos = firstLineEnd === -1 ? post.text.length : firstLineEnd;
  for (const e of post.entities) {
    if (e.className !== "MessageEntityBold") continue;
    const end = e.offset + e.length;
    // entity начинается в пределах первой строки.
    if (e.offset < firstLineEndPos) {
      const fragment = post.text.slice(e.offset, Math.min(end, firstLineEndPos));
      const cleaned = fragment.trim();
      if (cleaned.length >= 2) return cleaned;
    }
  }
  return null;
}

/** Извлечь URL из entity (TextUrlEntity.url) если это ссылка. */
function entityUrl(
  e: Api.TypeMessageEntity,
  _text: string,
): string | null {
  if (e.className === "MessageEntityTextUrl") {
    const url = (e as Api.MessageEntityTextUrl).url;
    return url ?? null;
  }
  if (e.className === "MessageEntityUrl") {
    // URL прямо в тексте; caller уже ищет регэкспом — пропускаем здесь.
    return null;
  }
  return null;
}

/** Нормализовать Telegram-ссылку (вынести в чистый вид). */
function normalizeTelegramUrl(url: string): string {
  // t.me/username/123 → оставить как есть. Только убираем trailing-мусор.
  return url.replace(/[.,);!?]+$/, "");
}

/** Обрезать до TITLE_MAX с многоточием. */
function truncate(s: string): string {
  const t = s.trim();
  if (t.length <= TITLE_MAX) return t;
  return `${t.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}
