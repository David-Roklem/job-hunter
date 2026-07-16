/**
 * Smoke-проверка: виден ли отправленный отклик в /applicant/negotiations?
 * Ищет по external_id (vacancyId) в списке откликов hh.
 */
import { createContext, isLoggedIn } from "../app/hh/session";

async function main() {
  const vacancyId = process.argv[2] ?? "135009828";
  const ctx = await createContext({ headed: false });
  try {
    const page = await ctx.newPage();
    await page.goto("https://hh.ru/applicant/negotiations", {
      waitUntil: "domcontentloaded",
    });
    if (!(await isLoggedIn(page))) {
      console.error("✗ Не залогинен");
      process.exitCode = 1;
      return;
    }
    await page.waitForTimeout(2000);
    const html = await page.content();
    // вакансия 135009828 — ссылка /vacancy/135009828 в списке откликов?
    const found = html.includes(`/vacancy/${vacancyId}`);
    console.log(`vacancy ${vacancyId} в откликах: ${found ? "✓ ДА" : "✗ НЕТ"}`);
    // кол-во откликов
    const count = (html.match(/data-qa="negotiations-item"/g) || []).length;
    console.log(`всего negotiations-item на странице: ${count}`);
  } finally {
    await ctx.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
