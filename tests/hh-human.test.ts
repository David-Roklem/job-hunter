/**
 * Тесты app/hh/human.ts (поведенческая имитация).
 *
 * После фазы camoufox-stealth:
 *   - humanMouseMove УБРАН (Camoufox humanize покрывает через BrowserForge)
 *   - humanDelay, humanScroll, humanPretend остались
 *   - humanPretend пересобран: humanScroll + humanDelay (без mousemove)
 */
import { describe, it, expect, vi } from "vitest";
import * as human from "~/hh/human";

// Помечаем модуль как «используется целиком» (иначе vi ругается на side-effect import).
void human;

function fakePage() {
  return {
    mouse: {
      move: vi.fn(async () => {}),
      wheel: vi.fn(async () => {}),
    },
  } as unknown as Parameters<typeof human.humanScroll>[0];
}

describe("human.ts (post-camoufox)", () => {
  it("НЕ экспортирует humanMouseMove (убран в фазе camoufox-stealth)", () => {
    expect((human as Record<string, unknown>).humanMouseMove).toBeUndefined();
  });

  it("экспортирует humanDelay, humanScroll, humanPretend", () => {
    expect(typeof human.humanDelay).toBe("function");
    expect(typeof human.humanScroll).toBe("function");
    expect(typeof human.humanPretend).toBe("function");
  });

  it("humanDelay резолвится без ошибки", async () => {
    // Маленький диапазон, чтобы тест был быстрым.
    await expect(human.humanDelay(1, 2)).resolves.toBeUndefined();
  });

  it("humanScroll вызывает mouse.wheel (скролл — полезный поведенческий сигнал)", async () => {
    const page = fakePage();
    await human.humanScroll(page);
    expect(page.mouse.wheel).toHaveBeenCalled();
  });

  it("humanPretend вызывает mouse.wheel (скролл внутри pretend)", async () => {
    const page = fakePage();
    // humanPretend пересобран без mousemove — только scroll + delay.
    await human.humanPretend(page);
    expect(page.mouse.wheel).toHaveBeenCalled();
  });

  it("humanPretend НЕ вызывает mouse.move (mousemove убран)", async () => {
    const page = fakePage();
    await human.humanPretend(page);
    expect(page.mouse.move).not.toHaveBeenCalled();
  });
});
