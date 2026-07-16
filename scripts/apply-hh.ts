/**
 * CLI авто-отклика на hh.ru.
 *
 * Запуск:
 *   npm run hh:apply -- --application=<id> [--headed] [--force]
 *   npm run hh:apply -- --all            [--headed]   (все approved)
 *
 * Грузит .env, читает аргументы, вызывает submitApplication.
 * Требует: предварительный логин (npm run hh:login) + маппинг резюме
 * (npm run hh:map-resumes — TODO фазы 11).
 */
import { loadEnv } from "./_env";

loadEnv();

const { submitApplication } = await import("../app/hh/apply");
const { applicationsRepo } = await import("../app/db/repositories");

function parseArgs(argv: string[]): {
  application?: number;
  all?: boolean;
  headed?: boolean;
  force?: boolean;
} {
  const out: {
    application?: number;
    all?: boolean;
    headed?: boolean;
    force?: boolean;
  } = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--application=")) out.application = Number(arg.split("=")[1]);
    else if (arg === "--all") out.all = true;
    else if (arg === "--headed") out.headed = true;
    else if (arg === "--force") out.force = true;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.application === undefined && !args.all) {
    console.error(
      "Использование: npm run hh:apply -- --application=<id> [--headed] [--force]",
    );
    console.error("                npm run hh:apply -- --all [--headed]");
    console.error("  --application  id заявки (applications.id)");
    console.error("  --all          все approved заявки (по очереди)");
    console.error("  --headed       видимый браузер (debug)");
    console.error("  --force        откликнуться даже если status=sent");
    process.exit(1);
  }

  console.log("=== hh.ru apply ===\n");

  // Собрать список application-id для обработки.
  const ids: number[] = [];
  if (args.application !== undefined) {
    ids.push(args.application);
  } else {
    const approved = await applicationsRepo.list({ status: "approved" });
    ids.push(...approved.map((a) => a.id));
    console.log(`Найдено approved заявок: ${ids.length}\n`);
  }

  let ok = 0;
  let fail = 0;
  for (const id of ids) {
    console.log(`→ application ${id}...`);
    try {
      const result = await submitApplication({
        applicationId: id,
        headed: args.headed,
        force: args.force,
      });
      if (result.ok) {
        ok++;
        console.log(`  ✓ отправлена (url: ${result.formUrl})`);
      } else {
        fail++;
        console.log(`  ✗ пропущена: ${result.reason}`);
      }
    } catch (err) {
      fail++;
      console.error(
        `  ✗ ошибка: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.log(`\n=== Готово: ${ok} отправлено, ${fail} пропущено/ошибок ===`);
  if (fail > 0) process.exitCode = 1;
}

main();
