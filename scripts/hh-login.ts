/**
 * Логин на hh.ru — ручной, в видимом браузере (капча/2FA).
 *
 * Запуск: npm run hh:login
 *
 * Открывает headed-браузер на hh.ru/account/login, ждёт пока пользователь
 * залогинится (poll isLoggedIn). Сессия (куки/localStorage) сохраняется
 * автоматически через launchPersistentContext в data/hh-profile.
 *
 * После этого hh:collect работает headless, переиспользуя сессию.
 */
import { createContext, isLoggedIn, saveSession } from "../app/hh/session";

const LOGIN_URL = "https://hh.ru/account/login";
const POLL_INTERVAL_MS = 2000;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 минут на ручной логин.

async function main(): Promise<void> {
  console.log("=== hh.ru login ===\n");
  console.log("Открываю браузер. Залогиньтесь вручную (капча/2FA пройдут в окне).\n");

  // Login: чистый context без storageState (не подгружать протухшую сессию).
  const context = await createContext({ headed: true, storageStatePath: null });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    console.log(`Открыта страница входа: ${LOGIN_URL}`);
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
        "\n✗ Таймаут: логин не подтверждён за 5 минут. Повторите npm run hh:login.",
      );
      process.exitCode = 1;
      return;
    }

    console.log("\n✓ Логин подтверждён.");

    // Сохранить сессию (куки+localStorage) в STORAGE_STATE_PATH.
    // launch_server неперсистентен — без этого collect/apply не увидят сессию.
    await saveSession(context);
    console.log("✓ Сессия (storageState) сохранена в data/hh-session.json.");
    console.log("Теперь можно запускать сбор: npm run hh:collect -- --source=1 --profile=1");
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
