/**
 * Логин в Telegram (MTProto, user-аккаунт) — интерактивный, один раз.
 *
 * Запуск: npm run telegram:login
 *
 * Запрашивает phone/code/(2FA password) через readline, вызывает
 * client.start(), печатает StringSession. Пользователь кладёт её в .env
 * как TG_SESSION. После этого telegram:collect работает без интерактива.
 *
 * Требует TG_API_ID/TG_API_HASH в .env (бесплатно на my.telegram.org).
 *
 * Это ручной шаг (как hh:login/wellfound:login) — в автотестах не вызывается.
 */
import { loadEnv } from "./_env";

// ДОЛЖНО быть раньше любого импорта app/* (env.server.ts парсит process.env
// при первом импорте; loadEnv() заполняет process.env из .env). Статический
// import { env } убил бы это — env вычислился бы до loadEnv.
loadEnv();

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

// Теперь .env загружен в process.env — можно читать env.
const { env } = await import("../app/env.server");

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  const answer = await rl.question(question);
  return answer.trim();
}

async function main(): Promise<void> {
  console.log("=== Telegram login (MTProto, user-аккаунт) ===\n");

  if (env.TG_API_ID === undefined || env.TG_API_HASH === undefined) {
    console.error(
      "✗ TG_API_ID/TG_API_HASH не заданы в .env.\n",
      "  Получите бесплатно: https://my.telegram.org → API development tools.\n",
      "  App api_id (число) и App api_hash (строка) → в .env.",
    );
    process.exitCode = 1;
    return;
  }

  if (env.TG_SESSION) {
    // Проверяем, что существующая сессия валидна, прежде чем перезаписывать.
    const existing = new TelegramClient(
      new StringSession(env.TG_SESSION),
      env.TG_API_ID,
      env.TG_API_HASH,
      { connectionRetries: 5 },
    );
    try {
      await existing.connect();
      if ((await existing.checkAuthorization()) === true) {
        console.log("✓ TG_SESSION уже валидна — повторный логин не нужен.");
        console.log("  Для пересоздания удалите TG_SESSION из .env и запустите снова.");
        return;
      }
      await existing.disconnect();
    } catch {
      // невалидная/протухшая — пойдём по пути нового логина ниже
    }
  }

  const rl = readline.createInterface({ input, output });
  const client = new TelegramClient(
    new StringSession(""),
    env.TG_API_ID,
    env.TG_API_HASH,
    { connectionRetries: 5 },
  );

  try {
    console.log("Запускаю интерактивный логин...\n");
    await client.start({
      phoneNumber: async () => await prompt(rl, "Номер телефона (+7...): "),
      phoneCode: async () => await prompt(rl, "Код из SMS/Telegram: "),
      password: async () => await prompt(rl, "2FA-пароль (если включён, иначе Enter): "),
      onError: (err) => {
        console.error("Ошибка аутентификации:", err.message);
        throw err;
      },
    });

    const sessionString = (client.session as StringSession).save();
    console.log("\n✓ Логин успешен.\n");
    console.log("=== StringSession (положить в .env как TG_SESSION) ===");
    console.log(sessionString);
    console.log("=== /StringSession ===\n");
    console.log("Скопируйте строку выше в .env:");
    console.log('  TG_SESSION="<строка выше>"');
    console.log("\nТеперь можно: npm run telegram:seed && npm run telegram:collect -- --source=<id> --profile=<id>");
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exitCode = 1;
  } finally {
    rl.close();
    await client.disconnect().catch(() => {});
  }
}

main();
