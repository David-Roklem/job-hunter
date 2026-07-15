import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { Dashboard, loader } from "../app/routes/_index";

const wrap = (ui: React.ReactNode) => <MemoryRouter>{ui}</MemoryRouter>;

describe("дашборд (_index)", () => {
  it("показывает заголовок «job_hunter»", () => {
    render(wrap(<Dashboard loaderData={{ status: "ok", version: "0.1.0" }} />));
    const heading = screen.getByRole("heading", { level: 1, name: /job_hunter/i });
    expect(heading).toBeInTheDocument();
  });

  it("перечисляет четыре будущие секции", () => {
    render(wrap(<Dashboard loaderData={{ status: "ok", version: "0.1.0" }} />));
    for (const title of ["Вакансии", "Резюме", "Отклики", "Источники"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it("loader возвращает status: 'ok'", async () => {
    const data = await loader({} as never);
    expect(data.status).toBe("ok");
    expect(typeof data.version).toBe("string");
  });
});
