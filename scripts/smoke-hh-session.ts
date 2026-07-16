/**
 * Диагностический smoke: проверяет, переживает ли storageState перезапуск,
 * и работают ли селекторы hh на живой разметке. НЕ собирает вакансии в БД —
 * только поднимает контекст и проверяет:
 *   1. isLoggedIn на hh.ru (сессия подхватилась?)
 *   2. что отдаёт страница поиска (карточки / пусто / бан)
 * При нуле карточек — дамп HTML в data/dumps/ для разбора селекторов.
 *
 * Запуск: npm run hh:smoke-session
 */
import { createContext, isLoggedIn } from "../app/hh/session";
import { parseSearchResults } from "../app/hh/parsers";

const HOME = "https://hh.ru/";
const SEARCH =
  "https://hh.ru/search/vacancy?text=node.js&area=1&search_field=name&order_by=relevance";

async function main() {
  console.log("=== hh storageState smoke ===\n");

  const context = await createContext({ headed: false });
  try {
    const page = await context.newPage();

    // 1. Главная — проверка залогиненности.
    const resp0 = await page.goto(HOME, { waitUntil: "domcontentloaded" });
    console.log(`home status: ${resp0?.status()}`);
    // Какие куки реально установлены в контексте после загрузки?
    const ctxCookies = await context.cookies("https://hh.ru/");
    const hhctx = ctxCookies.filter((c) => c.domain?.includes("hh.ru"));
    console.log(
      `  cookies in context for hh.ru: ${hhctx.length} (hhtoken: ${hhctx.some((c) => c.name === "hhtoken")})`,
    );
    const loggedIn = await isLoggedIn(page);
    console.log(`isLoggedIn (storageState): ${loggedIn ? "✓ YES" : "✗ NO"}`);
    console.log(`  url: ${page.url()}`);

    // Сохранить HTML главной для разбора, есть ли признаки залогиненности.
    const homeHtml = await page.content();
    const indicators = {
      "data-qa=mainmenu_myResumes": (homeHtml.match(/mainmenu_myResumes/g) || []).length,
      "data-qa=account-menu": (homeHtml.match(/account-menu/g) || []).length,
      "data-qa=login": (homeHtml.match(/data-qa="login[^"]*"/g) || []).length,
      "войти/HH": (homeHtml.match(/Войти|войти|Sign in/g) || []).length,
      "myResumes any": (homeHtml.match(/Мои резюме|my-resumes|myResume/g) || []).length,
      "userName": (homeHtml.match(/data-qa="userinfo|account-user|userName/g) || []).length,
    };
    console.log("  indicators:", JSON.stringify(indicators, null, 2));

    if (!loggedIn) {
      console.log(
        "\n→ isLoggedIn=NO. Разбираем: маркеры data-qa не сматчились, либо hh отдаёт гостевую страницу.",
      );
      // НЕ return — продолжим, чтобы увидеть состояние поиска тоже.
    }

    // 2. Страница поиска — что отдаёт.
    const resp = await page.goto(SEARCH, { waitUntil: "domcontentloaded" });
    console.log(`\nsearch status: ${resp?.status()}, url: ${page.url()}`);
    const html = await page.content();
    const { cards } = parseSearchResults(html);
    console.log(`parsed cards: ${cards.length}`);
    if (cards.length > 0) {
      console.log("  first card:", JSON.stringify(cards[0], null, 2).slice(0, 400));
    } else {
      // Дам микро-срез HTML для понимания (есть ли вообще [data-qa=vacancy]).
      const hits = (html.match(/data-qa="vacancy-serp__vacancy"/g) || []).length;
      const altHits = (html.match(/serp-item/g) || []).length;
      console.log(
        `  data-qa=vacancy-serp__vacancy hits: ${hits}, serp-item hits: ${altHits}`,
      );
      console.log(`  html length: ${html.length}`);
      // Сохранить дамп для разбора селекторов.
      const dump = "data/dumps/hh-search-smoke.html";
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync("data/dumps", { recursive: true });
      writeFileSync(dump, html);
      console.log(`  dumped to ${dump} (для разбора селекторов)`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
