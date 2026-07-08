import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let heading = "Что-то пошло не так";
  let detail: string;
  if (isRouteErrorResponse(error)) {
    heading = `${error.status} ${error.statusText || ""}`.trim();
    detail = typeof error.data === "string" ? error.data : error.data?.message ?? "";
  } else if (import.meta.env.DEV && error instanceof Error) {
    detail = error.message;
  } else {
    detail = "Неожиданная ошибка. Перезагрузите страницу.";
  }
  return (
    <main>
      <h1>{heading}</h1>
      <p>{detail}</p>
    </main>
  );
}
