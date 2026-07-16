/**
 * Дампер формы отклика hh.ru — разведка для фазы 11 apply-hh.
 *
 * Открывает форму отклика НАПРЯМУЮ через каноничный URL
 * /applicant/vacancy_response?vacancyId=X (тот же href, что у кнопки
 * «Откликнуться» vacancy-response-link-top). Надёжнее клика: не зависит от
 * JS-модалки и не уводит в negotiations.
 *
 * Запуск: npm exec tsx scripts/dump-hh-apply-form.ts [vacancyUrl]
 *   без аргумента — берёт последнюю hh-вакансию из БД.
 *
 * НЕ сабмитит отклик — только читает форму. Безопасно.
 */
import { createContext, isLoggedIn } from "../app/hh/session";

async function pickVacancyUrl(): Promise<string> {
  const arg = process.argv[2];
  if (arg) return arg;
  const Database = (await import("better-sqlite3")).default;
  const db = new Database("data/job_hunter.sqlite", { readonly: true });
  const row = db
    .prepare(
      "SELECT url FROM vacancies WHERE source_id=1 ORDER BY id DESC LIMIT 1",
    )
    .get() as { url: string } | undefined;
  db.close();
  if (!row?.url) throw new Error("нет hh-вакансий в БД — передайте URL аргументом");
  return row.url.split("?")[0]!;
}

async function main(): Promise<void> {
  const url = await pickVacancyUrl();
  console.log("=== hh apply-form dumper ===\n");
  console.log(`vacancy: ${url}\n`);

  const context = await createContext({ headed: false });
  try {
    const page = await context.newPage();

    await page.goto("https://hh.ru/", { waitUntil: "domcontentloaded" });
    const loggedIn = await isLoggedIn(page);
    console.log(`isLoggedIn: ${loggedIn ? "YES" : "NO"}`);
    if (!loggedIn) {
      console.error("✗ Не залогинен. Сначала npm run hh:login, затем этот скрипт.");
      process.exitCode = 1;
      return;
    }

    const idMatch = url.match(/vacancy\/(\d+)/);
    if (!idMatch) {
      console.error(`✗ Не удалось извлечь vacancyId из ${url}`);
      process.exitCode = 1;
      return;
    }
    const vacancyId = idMatch[1]!;

    // Каноничный URL формы отклика.
    const formUrl = `https://hh.ru/applicant/vacancy_response?vacancyId=${vacancyId}`;
    console.log(`\nОткрываю форму напрямую: ${formUrl}`);
    const resp = await page.goto(formUrl, { waitUntil: "domcontentloaded" });
    console.log(`  status: ${resp?.status()}, url: ${page.url()}`);
    // Дать JS-у догрузить форму.
    await page.waitForTimeout(3000);

    const html = await page.content();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("data/dumps", { recursive: true });
    writeFileSync("data/dumps/hh-apply-form.html", html);
    console.log(`\n✓ Форма отклика сдампена → data/dumps/hh-apply-form.html`);
    console.log(`  html: ${html.length} байт`);

    const probes = {
      "resume qa": (html.match(/data-qa="[^"]*resume[^"]*"/gi) || []).length,
      "textarea": (html.match(/<textarea/gi) || []).length,
      "cover/letter": (html.match(/cover|сопроводительн|letter/gi) || []).length,
      "submit qa": (html.match(/data-qa="[^"]*submit[^"]*"/gi) || []).length,
      "resume_id input": (html.match(/name=["']?resume_id/gi) || []).length,
    };
    console.log("  маркеры формы:", JSON.stringify(probes));
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
