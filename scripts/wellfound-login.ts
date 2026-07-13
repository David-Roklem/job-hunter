/**
 * Логин на Wellfound — ручной, в видимом браузере.
 *
 * Запуск: npm run wellfound:login
 *
 * Открывает headed-браузер на wellfound.com/login, ждёт пока
 * пользователь залогинится (poll isLoggedIn). Сессия (куки/localStorage)
 * сохраняется автоматически через launchPersistentContext в
 * data/wellfound-profile (ОТДЕЛЬНЫЙ от hh — куки не смешиваются).
 *
 * После этого wellfound:collect работает headless, переиспользуя сессию.
 *
 * Wellfound требует аккаунт для полного доступа (контакты, отклик). Публичные
 * listings частично доступны без логина, но логин повышает покрытие и
 * стабильность сбора.
 */
import { createContext, isLoggedIn } from "../app/wellfound/session";
import { WF_LOGIN_URL } from "../app/wellfound/selectors";

const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 минут на ручной логин.

async function main(): Promise<void> {
  console.log("=== Wellfound login ===\n");
  console.log(
    "Открываю браузер. Залогиньтесь вручную (email + возможная капча в окне).\n",
  );

  const context = await createContext({ headed: true });
  const page = await context.newPage();

  try {
    await page.goto(WF_LOGIN_URL, { waitUntil: "domcontentloaded" });
    console.log(`Открыта страница входа: ${WF_LOGIN_URL}`);
    console.log("Ожидаю логин... (таймаут 5 минут)\n");

    const start = Date.now();
    let loggedIn = false;
    while (Date.now() - start < TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      loggedIn = await isLoggedIn(page).catch(() => false);
      if (loggedIn) break;
      process.stdout.write(".");
    }
    console.log("");

    if (!loggedIn) {
      console.error(
        "\n✗ Таймаут: логин не подтверждён за 5 минут. Повторите npm run wellfound:login.",
      );
      console.error(
        "  Примечание: часть публичных listings доступна и без логина —",
      );
      console.error(
        "  можно пробовать wellfound:collect, но покрытие будет уже.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("\n✓ Логин подтверждён.");
    console.log("✓ Сессия сохранена в data/wellfound-profile (persisted context).");
    console.log(
      "Теперь можно запускать сбор: npm run wellfound:collect -- --source=<id> --profile=<id>",
    );
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
