/**
 * Маппинг resume_template_id → hh resume_id.
 *
 * Фаза 11 apply-hh: форме отклика hh нужен hh-resume-id (hash), а в БД мы
 * храним resume_template_id. Этот скрипт записывает соответствие в таблицу
 * hh_resume_mapping.
 *
 * Запуск:
 *   npm run hh:map-resumes -- --template=<id> --hh=<hash>   (записать маппинг)
 *   npm run hh:map-resumes -- --list-hh                     (показать hh-resume-id)
 *   npm run hh:map-resumes                                  (показать текущие маппинги)
 *
 * hh-resume-id можно узнать:
 *   - на hh.ru /applicant/resumes (URL вида /resume/<hash>)
 *   - либо через npm run hh:map-resumes -- --list-hh (открывает страницу через Camoufox)
 */
import { loadEnv } from "./_env";

loadEnv();

const { hhResumeMappingRepo, resumeTemplatesRepo } = await import(
  "../app/db/repositories"
);

function parseArgs(argv: string[]): {
  template?: number;
  hh?: string;
  listHh?: boolean;
} {
  const out: { template?: number; hh?: string; listHh?: boolean } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--template=")) out.template = Number(arg.split("=")[1]);
    else if (arg.startsWith("--hh=")) out.hh = arg.split("=")[1];
    else if (arg === "--list-hh") out.listHh = true;
  }
  return out;
}

async function listHhResumeIds(): Promise<void> {
  const { createContext, isLoggedIn } = await import("../app/hh/session");
  const context = await createContext({ headed: false });
  try {
    const page = await context.newPage();
    await page.goto("https://hh.ru/applicant/resumes", {
      waitUntil: "domcontentloaded",
    });
    if (!(await isLoggedIn(page))) {
      console.error("✗ Не залогинен. Сначала npm run hh:login.");
      process.exitCode = 1;
      return;
    }
    const html = await page.content();
    // /resume/<hash> — ссылки на каждое резюме.
    const seen = new Set<string>();
    const re = /\/resume\/([a-f0-9]{20,})/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      seen.add(m[1]!);
    }
    console.log("Резюме на hh-аккаунте:");
    if (seen.size === 0) {
      console.log("  (не найдены — проверьте /applicant/resumes вручную)");
    }
    for (const hash of seen) {
      console.log(`  ${hash}`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.listHh) {
    await listHhResumeIds();
    return;
  }

  if (args.template === undefined || args.hh === undefined) {
    // Показать текущие маппинги + список шаблонов.
    console.log("=== Текущие маппинги ===");
    const mappings = hhResumeMappingRepo.list();
    if (mappings.length === 0) {
      console.log("  (пусто)");
    }
    for (const m of mappings) {
      const tpl = await resumeTemplatesRepo.findById(m.resume_template_id);
      console.log(
        `  template=${m.resume_template_id} (${tpl?.name ?? "?"}) → hh=${m.hh_resume_id}`,
      );
    }
    console.log("\n=== Шаблоны резюме в БД ===");
    const templates = await resumeTemplatesRepo.list();
    for (const t of templates) {
      console.log(`  id=${t.id}  ${t.name}  (${t.role})`);
    }
    console.log(
      "\nЧтобы записать маппинг:\n" +
        "  npm run hh:map-resumes -- --template=<id> --hh=<hash>\n" +
        "hh-resume-id узнать: npm run hh:map-resumes -- --list-hh",
    );
    return;
  }

  // Запись маппинга.
  const tpl = await resumeTemplatesRepo.findById(args.template);
  if (!tpl) {
    console.error(`✗ resume_template ${args.template} не найден`);
    process.exitCode = 1;
    return;
  }
  hhResumeMappingRepo.upsert({
    resume_template_id: args.template,
    hh_resume_id: args.hh,
  });
  console.log(
    `✓ Маппинг записан: template=${args.template} (${tpl.name}) → hh=${args.hh}`,
  );
}

main();
