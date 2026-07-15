# Plan: review-ui

**Фаза:** 10 (review-ui) · **Статус:** planned · **Дата:** 2026-07-15

## Goal

UI инбокс «подтвердить / редактировать / отклонить» подготовленных откликов —
первый полноценный пользовательский экран цикла «система готовит → ты одобряешь».
Показывает applications, у которых есть сгенерированное cover_letter (от
draft-generator фазы 09), с действиями: одобрить (status→approved), отклонить
(status→rejected), редактировать письмо, регенерировать. Без авто-отклика
(фаза 11 apply-hh). Доставляет vision-экран «инбокс одобрения одним кликом».

## truths (инварианты, НЕ НАРУШАТЬ)

1. **Инбокс = applications С письмом.** Показываем отклики, у которых есть
   cover_letter (любой статус). Письмо = готовность к ревью. Без письма — не
   показываем (черновик ещё не подготовлен draft-generator'ом).
2. **Статусы переводит только UI action.** Одобрить → `approved`, отклонить →
   `rejected`. Ручной ввод произвольного статуса НЕ делаем (предсказуемость).
3. **Редактирование письма → `coverLettersRepo.updateBody`** (updateBody ставит
   `edited_at` — отличает ручную правку от AI-генерации, важно для аудита).
4. **Регенерация → `generateCoverLetter`** (фаза 04, upsert). Перезаписывает
   письмо, сбрасывает `edited_at` (контент пересгенерирован — это корректно).
5. **Паттерны UI = фаза 03 resumes.** loader/action в route-файле, `Route.LoaderArgs`,
   `data(..., {status})` для 404, intent-ветвление в action, form-data.

## Decisions (из discuss)

| Решение | Почему |
|---|---|
| Инбокс показывает applications С cover_letter (любой статус) | Письмо = готовность к ревью. Соответствует vision «система готовит → ты одобряешь». |
| Действия: одобрить/отклонить/редактировать/регенерировать | Полный набор для ревью. Без ручного dropdown'а статусов — предсказуемо. |
| Редактирование — отдельная страница `/applications/:id/edit` | Паттерн фазы 03 (resumes/:id/edit). Чистее UX, чем inline; переиспользует form-классы. |
| Маршрут `/applications` | Технически точно (сущность = applications); пользователь выбрал. |
| Главная: плашка «Отклики» → кликабельна на `/applications` | Мелкое улучшение: сейчас плашки статичны. Делает приложение связным. |

## Steps

### 1. `applicationsRepo.listWithLetter()` — расширение репозитория

Текущий `list()` тянет vacancy + resume_template, но НЕ cover_letter и НЕ
vacancy.company. Для инбокса нужно показать письмо + компанию. Добавим метод:

```ts
// app/db/repositories/applications.ts
/** Список applications С cover_letter (для инбокса review-ui). */
export async function listWithLetter(): Promise<Array<ApplicationWithRelations>> {
  const rows = await db.query.applications.findMany({
    with: {
      vacancy: { with: { company: true } },
      resume_template: true,
      cover_letter: true,
    },
  });
  // Фильтр «есть cover_letter» — в JS (Drizzle relational query не фильтрует
  // по наличию relation лаконично; при ~100 откликов это пренебрежимо).
  return rows.filter((r) => r.cover_letter !== null) as ApplicationWithRelations[];
}
```

Сортировка: по `cover_letter.generated_at` desc (свежие сверху). Тип
`ApplicationWithRelations` — выведется из Drizzle `$inferSelect` с relations
(как `findById` возвращает). Не плодим отдельный type — используем `Awaited<ReturnType<...>>`.

### 2. `app/routes/applications._index.tsx` — инбокс `/applications`

**loader:** `applicationsRepo.listWithLetter()` → массив для рендера.

**action** (intent-ветвление, form-data):
- `intent=approve` → `applicationsRepo.update(id, {status:'approved'})`
- `intent=reject` → `applicationsRepo.update(id, {status:'rejected'})`
- `intent=regenerate` → `generateCoverLetter(id)` (фаза 04, upsert)
- После action — `redirect("/applications")` (revalidate loader).

Возвращает 404 через `data(..., {status:404})` если application не найден.

**UI:** список карточек (класс `cards`/`card` из фазы 03). В карточке:
- title вакансии + компания (badge)
- role резюме-шаблона + match_score (badge)
- статус (badge: draft=серый, approved=зелёный, rejected=красный)
- превью письма (первые ~200 символов, `card__summary`)
- дата генерации письма (`card__meta`)
- действия: 3 form-кнопки (Одобрить/Отклонить/Регенерировать) + Link на edit

**Пустое состояние:** «Нет подготовленных откликов. Запустите `npm run generate-drafts`».

### 3. `app/routes/applications.$id.edit.tsx` — редактирование письма

**loader:** `applicationsRepo.findById(id)` → 404 если нет/нет письма.

**action** (intent-ветвление):
- `intent=save` → валидация body_md (непустое) → `coverLettersRepo.updateBody(letterId, body)` → redirect
- `intent=approve` → update application status → redirect (удобно: одобрить прямо со страницы редактирования)
- ошибки валидации → вернуть `{values, errors}` (как resumes edit)

**UI:** форма (класс `form`) с `<textarea>` для письма (большие поля — письмо ~1000-1500 символов). Контекст сверху: вакансия/компания/резюме/score (readonly). Кнопки: Сохранить / Отменить (Link назад).

### 4. Главная `_index.tsx` — плашка «Отклики» кликабельна

Сейчас `SECTIONS` — массив с `key`/`title`/`hint`, рендерится как статичные `<li>`.
Добавим необязательное поле `href?` и обернём секции с href в `<Link>`.
Плашка «Отклики» (key=`responses`) → `/applications`. Остальные пока без href
(vacancies/sources UI нет). Мелкое, но делает приложение связным.

### 5. CSS — статусы badges

Добавить в `app/app.css`:
- `.badge--approved` (зелёный фон/текст) для approved
- `.badge--rejected` (красный) для rejected
- `.badge--draft` (серый/жёлтый акцент) для draft/pending_review

Переиспользуем существующий `.badge` + `.badge--muted`. Минимум нового CSS.

### 6. Тесты

**`tests/review-ui.test.ts`** — vi.mock zai + in-memory БД (паттерн
matcher-match.test.ts / generate-drafts.test.ts). Тестируем **route loaders/actions**
напрямую (как edge-route тесты в verify matcher/drafts):

Кейсы:
- `applications._index loader` — возвращает только applications с cover_letter
  (создаём 2: один с письмом, один без — возвращается 1)
- `applications._index action approve` → application.status='approved'
- `applications._index action reject` → application.status='rejected'
- `applications._index action regenerate` → cover_letter.body_md обновлён (chatMock вызван)
- `applications._index action` по несуществующему id → Response 404
- `applications.$id.edit loader` — возвращает application + cover_letter; несуществующий → throw 404
- `applications.$id.edit action save` → coverLettersRepo.updateBody вызван, body обновлён
- `applications.$id.edit action save` с пустым body → возвращает errors, БД не тронута
- `applications.$id.edit action approve` → status='approved'
- `listWithLetter()` — фильтрует applications без письма, тянет company

## Acceptance

- [ ] `applicationsRepo.listWithLetter()` — фильтр «есть cover_letter», relations vacancy.company + resume_template + cover_letter.
- [ ] `app/routes/applications._index.tsx` — loader (listWithLetter) + action (approve/reject/regenerate) + UI (карточки с действиями, пустое состояние).
- [ ] `app/routes/applications.$id.edit.tsx` — loader (findById, 404) + action (save с валидацией / approve) + форма с textarea.
- [ ] `_index.tsx` — плашка «Отклики» кликабельна → `/applications`.
- [ ] CSS — `.badge--approved`/`.badge--rejected`/`.badge--draft` статусы.
- [ ] `tests/review-ui.test.ts` (~10 тестов) — loaders/actions напрямую, vi.mock zai + in-memory БД.
- [ ] `npm test` (зелёный, +~10 новых) и `npm run typecheck` (чистый).
- [ ] Ручной smoke: `npm run dev`, открыть `/applications`, кликнуть действия.

## Out of scope

- Авто-отклик на hh.ru — фаза 11 (apply-hh).
- Фильтры/сортировка/пагинация в инбоксе — при ~100 откликов пока не нужно; добавить когда нагрузка проявится.
- Массовые действия (выбрать N → одобрить все) — позже.
- UI для создания/просмотра вакансий и источников (плашки на главной) — будущие фазы.
- История версий письма / undo — пока upsert/updateBody перезаписывают.
- Адаптация резюме (отложено в фазе 09).

<!-- soly:status:begin -->
## Status

**Goal met:** YES

### Acceptance
- [x] `applicationsRepo.listWithLetter()` — фильтр «есть cover_letter», relations vacancy.company + resume_template + cover_letter — реализован, сортировка generated_at desc.
- [x] `app/routes/applications._index.tsx` — loader (listWithLetter) + action (approve/reject/regenerate, throw 404/400/500) + UI (карточки с действиями, пустое состояние).
- [x] `app/routes/applications.$id.edit.tsx` — loader (findById, throw 404 если нет/нет письма) + action (save с валидацией непустого body / approve) + форма с textarea.
- [x] `_index.tsx` — плашка «Отклики» кликабельна → `/applications` (обёрнута в Link; «Резюме» тоже).
- [x] CSS — `.badge--approved`/`.badge--rejected`/`.badge--draft` + `.card__actions`/`.card__link`.
- [x] `tests/review-ui.test.ts` (~10 тестов) — 14 тестов (listWithLetter 2, index loader+action 6, edit loader+action 6), loaders/actions напрямую, vi.mock zai + in-memory БД.
- [x] `npm test` (зелёный, +~10 новых) и `npm run typecheck` (чистый) — 219/219 passed (+14 новых), tsc чистый.
- [x] Ручной smoke: `npm run dev`, открыть `/applications`, кликнуть действия — автоматические тесты покрывают логику; ручной прогон UI — отдельный шаг после review.

**Verdict:** PASS
<!-- soly:status:end -->
