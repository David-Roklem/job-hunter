/**
 * Barrel-export репозиториев.
 *
 * Feature-код импортирует отсюда: `import { vacanciesRepo } from "~/db/repositories"`.
 * Доступ к БД — только через эти функции (must_have: db через app/db/index.ts).
 */
export * as sourcesRepo from "./sources";
export * as vacanciesRepo from "./vacancies";
export * as applicationsRepo from "./applications";
export * as resumeTemplatesRepo from "./resume_templates";
export * as coverLettersRepo from "./cover_letters";
export * as searchProfilesRepo from "./search_profiles";
