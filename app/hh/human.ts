/**
 * Поведенческая имитация (анти-детект уровень 2 — дополнение к Camoufox).
 *
 * Headless-браузер без человеческого поведения детектится по паттернам:
 * мгновенные клики, отсутствие скролла, отсутствие пауз между действиями.
 * Эти хелперы добавляют human-like задержки и плавный скролл.
 *
 * ВНИМАНИЕ: движения курсора убраны в фазе camoufox-stealth — Camoufox
 * `humanize:true` генерирует реалистичные движения мыши через BrowserForge
 * (лучше, чем наши 5-step move). Здесь остаются только задержки и скролл,
 * которые описывают ритм взаимодействия, а не fingerprint браузера.
 *
 * НЕ делает браузер неотличимым от человека — Camoufox (FingerprintForge на
 * уровне движка) + эти хелперы вместе снижают сигналы для бот-детекторов.
 */
import type { Page } from "playwright";

/** Случайная задержка в диапазоне [minMs, maxMs]. */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Плавный скролл страницы (как человек читает список).
 */
export async function humanScroll(page: Page): Promise<void> {
  await page
    .mouse
    .wheel(0, 300 + Math.floor(Math.random() * 400))
    .catch(() => {});
  await humanDelay(500, 1500);
}

/**
 * Комплексное «человеческое» действие перед загрузкой/кликом:
 * скролл + пауза. (Движение мыши убрано — Camoufox humanize покрывает.)
 */
export async function humanPretend(page: Page): Promise<void> {
  await humanScroll(page);
  await humanDelay(800, 2000);
}
