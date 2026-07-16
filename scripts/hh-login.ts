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
// 2 минуты на ручной логин — намеренно короткое окно.
// Можно перекрыть через HH_LOGIN_TIMEOUT_MS (мс).
const TIMEOUT_MS = Number(process.env.HH_LOGIN_TIMEOUT_MS ?? 2 * 60 * 1000);

async function main(): Promise<void> {
  console.log("=== hh.ru login ===\n");
  console.log("Открываю браузер. Залогиньтесь вручную (капча/2FA пройдут в окне).\n");

  // Login: чистый context без storageState (не подгружать протухшую сессию).
  const context = await createContext({ headed: true, storageStatePath: null });
  const page = await context.newPage();

  try {
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    console.log(`Открыта страница входа: ${LOGIN_URL}`);
    console.log(`Ожидаю логин... (таймаут ${Math.round(TIMEOUT_MS / 60000)} мин)\n`);

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
        `\n✗ Таймаут: логин не подтверждён за ${Math.round(TIMEOUT_MS / 60000)} мин. ` +
          "Повторите npm run hh:login (или HH_LOGIN_TIMEOUT_MS=... для большего окна).",
      );
      // Диагностика маркеров: дамп HTML главной для разбора, устарели ли data-qa.
      // Помогает отличить «не успел залогиниться» от «залогинился, но маркеры не матчат».
      try {
        await page.goto("https://hh.ru/", { waitUntil: "domcontentloaded" });
        const html = await page.content();
        const { writeFileSync, mkdirSync } = await import("node:fs");
        mkdirSync("data/dumps", { recursive: true });
        writeFileSync("data/dumps/hh-login-timeout.html", html);
        const indicators = {
          "mainmenu_myResumes": (html.match(/mainmenu_myResumes/g) || []).length,
          "account-menu": (html.match(/account-menu/g) || []).length,
          "data-qa=login": (html.match(/data-qa="login[^"]*"/g) || []).length,
          "Войти": (html.match(/Войти|войти/g) || []).length,
          "Мои резюме": (html.match(/Мои резюме/g) || []).length,
          "userinfo": (html.match(/data-qa="userinfo|account-user/g) || []).length,
        };
        console.error("  диагностика маркеров:", JSON.stringify(indicators));
        console.error("  HTML main → data/dumps/hh-login-timeout.html");
      } catch {
        // best-effort
      }
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
