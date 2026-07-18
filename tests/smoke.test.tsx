import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Dashboard, loader } from "../app/routes/_index";
import type { IndexLoaderData } from "../app/routes/_index";

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

const emptyLoaderData: IndexLoaderData = {
  status: "ok",
  version: "0.1.0",
  counts: { queued: 0, running: 0, failed: 0 },
  lastRun: null,
};

describe("дашборд (_index)", () => {
  it("показывает заголовок «job_hunter»", () => {
    render(wrap(<Dashboard loaderData={emptyLoaderData} />));
    const heading = screen.getByRole("heading", { level: 1, name: /job_hunter/i });
    expect(heading).toBeInTheDocument();
  });

  it("перечисляет основные секции навигации", () => {
    render(wrap(<Dashboard loaderData={emptyLoaderData} />));
    // vacancies нет (нет роута); убрано из кликабельных в фазе ui-control.
    for (const title of ["Резюме", "Отклики", "Источники", "Настройки"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("показывает кнопку «Собрать вакансии»", () => {
    render(wrap(<Dashboard loaderData={emptyLoaderData} />));
    expect(screen.getByRole("button", { name: /собрать/i })).toBeInTheDocument();
  });

  it("loader возвращает status: 'ok' и счётчики", async () => {
    const data = await loader({} as never);
    expect(data.status).toBe("ok");
    expect(typeof data.version).toBe("string");
    expect(data.counts).toBeDefined();
    expect(data.counts.queued).toBe(0);
  });
});
