# Sora Desktop

Electron + React настольное приложение для автоматизации работы с Sora: управление сессиями и Chrome‑профилями, отправка промптов, скачивание черновиков, watermark/blur/merge и Telegram‑уведомления через удобный UI.

## Страницы приложения
- **Dashboard** — ежедневная статистика (промпты/скачивания/ошибки), мини‑граф активности, ТОП‑сессии и статус пайплайна.
- **Sessions** — полный CRUD по `ManagedSession` (id, name, chromeProfileName, promptProfile, cdpPort, maxVideos, файлы prompts/titles/image_prompts, submitted/failed логи, downloadDir/cleanDir, cursor, openDrafts, autoLaunchChrome, autoLaunchAutogen, notes, status). Запуск/стоп Autogen и Downloader, health‑check, клон сессии.
- **Content** — редактор промптов/тайтлов/image‑промптов, привязанных к активному Chrome‑профилю; счётчики строк, сохранение/перезагрузка файлов.
- **Automator** — конструктор Pipeline со шагами `session_prompts`, `session_images`, `session_mix`, `session_download`, `session_watermark`, `session_chrome`, `global_blur`, `global_merge`; поддержка нескольких sessionIds, лимит скачек (0 = без ограничения), драй‑ран и прогресс онлайне.
- **Downloader** — ручной запуск загрузчика с лимитом скачек и мониторингом статуса.
- **Watermark / Blur** — предпросмотр кадров, blur‑профили, вызов скриптов очистки водяных знаков.
- **Telegram** — токен, chat id, чекбоксы нотификаций (finish/error/watchdog/cleanup), тестовые сообщения.
- **Logs** — потоковые логи с фильтрами по уровню/источнику, экспорт/открытие папки логов.
- **Settings** — sessionsRoot, chromeExecutablePath, chromeUserDataDir, chromeActiveProfileName, ffmpegPath, тайминги (promptDelayMs, draftTimeoutMs, downloadTimeoutMs, maxParallelSessions), cleanup, Telegram и Chrome профили.

## Доступ к Sora (Chrome профили)
1. Установите `chromeExecutablePath` в Settings (путь до системного Chrome/Chromium).
2. Нажмите «Scan profiles» — приложение через `scanChromeProfiles` найдёт профили (`Default`, `Profile X` и т.д.), кеширует их (cachedProfiles) и выделит активный по `chromeActiveProfileName`.
3. Базовые настройки профилей:
   - `chromeUserDataDir` — базовая папка профилей (можно оставить автоопределение, либо указать вручную).
   - `chromeActiveProfileName` — имя профиля (Default / Profile 1 / ...), выбирается в Settings.
4. Чтобы Sora была доступна в автоматизации:
   - Откройте обычный Chrome, авторизуйтесь в Sora в нужном профиле (например, Default или Profile 1).
   - Убедитесь, что этот профиль виден в списке профилей приложения и выбран активным.
   - Можно использовать профиль напрямую (режим системных профилей) или предпочесть клонирование (см. ниже).

## Клонирование профиля Chrome для Sora
- В Settings есть кнопка **«Clone Chrome profile for Sora»**.
- При нажатии активный системный профиль копируется в отдельную директорию (клон) внутри `sessionsRoot` (например, `chrome-clones/<profile-slug>`).
- Копия сохраняет логины/куки/настройки Sora; все дальнейшие автозапуски Puppeteer используют именно этот клон.
- Основной профиль не трогаем: меньше риска повредить системный Chrome и снимаются ошибки DevTools/SingletonLock.
- После клонирования приложение пересканирует профили, отметит клон активным (`chromeActiveProfileName` обновляется), а `chromeUserDataDir` указывает на корень клонов.

## Что сохраняется в кеше
- Браузерный кеш/куки/логины/история живут в папке `userDataDir/profileDirectory` (указано в профиле). Приложение их не чистит и не удаляет при запуске.
- Кеш профилей (cachedProfiles) — это список найденных профилей; он пересканируется после изменения настроек или клонирования.

## Проблемы и решения
- **Failed to create SingletonLock / ProcessSingleton** — закройте все процессы Chrome перед автозапуском или используйте клонированный профиль (рекомендуется).
- **DevTools remote debugging requires a non-default data directory** — запустили с системным `user-data-dir`. Используйте функцию клонирования или отдельный `chromeUserDataDir` для Sora.
- **Профиль не виден** — проверьте `chromeExecutablePath` и `chromeUserDataDir`, повторите «Scan profiles».

## Установка и запуск
```bash
npm install
```

### Dev (Electron)
```bash
npm run dev
```
- Собирает main‑процесс (`dist-electron/electron/main.js`), поднимает Vite на `http://localhost:5173` и открывает окно Electron с preload‑мостом.
- Открывать URL в браузере не нужно: в браузере сработает ElectronGuard и предупредит об отсутствии backend.

### Production build
```bash
npm run build
```
- Собирает рендерер (`vite build`), main‑процесс (`tsc -p tsconfig.electron.json`) и упаковывает electron-builder. Готовые артефакты — в `dist/` (рендерер) и итоговый инсталлятор в `dist/` (например, `dist/mac-arm64/`).

## Структура данных сессий
```
<sessionsRoot>/<session-slug>/
  prompts.txt
  image_prompts.txt
  titles.txt
  submitted.log
  failed.log
  cursor.json
  downloads/
  clean/
```
Редактирование файлов и запуск автоматизации выполняются через страницы Sessions и Content. Логи доступны в Logs.

## Мини-FAQ
- **Sora не открывается в автоматизации** — проверьте активный профиль, авторизацию Sora и при необходимости выполните клонирование профиля.
- **Куки слетают** — используйте один и тот же клон профиля; приложение не чистит его содержимое.
- **Нужно сменить профиль** — выберите другой профиль в Settings (или заново клонируйте) и повторно сохраните конфиг.
