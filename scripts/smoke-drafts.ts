/**
 * SMOKE-тест генерации писем (фаза 09) — реальная генерация на данных из БД через z.ai.
 *
 * Запуск: npx tsx scripts/smoke-drafts.ts [--application=<id>]
 *
 * Без аргументов: берёт первый application status='draft' без письма.
 * НЕ входит в npm test (нужен живой ZAI_API_KEY + сеть + деньги). Пропуск без
 * ключа — exit 0 с предупреждением (не ломает сборку).
 */
import { loadEnv } from "./_env";

loadEnv();

const { generateDraftsOne } = await import("../app/ai/generateDrafts");
const { applicationsRepo, coverLettersRepo } = await import(
  "../app/db/repositories"
);

function parseArgs(argv: string[]): { application?: number } {
  const out: { application?: number } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--application=")) {
      out.application = Number(arg.split("=")[1]);
    }
  }
  return out;
}

async function main(): Promise<void> {
  if (!process.env.ZAI_API_KEY) {
    console.warn(
      "ZAI_API_KEY не задан — smoke пропущен (задайте ключ в .env для реального прогона).",
    );
    return;
  }

  const args = parseArgs(process.argv);

  let applicationId = args.application;
  if (applicationId === undefined) {
    // Первый кандидат: draft без письма.
    const drafts = await applicationsRepo.list({ status: "draft" });
    const candidate = drafts.find(
      (a) => coverLettersRepo.findByApplicationId(a.id) === undefined,
    );
    if (!candidate) {
      console.error(
        "Нет кандидатов (applications status='draft' без письма). Укажи --application=<id>.",
      );
      process.exitCode = 1;
      return;
    }
    applicationId = candidate.id;
  }

  const app = await applicationsRepo.findById(applicationId!);
  if (!app) {
    console.error(`application ${applicationId} не найден.`);
    process.exitCode = 1;
    return;
  }

  console.log("=== drafts smoke ===");
  console.log(
    `application #${app.id}: vacancy ${app.vacancy.title} × resume ${app.resume_template.name}`,
  );
  console.log(`  match_score: ${app.match_score ?? "(нет)"}\n`);

  const result = await generateDraftsOne(app.id);
  const letter = coverLettersRepo.findByApplicationId(app.id);

  console.log(`\nРезультат:`);
  console.log(`  success:    ${result.success}`);
  console.log(`  длина:      ${result.bodyLength} символов`);
  console.log(`\n--- тело письма ---\n`);
  console.log(letter?.body_md ?? "(не записано)");
  console.log(`\n--- конец ---`);
}

await main().catch((err) => {
  console.error("smoke-drafts упал:", err);
  process.exitCode = 1;
});
