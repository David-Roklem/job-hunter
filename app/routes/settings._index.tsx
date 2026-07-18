import { data, redirect } from "react-router";
import { Link } from "react-router";
import { env } from "~/env.server";
import { readEnvFile, writeEnvFile, type EditableKey } from "~/settings/envFile";
import { EDITABLE_KEYS } from "~/settings/schema";
import type { Route } from "./+types/settings._index";

/**
 * Страница настроек — `/settings` (фаза ui-control).
 *
 * Позволяет редактировать конфигурацию окружения (.env) без ручного
 * редактирования файла. Секреты (ключи API, TG_SESSION) в loader НЕ отдаются —
 * только флаг is_set. Сохранение = атомарная перезапись .env (temp + rename)
 * + flash «перезапустите dev-сервер» (env парсится при старте процесса).
 *
 * Редактируемый белый список — EDITABLE_KEYS в app/settings/schema.ts.
 */

/** Описание ключа для UI: значение (только несекретные), флаги. */
type KeyView = {
  key: EditableKey;
  value: string | null; // null для секретов без раскрытия
  is_set: boolean;
  is_secret: boolean;
  label: string;
  group: string;
  hint?: string;
};

export type LoaderData = {
  keys: KeyView[];
  envPath: string;
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const envPath = readEnvFile().path;
  const keys: KeyView[] = EDITABLE_KEYS.map((spec) => {
    const rawValue = (env as unknown as Record<string, string | undefined>)[spec.key];
    const isSet = rawValue !== undefined && rawValue !== "";
    return {
      key: spec.key,
      // Секреты не отдаём — только is_set.
      value: spec.is_secret ? null : (rawValue ?? ""),
      is_set: isSet,
      is_secret: spec.is_secret,
      label: spec.label,
      group: spec.group,
      hint: spec.hint,
    };
  });
  return { keys, envPath };
}

export type ActionData = { ok: true; warning: string } | { error: string };

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent !== "save") {
    throw data(`неизвестный intent: ${intent}`, { status: 400 });
  }

  // Собираем новые значения из формы (только присутствующие поля).
  // Секретные поля: если пользователь не ввёл новое значение (пусто) и стоит
  // флаг keep_<key> — не трогаем старое. Иначе обновляем.
  const updates: Partial<Record<EditableKey, string>> = {};
  for (const spec of EDITABLE_KEYS) {
    const formKey = `env_${spec.key}`;
    const raw = formData.get(formKey);
    if (raw === null) continue;
    const value = String(raw);

    if (spec.is_secret) {
      const keepFlag = formData.get(`keep_${spec.key}`);
      if (value === "" && keepFlag === "1") {
        // Сохраняем старое значение (не отдаём в UI — берём из .env).
        continue;
      }
      updates[spec.key] = value;
    } else {
      updates[spec.key] = value;
    }
  }

  try {
    writeEnvFile(updates);
  } catch (err) {
    throw data(
      err instanceof Error ? err.message : "write .env failed",
      { status: 500 },
    );
  }

  // Не редирект — показываем подтверждение + предупреждение о рестарте.
  // Env парсируется при старте, поэтому текущий процесс НЕ видит изменения.
  return {
    ok: true,
    warning:
      "Сохранено в .env. Перезапустите dev-сервер (npm run dev), чтобы изменения вступили в силу.",
  };
}

/** Группировка ключей по group для UI. */
function groupKeys(keys: KeyView[]): { group: string; items: KeyView[] }[] {
  const map = new Map<string, KeyView[]>();
  for (const k of keys) {
    const arr = map.get(k.group) ?? [];
    arr.push(k);
    map.set(k.group, arr);
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
}

export function SettingsPage({
  loaderData,
  actionData,
}: {
  loaderData: LoaderData;
  actionData?: ActionData;
}) {
  const groups = groupKeys(loaderData.keys);

  return (
    <main className="page">
      <header className="page__header">
        <h1>Настройки</h1>
        <Link to="/" className="btn">
          ← На главную
        </Link>
      </header>

      <p className="page__hint">
        Конфигурация хранится в <code>{loaderData.envPath}</code>. Секреты
        (ключи API, TG_SESSION) отображаются только флагом «установлен» — само
        значение не передаётся в браузер.
      </p>

      {actionData && "ok" in actionData && actionData.ok && (
        <p className="alert alert--success">✓ {actionData.warning}</p>
      )}
      {actionData && "error" in actionData && (
        <p className="alert alert--danger">✗ {actionData.error}</p>
      )}

      <form method="post" action="/settings" className="settings-form">
        <input type="hidden" name="intent" value="save" />

        {groups.map(({ group, items }) => (
          <fieldset key={group} className="settings-form__group">
            <legend>{group}</legend>
            {items.map((k) => (
              <label key={k.key} className="form__field">
                <span className="form__label">
                  {k.label}
                  {k.is_secret && (
                    <span className="badge badge--muted">секрет</span>
                  )}
                  {k.is_set && k.is_secret && (
                    <span className="badge badge--approved">установлен</span>
                  )}
                </span>
                {k.is_secret ? (
                  <div className="settings-form__secret">
                    <input
                      type="password"
                      name={`env_${k.key}`}
                      placeholder={k.is_set ? "•••••• (оставьте пустым чтобы не менять)" : "не задан"}
                      autoComplete="off"
                    />
                    {k.is_set && (
                      <label className="settings-form__keep">
                        <input type="checkbox" name={`keep_${k.key}`} value="1" defaultChecked />
                        <span>сохранить старое</span>
                      </label>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    name={`env_${k.key}`}
                    defaultValue={k.value ?? ""}
                  />
                )}
                {k.hint && <span className="form__hint">{k.hint}</span>}
              </label>
            ))}
          </fieldset>
        ))}

        <button type="submit" className="btn btn--primary">
          ✓ Сохранить
        </button>
      </form>
    </main>
  );
}

export default function Settings({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <SettingsPage
      loaderData={loaderData as LoaderData}
      actionData={actionData as ActionData | undefined}
    />
  );
}
