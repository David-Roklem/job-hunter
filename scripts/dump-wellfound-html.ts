/**
 * Дампер реального HTML Wellfound для переписки селекторов/парсеров.
 *
 * ЗАЧЕМ: существующие фикстуры (tests/fixtures/wellfound-*.html) — синтетические,
 * построены на best-guess data-testid, которого в реальности НЕТ (найдено smoke'ом
 * в camoufox-stealth). Без реального HTML правка селекторов = гадание. Этот скрипт
 * снимает отрендеренный HTML (поcле waitForSelector) и сохраняет его в data/dumps/.
 *
 * Запуск:
 *   npm run wellfound:dump                       — дефолты (search + 1 детальная)
 *   npm run wellfound:dump -- --query=react      — поисковый запрос
 *   npm run wellfound:dump -- --max-details=3    — снять N детальных страниц
 *   npm run wellfound:dump -- --headed           — видимый браузер (debug анти-бота)
 *
 * Предварительно: npm run wellfound:login (публичные listings частично работают
 * и без него, но с логином покрытие стабильнее).
 *
 * Что сохраняется в data/dumps/:
 *   wellfound-search-<query>-<timestamp>.html      — страница результатов поиска
 *   wellfound-vacancy-<id>-<timestamp>.html        — детальная страница вакансии (×N)
 *   wellfound-dump-<timestamp>.report.txt          — сводка: URL'ы, найденные ссылки,
 *                                                    candidate-селекторы для анализа
 *
 * Camoufox — единственный браузер, проходящий Cloudflare на Wellfound (см.
 * camoufox-stealth SUMMARY). Скрипт переиспользёт app/wellfound/session.ts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { createContext } from "../app/wellfound/session";
import {
  WF_SEARCH_URL,
  isBlockUrl,
} from "../app/wellfound/selectors";

/** Признаки DataDome-интерстишала в HTML (отдельный анти-бот, не Cloudflare).
 *  Wellfound использует DataDome ПОВЕРХ Cloudflare — оба слоя видны в дампе. */
const DATADOME_MARKERS = [
  "captcha-delivery.com",
  "DataDome Device Check",
  "geo.captcha-delivery.com",
];

/** Определить, не DataDome-ли интерстишал на странице (по HTML). */
async function isDataDomeBlock(page: Page): Promise<boolean> {
  const html = await page.content();
  return DATADOME_MARKERS.some((m) => html.includes(m));
}

/** Директория для дампов — персистентный проектный артефакт (НЕ os.tmpdir). */
const DUMPS_DIR = path.join(process.cwd(), "data", "dumps");

/** Селектор-маркер, что карточки отрендерились (waitForSelector). Изначально
 *  data-testid (может не сработать) → fallback на структурный a[href*="/jobs/"]. */
const CARD_READY_SELECTORS = [
  '[data-testid="job-listing"]',
  'a[href*="/jobs/"]',
  'section[role="group"]',
];

/** Паттерн ссылки на детальную вакансию. */
const JOB_LINK_RE = /\/jobs\/\d+/;

/** Таймаут ожидания рендера SPA (Wellfound — React, HTML пуст до рендера). */
const SPA_RENDER_TIMEOUT_MS = 30_000;

type DumpArgs = {
  query: string;
  maxDetails: number;
  headed: boolean;
};

function parseArgs(argv: string[]): DumpArgs {
  const out: DumpArgs = {
    query: "react",
    maxDetails: 1,
    headed: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--query=")) out.query = arg.split("=")[1] ?? out.query;
    else if (arg.startsWith("--max-details=")) {
      const n = Number(arg.split("=")[1]);
      if (Number.isFinite(n) && n > 0) out.maxDetails = n;
    } else if (arg === "--headed") out.headed = true;
  }
  return out;
}

function timestamp(): string {
  // ISO-безопасный для имени файла: 2026-07-14T12-30-45
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** Снять HTML страницы и записать в файл. Возвращает путь. */
async function dumpHtml(page: Page, name: string): Promise<string> {
  const html = await page.content();
  const filePath = path.join(DUMPS_DIR, name);
  await writeFile(filePath, html, "utf8");
  return filePath;
}

/** Дождаться анти-бот блокировки (если есть) или рендера карточек. */
async function waitUntilReady(
  page: Page,
): Promise<{ blocked: boolean; readySelector: string | null }> {
  const deadline = Date.now() + SPA_RENDER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = page.url();
    if (isBlockUrl(url)) return { blocked: true, readySelector: null };

    for (const sel of CARD_READY_SELECTORS) {
      const count = await page
        .locator(sel)
        .count()
        .catch(() => 0);
      if (count > 0) return { blocked: false, readySelector: sel };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { blocked: false, readySelector: null };
}

/** Тип блокировки для диагностики. */
type BlockKind = "datadome" | "url-pattern" | "timeout" | null;

/** Собрать со страницы все ссылки на детальные вакансии (без дублей). */
async function collectJobLinks(page: Page): Promise<string[]> {
  const hrefs = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a[href]"));
    return links.map((a) => (a as HTMLAnchorElement).href);
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const href of hrefs) {
    if (!JOB_LINK_RE.test(href)) continue;
    try {
      const u = new URL(href, page.url());
      const normalized = `${u.origin}${u.pathname}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    } catch {
      // битая ссылка — пропускаем
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  await mkdir(DUMPS_DIR, { recursive: true });
  const ts = timestamp();

  console.log("=== Wellfound HTML dumper ===\n");
  console.log(`query:        ${args.query}`);
  console.log(`max-details:  ${args.maxDetails}`);
  console.log(`headed:       ${args.headed}`);
  console.log(`dumps dir:    ${DUMPS_DIR}\n`);

  const context = await createContext({ headed: args.headed });
  const page = await context.newPage();

  const reportLines: string[] = [
    `Wellfound HTML dump — ${ts}`,
    `query=${args.query} max-details=${args.maxDetails} headed=${args.headed}`,
    "",
  ];

  try {
    // 1. Страница поиска.
    const searchUrl = `${WF_SEARCH_URL}?q=${encodeURIComponent(args.query)}`;
    console.log(`→ Загружаю поиск: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    console.log("→ Ожидаю рендер карточек (до 30с)...");
    const { blocked, readySelector } = await waitUntilReady(page);

    // Если карточки не появились — проверить, не DataDome-интерстишал ли это.
    // DataDome = отдельный анти-бот (не Cloudflare); Wellfound использует оба слоя.
    let blockKind: BlockKind = blocked ? "url-pattern" : null;
    if (!readySelector) {
      if (await isDataDomeBlock(page)) blockKind = "datadome";
      else if (!blocked) blockKind = "timeout";
    }

    if (blockKind === "datadome") {
      console.error(
        "\n✗ DataDome-блокировка (captcha-delivery.com). Это НЕ Cloudflare —",
      );
      console.error(
        "  Camoufox прошёл Cloudflare, но DataDome отдельный слой. Помогает:",
      );
      console.error(
        "  1) npm run wellfound:login (свежая залогиненная сессия в data/wellfound-profile/)",
      );
      console.error("  2) npm run wellfound:dump -- --headed (видимый браузер)");
      reportLines.push("BLOCKED: DataDome (captcha-delivery.com)");
      reportLines.push("note: Camoufox проходит Cloudflare, но DataDome — отдельный слой");
      // Дамп интерстишала сохраняем — для диагностики структуры блока.
      const blockDumpName = `wellfound-block-datadome-${ts}.html`;
      await dumpHtml(page, blockDumpName);
      reportLines.push(`block dump: ${blockDumpName}`);
      process.exitCode = 1;
      return;
    }
    if (blockKind === "url-pattern") {
      console.error("\n✗ Блокировка по URL-паттерну (Cloudflare challenge).");
      reportLines.push("BLOCKED: url-pattern (Cloudflare)");
      process.exitCode = 1;
      return;
    }
    console.log(
      readySelector
        ? `✓ Рендер готов (селектор: ${readySelector})`
        : "⚠ Таймаут ожидания карточек — дамп всё равно сохраню (м.б. пустой)",
    );
    reportLines.push(`search ready selector: ${readySelector ?? "(none)"}`);
    reportLines.push(`search url: ${page.url()}`);

    const searchDumpName = `wellfound-search-${args.query}-${ts}.html`;
    const searchPath = await dumpHtml(page, searchDumpName);
    console.log(`✓ Сохранён дамп поиска: ${searchPath}`);
    reportLines.push(`search dump: ${searchDumpName}`);

    // 2. Ссылки на детальные.
    const jobLinks = await collectJobLinks(page);
    console.log(`→ Найдено ссылок на вакансии: ${jobLinks.length}`);
    reportLines.push(`job links found: ${jobLinks.length}`);
    reportLines.push(...jobLinks.slice(0, 20).map((u) => `  - ${u}`));
    if (jobLinks.length > 20) reportLines.push(`  ... и ещё ${jobLinks.length - 20}`);

    // 3. Детальные страницы.
    const detailsToDump = jobLinks.slice(0, args.maxDetails);
    for (let i = 0; i < detailsToDump.length; i++) {
      const link = detailsToDump[i]!;
      const idMatch = link.match(/\/jobs\/(\d+)/);
      const id = idMatch ? idMatch[1]! : `unknown${i}`;
      console.log(`→ Детальная [${i + 1}/${detailsToDump.length}]: ${link}`);

      await page.goto(link, { waitUntil: "domcontentloaded" });
      // Детальная тоже SPA — дать время на рендер описания/навыков.
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));

      if (isBlockUrl(page.url())) {
        console.log("  ⚠ блокировка на детальной — пропускаю");
        reportLines.push(`detail ${id}: BLOCKED`);
        continue;
      }

      const detailDumpName = `wellfound-vacancy-${id}-${ts}.html`;
      const detailPath = await dumpHtml(page, detailDumpName);
      console.log(`  ✓ Сохранён: ${detailPath}`);
      reportLines.push(`detail dump ${id}: ${detailDumpName}`);
    }

    // 4. Report.
    const reportPath = path.join(DUMPS_DIR, `wellfound-dump-${ts}.report.txt`);
    await writeFile(reportPath, reportLines.join("\n") + "\n", "utf8");
    console.log(`\n✓ Отчёт: ${reportPath}`);
    console.log("\nГотово. Файлы в data/dumps/ — используй их для правки selectors.ts/parsers.ts.");
  } catch (err) {
    console.error("\n✗ Ошибка:", err);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
  }
}

main();
