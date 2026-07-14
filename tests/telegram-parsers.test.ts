/**
 * Тесты парсеров постов Telegram-каналов (чистые функции).
 *
 * Без gramjs/БД/сети — на синтетических ChannelPost. Проверяем извлечение
 * title (жирная entity / первая строка / fallback), url (entity/t.me/http/
 * fallback на пост), contacts (@username/email/телефон), location (маркеры),
 * description (полный текст).
 */
import { describe, expect, it } from "vitest";
import { Api } from "telegram";
import type { ChannelPost } from "~/telegram/fetch";
import {
  parseContacts,
  parseDescription,
  parseLocation,
  parsePost,
  parseTitle,
  parseUrl,
} from "~/telegram/parsers";

/** Построить ChannelPost из текста + entities. */
function post(
  text: string,
  opts: { messageId?: number; entities?: Api.TypeMessageEntity[] } = {},
): ChannelPost {
  return {
    messageId: opts.messageId ?? 100,
    date: 1_700_000_000,
    text,
    textMarkdown: text,
    entities: opts.entities ?? [],
  };
}

/** Жирная entity на [offset, length). */
function bold(offset: number, length: number): Api.MessageEntityBold {
  return new Api.MessageEntityBold({ offset, length });
}

/** TextUrl-ссылка на [offset, length). */
function textUrl(offset: number, length: number, url: string): Api.MessageEntityTextUrl {
  return new Api.MessageEntityTextUrl({ offset, length, url });
}

describe("parseTitle", () => {
  it("берёт первую непустую строку", () => {
    expect(parseTitle(post("Senior Backend Engineer\n\nКомпания X\n..."))).toBe(
      "Senior Backend Engineer",
    );
  });

  it("пропускает пустые строки в начале", () => {
    expect(parseTitle(post("\n\n  \nNode.js разработчик\nописание"))).toBe(
      "Node.js разработчик",
    );
  });

  it("приоритет жирной entity на первой строке", () => {
    const text = "Lead Python Engineer\nостальное";
    // "Lead Python Engineer" = позиции 0..20.
    const p = post(text, { entities: [bold(0, 20)] });
    expect(parseTitle(p)).toBe("Lead Python Engineer");
  });

  it("игнорирует жирную entity не на первой строке", () => {
    const text = "первая строка\n**важное**";
    const p = post(text, { entities: [bold(13, 8)] });
    expect(parseTitle(p)).toBe("первая строка");
  });

  it("fallback при пустом тексте", () => {
    expect(parseTitle(post(""))).toBe("(без заголовка)");
  });

  it("обрезает слишком длинный title с многоточием", () => {
    const long = "A".repeat(300);
    const result = parseTitle(post(long));
    expect(result.length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("parseUrl", () => {
  it("берёт ссылку из TextUrl-entity", () => {
    const text = "Backend dev — откликнуться";
    const p = post(text, {
      entities: [textUrl(0, 11, "https://example.com/jobs/123")],
    });
    expect(parseUrl(p, "jobschannel")).toBe("https://example.com/jobs/123");
  });

  it("берёт t.me-ссылку из текста", () => {
    const text = "Подробнее: https://t.me/somechannel/456 далее";
    expect(parseUrl(post(text), "jobschannel")).toBe(
      "https://t.me/somechannel/456",
    );
  });

  it("берёт произвольную http-ссылку из текста", () => {
    const text = "Отклик: https://careers.acme.com/role/9";
    expect(parseUrl(post(text), "jobschannel")).toBe(
      "https://careers.acme.com/role/9",
    );
  });

  it("fallback на ссылку самого поста", () => {
    expect(parseUrl(post("просто текст", { messageId: 777 }), "jobschannel")).toBe(
      "https://t.me/jobschannel/777",
    );
  });

  it("чистит trailing-пунктуацию у ссылки", () => {
    const text = "Ссылка https://t.me/x/1, далее.";
    expect(parseUrl(post(text), "jobschannel")).toBe("https://t.me/x/1");
  });
});

describe("parseContacts", () => {
  it("извлекает @username", () => {
    const result = parseContacts(post("Пиши @hr_manager или @recruiter1"));
    expect(result).toEqual(
      expect.arrayContaining(["@hr_manager", "@recruiter1"]),
    );
  });

  it("извлекает email", () => {
    const result = parseContacts(post("Отклик: jobs@acme.com"));
    expect(result).toContain("jobs@acme.com");
  });

  it("извлекает телефон (российский формат)", () => {
    const result = parseContacts(post("Звоните +7 (999) 123-45-67"));
    expect(result.some((c) => c.includes("999"))).toBe(true);
  });

  it("извлекает телефон (международный)", () => {
    const result = parseContacts(post("Contact: +1 415 555 2671"));
    expect(result.some((c) => c.includes("415"))).toBe(true);
  });

  it("не путает телефон с суммами (отсекает длинные числовые)", () => {
    // «250000» слишком короткое для ложного троттлинга, но «250000-350000»
    // (11 цифр) НЕ должно быть контактом.
    const result = parseContacts(post("ЗП 250000-350000 руб"));
    expect(result.some((c) => c.includes("250000"))).toBe(false);
  });

  it("убирает дубли", () => {
    // @hr — слишком короткий (Telegram username ≥5 символов), не матчится.
    const result = parseContacts(post("@hr @hr @hr"));
    expect(result).toEqual([]);
    const r2 = parseContacts(post("@valid1 @valid1"));
    expect(r2.filter((c) => c === "@valid1")).toHaveLength(1);
  });

  it("пусто при отсутствии контактов", () => {
    expect(parseContacts(post("вакансия без контактов"))).toEqual([]);
  });
});

describe("parseLocation", () => {
  it("Remote (англ. и рус.)", () => {
    expect(parseLocation(post("Полностью remote работа"))).toBe("Remote");
    expect(parseLocation(post("Удалёнка, полный день"))).toBe("Remote");
  });

  it("Hybrid", () => {
    expect(parseLocation(post("Гибрид 2/3 в офисе"))).toBe("Hybrid");
  });

  it("Город", () => {
    expect(parseLocation(post("Офис в Москве"))).toBe("Москва");
    expect(parseLocation(post("Берлин, relocation"))).toBe("Berlin");
    expect(parseLocation(post("релокация на Кипр"))).toBe("Cyprus");
  });

  it("null при отсутствии маркера", () => {
    expect(parseLocation(post("просто вакансия без локации"))).toBeNull();
  });
});

describe("parseDescription", () => {
  it("полный текст поста", () => {
    const text = "Backend dev\n\nТребования: Node.js, PostgreSQL";
    expect(parseDescription(post(text))).toBe(text);
  });

  it("fallback для пустого поста", () => {
    expect(parseDescription(post("  "))).toBe("(пустой пост)");
  });
});

describe("parsePost (агрегат)", () => {
  it("собирает все поля вместе", () => {
    const text =
      "Senior Backend Engineer\n\nRemote. ЗП $120k.\nКонтакты: @hr_team, jobs@acme.com";
    const p = post(text, { messageId: 42 });
    const parsed = parsePost(p, "jobschannel");
    expect(parsed.title).toBe("Senior Backend Engineer");
    expect(parsed.location).toBe("Remote");
    expect(parsed.contacts).toEqual(
      expect.arrayContaining(["@hr_team", "jobs@acme.com"]),
    );
    expect(parsed.url).toBe("https://t.me/jobschannel/42");
    expect(parsed.description).toBe(text.trim());
  });
});
