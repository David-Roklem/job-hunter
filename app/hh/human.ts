/**
 * Поведенческая имитация (анти-детект уровень 2).
 *
 * Headless-браузер без человеческого поведения детектится по паттернам:
 * мгновенные клики, отсутствие скролла, отсутствие движений мыши. Эти хелперы
 * добавляют human-like задержки и движения перед действиями.
 *
 * НЕ делает браузер неотличимым от человека — снижает сигналы для простых
 * бот-детекторов hh.ru.
 */
import type { Page } from "playwright";

/** Случайная задержка в диапазоне [minMs, maxMs]. */
export function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Лёгкое движение мыши к случайной точке viewport. Имитирует «живой» курсор.
 */
export async function humanMouseMove(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const x = Math.floor(Math.random() * viewport.width);
  const y = Math.floor(Math.random() * viewport.height);
  await page.mouse.move(x, y, { steps: 5 }).catch(() => {});
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
 * движение мыши + скролл + пауза.
 */
export async function humanPretend(page: Page): Promise<void> {
  await humanMouseMove(page);
  await humanDelay(800, 2000);
}
