/**
 * Хелперы проверки статуса сессий источников (фаза ui-control).
 *
 * Единственное место, где определяется «залогинен ли источник». Используется
 * loader'ом /sources. Каждый источник хранит сессию по-разному:
 *  - hh: storageState-файл data/hh-session.json
 *  - wellfound: персистентный profileDir data/wellfound-profile (НЕТ storageState)
 *  - telegram: env.TG_SESSION (StringSession)
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { env } from "~/env.server";
import { STORAGE_STATE_PATH as HH_SESSION_PATH } from "~/hh/session";
import { PROFILE_DIR as WF_PROFILE_DIR } from "~/wellfound/session";

/** Статус сессии источника. */
export type SessionStatus = {
  loggedIn: boolean;
  /** Когда сессия последний раз обновлялась (по файлу/директории). */
  lastSeen: Date | null;
  /** Пояснение для UI (например, «нет storageState-файла»). */
  hint: string;
};

/** Дата самой свежей mtime в директории (рекурсивно, глубина 1). */
function newestMtime(dir: string): Date | null {
  if (!existsSync(dir)) return null;
  let newest: Date | null = null;
  try {
    const entries = readdirSync(dir);
    for (const name of entries) {
      const full = path.join(dir, name);
      try {
        const st = statSync(full);
        const m = st.isDirectory() ? statSync(full).mtime : st.mtime;
        if (newest === null || m > newest) newest = m;
      } catch {
        // ignore individual entries
      }
    }
    // Сама директория.
    const dirMtime = statSync(dir).mtime;
    if (newest === null || dirMtime > newest) newest = dirMtime;
  } catch {
    return null;
  }
  return newest;
}

/** Статус hh-сессии: наличие data/hh-session.json + его возраст. */
export function hhSessionStatus(): SessionStatus {
  if (!existsSync(HH_SESSION_PATH)) {
    return { loggedIn: false, lastSeen: null, hint: "нет storageState-файла — выполните login" };
  }
  try {
    const mtime = statSync(HH_SESSION_PATH).mtime;
    return { loggedIn: true, lastSeen: mtime, hint: "storageState актуален" };
  } catch {
    return { loggedIn: false, lastSeen: null, hint: "storageState-файл недоступен" };
  }
}

/**
 * Статус wellfound-сессии: наличие/свежесть data/wellfound-profile/.
 * У wellfound НЕТ отдельного storageState-файла — сессия в персистентном
 * profileDir (см. app/wellfound/session.ts).
 */
export function wellfoundSessionStatus(): SessionStatus {
  if (!existsSync(WF_PROFILE_DIR)) {
    return { loggedIn: false, lastSeen: null, hint: "нет профиля браузера — выполните login" };
  }
  const newest = newestMtime(WF_PROFILE_DIR);
  // Эвристика: если в директории есть хотя бы один файл — считаем залогиненным.
  // Точнее без запуска браузера не определить.
  return {
    loggedIn: newest !== null,
    lastSeen: newest,
    hint: newest ? "профиль браузера есть (точный статус требует проверки)" : "профиль пуст",
  };
}

/** Статус telegram-сессии: env.TG_SESSION !== "". */
export function telegramSessionStatus(): SessionStatus {
  if (!env.TG_SESSION) {
    return { loggedIn: false, lastSeen: null, hint: "TG_SESSION пуст — выполните login" };
  }
  // Возраст не определить по строке в env; null — честно.
  return {
    loggedIn: true,
    lastSeen: null,
    hint: "StringSession в env (возраст неизвестен)",
  };
}

/**
 * Диспетчер статуса по kind источника.
 * kind="company" — нет понятия сессии (прямой scrape сайтов).
 */
export function sessionStatusByKind(
  kind: "hh" | "aggregator" | "telegram" | "company",
): SessionStatus {
  switch (kind) {
    case "hh":
      return hhSessionStatus();
    case "aggregator":
      // Wellfound — единственный aggregator сейчас.
      return wellfoundSessionStatus();
    case "telegram":
      return telegramSessionStatus();
    case "company":
      return { loggedIn: true, lastSeen: null, hint: "прямой scrape — сессия не нужна" };
  }
}
