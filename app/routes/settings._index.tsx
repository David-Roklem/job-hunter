import { data, redirect } from "react-router";
import { Link } from "react-router";
import { env } from "~/env.server";
import { readEnvFile, writeEnvFile, type EditableKey } from "~/settings/envFile";
import { EDITABLE_KEYS } from "~/settings/schema";
import { userProfileRepo } from "~/db/repositories";
import type { UserProfileDTO } from "~/db/repositories/user_profile";
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
  /** Профиль кандидата для генерации писем (null если не задан). */
  userProfile: UserProfileDTO | null;
};

export async function loader(_args: Route.LoaderArgs): Promise<LoaderData> {
  const envPath = readEnvFile().path;
  const keys: KeyView[] = EDITABLE_KEYS.map((spec) => {
    const rawValue = (env as unknown as Record<string, string | undefined>)[spec.key];
    const isSet = rawValue !== undefined && rawValue !== "";
    return {
      key: spec.key,
      value: spec.is_secret ? null : (rawValue ?? ""),
      is_set: isSet,
      is_secret: spec.is_secret,
      label: spec.label,
      group: spec.group,
      hint: spec.hint,
    };
  });
  return { keys, envPath, userProfile: userProfileRepo.get() };
}

export type ActionData = { ok: true; warning: string } | { error: string };

export async function action(
  args: Route.ActionArgs,
): Promise<ActionData | Response> {
  const formData = await args.request.formData();
  const intent = String(formData.get("intent") ?? "");

  // --- save_profile: профиль кандидата (имя/контакты/сигнатура) ------------
  // Не требует рестарта сервера (БД, а не env). Применится к новым письмам
  // и при регенерации (см. app/ai/generateCoverLetter.ts).
  if (intent === "save_profile") {
    const name = String(formData.get("profile_name") ?? "").trim();
    if (!name) {
      throw data("Имя не может быть пустым", { status: 400 });
    }
    const contacts = {
      telegram: String(formData.get("profile_telegram") ?? "").trim() || undefined,
      email: String(formData.get("profile_email") ?? "").trim() || undefined,
      phone: String(formData.get("profile_phone") ?? "").trim() || undefined,
      github: String(formData.get("profile_github") ?? "").trim() || undefined,
      website: String(formData.get("profile_website") ?? "").trim() || undefined,
      linkedin: String(formData.get("profile_linkedin") ?? "").trim() || undefined,
    };
    const signature_md = String(formData.get("profile_signature") ?? "").trim();
    try {
      userProfileRepo.upsert({ name, contacts, signature_md });
    } catch (err) {
      throw data(err instanceof Error ? err.message : "profile save failed", {
        status: 500,
      });
    }
    return {
      ok: true,
      warning:
        "Профиль сохранён. Применится к новым письмам и при регенерации (старые письма не меняются).",
    };
  }

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

/** Секция профиля кандидата (имя/контакты/сигнатура для писем). */
function ProfileSection({ profile }: { profile: UserProfileDTO | null }) {
  const c = profile?.contacts ?? {};
  return (
    <form method="post" action="/settings" className="settings-form">
      <input type="hidden" name="intent" value="save_profile" />
      <fieldset className="settings-form__group settings-form__group--profile">
        <legend>Профиль кандидата</legend>
        <p className="form__hint">
          Эти данные подставляются в сопроводительные письма при генерации,
          чтобы вместо <code>[Имя]</code> и <code>[Ссылка на Telegram]</code>{" "}
          подставились реальные значения. Применится к новым письмам и при
          регенерации — старые письма не меняются.
        </p>

        <label className="form__field">
          <span className="form__label">Имя *</span>
          <input
            type="text"
            name="profile_name"
            defaultValue={profile?.name ?? ""}
            placeholder="Как представляться в письме"
            required
          />
        </label>

        <div className="settings-form__grid">
          <label className="form__field">
            <span className="form__label">Telegram</span>
            <input
              type="text"
              name="profile_telegram"
              defaultValue={c.telegram ?? ""}
              placeholder="@username"
            />
          </label>
          <label className="form__field">
            <span className="form__label">Email</span>
            <input
              type="email"
              name="profile_email"
              defaultValue={c.email ?? ""}
              placeholder="you@example.com"
            />
          </label>
          <label className="form__field">
            <span className="form__label">Телефон</span>
            <input
              type="text"
              name="profile_phone"
              defaultValue={c.phone ?? ""}
              placeholder="+7 ..."
            />
          </label>
          <label className="form__field">
            <span className="form__label">GitHub</span>
            <input
              type="text"
              name="profile_github"
              defaultValue={c.github ?? ""}
              placeholder="github.com/..."
            />
          </label>
          <label className="form__field">
            <span className="form__label">Сайт / портфолио</span>
            <input
              type="text"
              name="profile_website"
              defaultValue={c.website ?? ""}
              placeholder="https://..."
            />
          </label>
          <label className="form__field">
            <span className="form__label">LinkedIn</span>
            <input
              type="text"
              name="profile_linkedin"
              defaultValue={c.linkedin ?? ""}
              placeholder="linkedin.com/in/..."
            />
          </label>
        </div>

        <label className="form__field">
          <span className="form__label">Сигнатура письма (markdown, опц.)</span>
          <textarea
            name="profile_signature"
            rows={3}
            defaultValue={profile?.signature_md ?? ""}
            placeholder="С уважением, Иван Иванов. Telegram: @ivan"
          />
          <span className="form__hint">
            Если задано — модель использует это как готовую подпись. Пусто = модель
            сама составит подпись из имени и контактов.
          </span>
        </label>

        <button type="submit" className="btn btn--primary">
          ✓ Сохранить профиль
        </button>
      </fieldset>
    </form>
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
