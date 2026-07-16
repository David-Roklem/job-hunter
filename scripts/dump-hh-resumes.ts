/**
 * Быстрая проверка: есть ли резюме на hh-аккаунте?
 * Открывает /applicant/resumes (Мои резюме) и печатает список resume-id.
 * Нужен для фазы 11: apply-hh требует resume-id, чтобы выбрать резюме в форме.
 */
import { createContext, isLoggedIn } from "../app/hh/session";

async function main() {
  const ctx = await createContext({ headed: false });
  try {
    const page = await ctx.newPage();
    await page.goto("https://hh.ru/applicant/resumes", {
      waitUntil: "domcontentloaded",
    });
    const loggedIn = await isLoggedIn(page);
    console.log("isLoggedIn:", loggedIn, "| url:", page.url());

    const html = await page.content();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("data/dumps", { recursive: true });
    writeFileSync("data/dumps/hh-resumes.html", html);

    // resume links: /applicant/resumes/view?resume=<id> или /resume/<hash>
    const ids = [
      ...new Set(
        [...html.matchAll(/resume[=/]([a-f0-9]+)/gi)].map((m) => m[1]),
      ),
    ];
    const titles = [...html.matchAll(/data-qa="resume-name"[^>]*>([^<]+)</g)].map(
      (m) => m[1].trim(),
    );
    console.log("resume ids found:", ids.length, ids.slice(0, 5));
    console.log("resume titles:", titles.slice(0, 5));
    console.log("html dumped → data/dumps/hh-resumes.html");
  } finally {
    await ctx.close().catch(() => {});
  }
}
main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
