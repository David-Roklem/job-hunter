/**
 * Интерактивный исследователь формы отклика hh (headed).
 *
 * Открывает форму отклика в видимом браузере и оставляет окно на 5 минут —
 * чтобы изучить UI выбора резюме / поля письма / submit и сообщить селекторы.
 *
 * Запуск: npm exec tsx scripts/explore-apply-form.ts [vacancyId]
 *   без аргумента — последняя hh-вакансия из БД.
 *
 * Выводит в консоль подсказки: что искать, какие data-qa уже видны.
 * НЕ сабмитит — только читает. Безопасно.
 */
import { createContext, isLoggedIn } from "../app/hh/session";

async function pickVacancyId(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("data/job_hunter.sqlite", { readonly: true });
  const row = db
    .prepare(
      "SELECT external_id FROM vacancies WHERE source_id=1 ORDER BY id DESC LIMIT 1",
    )
    .get() as { external_id: string } | undefined;
  db.close();
  if (!row?.external_id)
    throw new Error("нет hh-вакансий в БД — передайте vacancyId аргументом");
  return row.external_id;
}

async function main(): Promise<void> {
  const vacancyId = await pickVacancyId();
  console.log("=== hh apply-form explorer (HEADED) ===\n");
  console.log(`vacancyId: ${vacancyId}\n`);

  const context = await createContext({ headed: true, storageStatePath: null });
  try {
    const page = await context.newPage();

    // Зайти на главную, убедиться что залогинены (форма требует логина).
    await page.goto("https://hh.ru/", { waitUntil: "domcontentloaded" });
    const loggedIn = await isLoggedIn(page);
    console.log(`isLoggedIn: ${loggedIn ? "YES" : "NO"}`);
    if (!loggedIn) {
      console.error(
        "✗ Не залогинен. Сначала npm run hh:login, затем этот скрипт.",
      );
      process.exitCode = 1;
      return;
    }

    // Открыть форму отклика.
    const formUrl = `https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`;
    console.log(`\nОткрываю форму: ${formUrl}`);
    await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    console.log(`\n--- Что искать в окне ---`);
    console.log(`1. КАК ВЫБРАТЬ РЕЗЮМЕ? Есть ли dropdown / кнопка «Изменить»?`);
    console.log(`   - кликни правой кнопкой на блок резюме → «Inspect»`);
    console.log(`   - посмотри data-qa у элемента и списка резюме`);
    console.log(`2. ПОЛЕ ПИСЬМА: тумблер «добавить письмо» → раскроется textarea.`);
    console.log(`   - data-qa textarea? (нужно для подстановки cover_letters.body_md)`);
    console.log(`3. SUBMIT: кнопка vacancy-response-submit-popup.`);
    console.log(`\nОкно открыто 5 минут. Изучи и сообщи селекторы.`);
    console.log(`(скрипт сам закроется через 5 мин)\n`);

    // Подождать 5 минут, периодически печатая живые селекторы.
    const start = Date.now();
    while (Date.now() - start < 5 * 60 * 1000) {
      await new Promise((r) => setTimeout(r, 30_000));
      try {
        const live = await page
          .locator('[data-qa="resume-detail"], [data-qa*="resume" i]')
          .first()
          .innerText()
          .catch(() => "(пусто)");
        console.log(
          `[${Math.round((Date.now() - start) / 1000)}s] resume-detail≈ "${live.replace(/\s+/g, " ").trim().slice(0, 60)}"`,
        );
      } catch {
        // ignore
      }
    }
    console.log("\nВремя вышло, закрываю.");
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
