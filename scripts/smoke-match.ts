/**
 * SMOKE-тест matcher — реальный скоринг на данных из БД через z.ai.
 *
 * Запуск: npx tsx scripts/smoke-match.ts [--vacancy=<id>] [--resume=<id>]
 *
 * Без аргументов: берёт первую вакансию status='new' и первый активный шаблон.
 * НЕ входит в npm test (нужен живой ZAI_API_KEY + сеть + деньги). Пропуск без
 * ключа — exit 0 с предупреждением (не ломает сборку).
 */
import { loadEnv } from "./_env";

loadEnv();

const { matchVacancy } = await import("../app/matcher/match");
const { vacanciesRepo, resumeTemplatesRepo } = await import(
  "../app/db/repositories"
);

function parseArgs(argv: string[]): { vacancy?: number; resume?: number } {
  const out: { vacancy?: number; resume?: number } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--vacancy=")) out.vacancy = Number(arg.split("=")[1]);
    else if (arg.startsWith("--resume=")) out.resume = Number(arg.split("=")[1]);
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

  // Подобрать вакансию: из аргумента или первую-кандидата (new, иначе matched).
  let vacancyId = args.vacancy;
  if (vacancyId === undefined) {
    let pool = await vacanciesRepo.list({ status: "new", limit: 1 });
    if (pool.length === 0) {
      // new обычно нет (сборщики фаз 05–07 выставляют matched сразу) — берём matched.
      pool = await vacanciesRepo.list({ status: "matched", limit: 1 });
    }
    if (pool.length === 0) {
      console.error(
        "Нет вакансий-кандидатов (new/matched) для smoke. Укажи --vacancy=<id>.",
      );
      process.exitCode = 1;
      return;
    }
    vacancyId = pool[0]!.id;
  }

  // Подобрать резюме: из аргумента или первый активный.
  let resumeId = args.resume;
  if (resumeId === undefined) {
    const actives = resumeTemplatesRepo
      .list()
      .filter((r) => r.is_active);
    if (actives.length === 0) {
      console.error("Нет активных шаблонов резюме. Укажи --resume=<id>.");
      process.exitCode = 1;
      return;
    }
    resumeId = actives[0]!.id;
  }

  const vacancy = await vacanciesRepo.findById(vacancyId!);
  const resume = resumeTemplatesRepo.findById(resumeId!);
  if (!vacancy || !resume) {
    console.error(
      `Не найдено: vacancy=${vacancyId} (${vacancy ? "ok" : "missing"}), resume=${resumeId} (${resume ? "ok" : "missing"})`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== matcher smoke ===");
  console.log(`vacancy #${vacancy.id}: ${vacancy.title}`);
  console.log(`resume  #${resume.id}: ${resume.name} (${resume.role})`);
  console.log(`skills:  ${resume.skills.join(", ")}\n`);

  const result = await matchVacancy(vacancy.id, resume.id);

  console.log(`\nРезультат:`);
  console.log(`  score:      ${result.score}`);
  console.log(`  passed:     ${result.passed}`);
  console.log(`  aiCalled:   ${result.aiCalled}`);
  if (result.aiCalled) {
    console.log(`  provider:   ${result.provider}`);
    console.log(`  model:      ${result.model}`);
  }
  console.log(`  rationale:  ${result.rationale}`);
  if (result.applicationId) {
    console.log(`  application: #${result.applicationId}`);
  }
}

await main().catch((err) => {
  console.error("smoke-match упал:", err);
  process.exitCode = 1;
});
