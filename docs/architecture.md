# Архитектура Deep Focus

Почему так решено — `docs/adr/`; термины — `CONTEXT.md`. Здесь: как устроено сейчас.

## Процессы и поток данных

- **main** — единственный источник правды о таймере, блокировке, звуке и настройках. Окна только показывают снимки и шлют команды.
- **renderer** — три окна, три точки входа: `src/renderer/app/` (главное, hash-роуты `#/<section>/<tab>`), `src/renderer/widget/` (плавающий виджет), `src/renderer/audio/` (скрытое окно с Web Audio; главное окно и виджет в него не ходят).
- **preload** — `window.deepFocus` (`src/preload/index.ts`, домены в `src/preload/api/<domain>.ts`). Это единственный путь renderer в систему. Домен `audioEngine` — только для окна audio.
- Запрос: renderer → `ipcRenderer.invoke('домен:действие')` → `handle(channel, checks, fn)` (`src/main/ipc.ts`) проверяет отправителя и аргументы (`v.*` из `src/main/validate.ts`) → сервис модуля. Рассылки — `webContents.send` (`timer:state`, `settings:changed`, `blocker:statusChanged`, `audio:statusChanged`, `analytics:changed`, `tasks:outcomeChanged`, `hotkeys:resultsChanged`, `widget:visibilityChanged`).
- Имена каналов — `src/shared/ipc.ts`; типы — `src/shared/types.ts`; значения по умолчанию и встроенные пресеты/правила/звуки — `src/shared/defaults.ts`.
- Цепочка сессии: `TimerEngine` → события `intervalEnded` (пишет `SessionRecord`) → `sessionStarted` → `state`; на них подписаны TaskService (исход сессии), AnalyticsService (достижения), Notifier, Tray, Widget, Blocker, Audio. Внутренние события main — `src/main/events.ts`.

## Модули main

Каждый — `src/main/<module>/index.ts` с `register<Module>(ctx: MainContext)`; сервисы лежат в `ctx.services` (`src/main/context.ts`), модуль дополняет тип через `declare module '../context'`. `src/main/index.ts` только собирает модули (single-instance, `DEEPFOCUS_USER_DATA`).

| Модуль | Суть |
|---|---|
| `db/` | `deepfocus.db` (better-sqlite3) в `userData`; репозитории; миграции `db/migrations.ts` только дописываются в конец, версия в `kv.schemaVersion`; битая БД → `openStorageSafe` откладывает копию |
| `settings/` | `SettingsManager`: `get/patch/on('change')`, бэкап; схема валидации `schema.ts`; сброс данных `dataReset.ts` |
| `timer/` | `TimerEngine` на абсолютном `endAt`; `Clock` и `TimerStore` внедряются (тесты без Electron); recovery после сбоя |
| `widget/` | `WidgetManager` + чистая геометрия `geometry.ts` (экраны, привязка, размеры) |
| `blocker/` | `rules.ts` и `pac.ts` — чистые; `PacServer` (127.0.0.1, случайный порт); `SystemProxy` (HKCU Internet Settings, все методы async); `BlockerController` |
| `audio/` | `AudioController` (состояние микшера), `engineHost.ts` (скрытое окно), `protocol.ts` (`df-sound://sound/<id>`), `library.ts` |
| `tasks/`, `analytics/` | `TaskService`; `AnalyticsService` считает из sessions (`compute.ts` — чистые функции) |
| `hotkeys/`, `notify/`, `tray/`, `updater/` | `HotkeyManager` + `validate.ts`; `Notifier` (смотрит настройки сам); `TrayManager` (значок рисуется кодом); `UpdateService` |
| `app/` | главное окно, каналы `app:*`, `lifecycle.ts` (выход, трей, `--hidden`), `quit.ts` |
| `logger.ts`, `modules.ts` | лог `userData/logs/deepfocus.log` (ротация 1 МБ x 3); статусы модулей (`app:modules`) |

## Соглашения

- Время — `number`, миллисекунды Unix epoch. Длительности — `...Ms` или `...Min` в имени поля.
- Права администратора не нужны нигде: ничего в HKLM, `Program Files`, hosts.
- Безопасность Electron: `contextIsolation`, `sandbox`, без `nodeIntegration`, строгий CSP. Каждый IPC-обработчик валидирует аргументы.
- Сетевых запросов наружу нет, кроме проверки обновлений (и только если источник настроен). Телеметрии нет.
- Тексты интерфейса — только через `src/shared/i18n/{ru,en}.ts` (домены в `ru/<domain>.ts`, `en/<domain>.ts`); ключ, отсутствующий в одном из словарей, — ошибка типов. В renderer: `useT()`, `useSettings()` из `src/renderer/shared/`; UI-примитивы — `ui.tsx`, токены — `theme.css`.
- Ошибка одного модуля не валит остальные: инициализация обёрнута, сбой даёт статус `error` модуля и запись в лог.
- Файлы по доменам: main `src/main/<module>/`, preload `src/preload/api/<domain>.ts`, страницы `src/renderer/app/pages/<Section>/`, вкладки настроек `pages/Settings/<Tab>Tab.tsx`; тесты рядом с кодом (`*.test.ts`), e2e — `tests/e2e/<domain>.spec.ts`.
- В `shared/types.ts`, `ipc.ts`, `defaults.ts` поля только добавляются, без переименований.
- Версии зависимостей в `package.json` зафиксированы точно, без `^`.

## Сквозные детали

- Модуль timer сам подписан на `powerMonitor` suspend/resume и `app.before-quit`; другим модулям подписываться повторно не нужно. Конец интервала, замеченный позже 5 с, даёт `awaiting`; скачок часов больше 60 с без событий питания идёт в `suspendedMs`.
- Блокировка меняет только значения HKCU Internet Settings (PAC на локальный сервер) и хранит исходные в `kv.blocker.proxySnapshot`. Снятие при выходе и `--cleanup` — внутри `registerBlocker`; деинсталлятор (`build/installer.nsh`) вызывает `DeepFocus.exe --cleanup`.
- Звук: статус движка main принимает только от webContents окна audio; окно создаётся по требованию и закрывается вместе с последним другим окном. Свои звуки — `userData/sounds/<id>.<ext>`, список в kv `audio.customSounds`.
- Виджет: `hidden` — «скрыл пользователь», автоскрытие после сессии его не меняет. Ресайз — уголком внутри окна через `widget:resize`.
- Удаление всех данных: маркер-файл и перезапуск, файлы удаляются до открытия БД при следующем старте (`DEEPFOCUS_NO_RELAUNCH` отключает перезапуск в e2e).
- Автозапуск (`setLoginItemSettings`) включается только в установленной сборке. `APP_USER_MODEL_ID` = `com.deepfocus.app`, тот же appId в `electron-builder.yml`.
- Цели (дневные и недельные) хранятся в `AppSettings.goals`; достижения — id `daily:YYYY-MM-DD`, `weekly:<понедельник>`, `project:<id>:<понедельник>`. Неделя с понедельника (`src/shared/periods.ts`).

## Швы для тестов

- Чистые функции под Vitest: `blocker/rules.ts`, `pac.ts`, `domain.ts`; `widget/geometry.ts`; `hotkeys/validate.ts`; `analytics/compute.ts`; `renderer/audio/dsp.ts`.
- `SystemProxy` в тестах заменяется фейком; реальный реестр — `SystemProxy.registry.test.ts` под `DF_REAL_REGISTRY=1`.
- e2e (`tests/e2e/`): Playwright `_electron` против `out/`, помощники в `helpers.ts`, проверки окон Win32 — `win32.ps1`.
