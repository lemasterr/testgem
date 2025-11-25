# Selector System

Все селекторы для автоматизации собраны в одном месте: `core/selectors/selectors.ts`.

Исходные значения лежат в `config/selectors.json`, чтобы их можно было менять без правки кода.

## Объект `selectors`

- `cardItem` — карточка драфта в ленте (`a[href*='/d/']`).
- `rightPanel` — правый фиксированный блок детали карточки (`div.absolute.right-0.top-0`).
- `kebabInRightPanel` — кнопка меню скачивания в правом блоке.
- `menuRoot` — корневой контейнер меню (`[role='menu']`).
- `menuItem` — пункт меню (`[role='menuitem']`).
- `promptInput` — поле ввода промпта (`textarea[data-testid='prompt-input']`).
- `submitButton` — кнопка отправки промпта (`button[data-testid='submit']`).
- `enabledSubmitButton` — активная кнопка отправки без `disabled`.
- `fileInput` — input загрузки файлов/изображений (`input[type='file']`).
- `draftCard` — карточка черновика в сетке (`.sora-draft-card`).
- `downloadButton` — кнопка скачивания (`button[data-testid='download']`).

## Хелперы ожиданий

- `waitForVisible(page, selector, timeoutMs = 15000)` — ждёт появления видимого элемента с таймаутом по умолчанию 15 секунд.
- `waitForClickable(page, selector, timeoutMs = 15000)` — ждёт видимости и отсутствия атрибута `disabled`.
- `waitForDisappear(page, selector, timeoutMs = 15000)` — ждёт исчезновения/скрытия элемента.

## Правила использования

1. Везде используем `selectors.*` вместо строковых селекторов в коде.
2. Для ожиданий применяем `waitForVisible`/`waitForClickable` с таймаутом 15 секунд, если не указано иначе.
3. Все клики выполняем `await page.click(selector, { delay: 80 });` или `handle.click({ delay: 80 })` для стабильности.
