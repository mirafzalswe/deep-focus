<!-- autopilot:start -->
# Deep Focus

Десктоп-приложение для Windows (Electron): плавающий таймер концентрации поверх окон, блокировка отвлекающих сайтов, фоновые звуки, задачи и аналитика — для тех, кому нужны длинные периоды глубокой работы.

## Команды

В этой сети перед каждой командой npm/npx: `NODE_OPTIONS=--use-system-ca`. Чистый клон: строки 1, 2, затем check, build, e2e по порядку.

| Что | Команда |
|---|---|
| 1. зависимости (скрипты отключены `.npmrc`) | `NODE_OPTIONS=--use-system-ca npm ci` |
| 2. бинарь Electron (отдельно, см. «Подводные камни») | `NODE_OPTIONS=--use-system-ca npm run electron:install` |
| запуск в разработке | `npm run dev` |
| типы + тесты + линтер (313 passed, 1 skipped) | `npm run check` |
| один файл тестов | `npx vitest run <файл>` |
| сборка в `out/` | `npm run build` |
| e2e, нужен свежий `npm run build` (29 passed, 4 skipped) | `npm run e2e` |
| установщик → `release\Deep Focus Setup 0.1.0.exe` | `NODE_OPTIONS=--use-system-ca npm run dist` |
| e2e установленной сборки | `DF_INSTALLED_EXE=<путь к exe> npx playwright test tests/e2e/acceptance.spec.ts` |

## Где что

- Архитектура, поток данных, границы модулей, соглашения — `docs/architecture.md`; читай перед правкой, затрагивающей несколько модулей.
- Почему так решено — `docs/adr/`; словарь (интервал, сессия и т.д.) — `CONTEXT.md`.
- Что не доделано и известные баги — `.autopilot/PROGRESS.md` (появляется при сдаче сборки).
- Main: `src/main/<module>/` (`index.ts` с `register<Module>`, `ipc.ts` с обработчиками); общие типы, каналы IPC, дефолты, i18n — `src/shared/`.
- Мост в renderer — `src/preload/api/<domain>.ts` (это `window.deepFocus`); окна — `src/renderer/{app,widget,audio}/`.
- Тесты лежат рядом с кодом (`*.test.ts`); e2e — `tests/e2e/`; критерии готовности и ручной чек-лист — `docs/acceptance.md`, `docs/manual-checklist.md`; ограничения для пользователя — `docs/limitations.md`.
- Сборка установщика — `electron-builder.yml`, `build/` (NSIS-хук, иконки `npm run icons`).

## Подводные камни

- `.npmrc` с `ignore-scripts=true`: иначе better-sqlite3 собирается через node-gyp и падает без Visual Studio. Поэтому бинарь Electron ставится отдельно (`npm run electron:install`), а `dist` идёт с `npmRebuild: false`.
- e2e: главное окно искать по URL (`launchMain` в `tests/e2e/helpers.ts`), не `firstWindow()` — при идущей сессии первым открывается виджет или окно audio.
- e2e при заблокированном экране: эмулированный ввод не доходит; `tests/e2e/win32.ps1` доставляет `WM_HOTKEY` окнам процесса.
- Блокировка меняет только HKCU Internet Settings; тесты реального реестра идут лишь с `DF_REAL_REGISTRY=1`.
- Модуль timer сам подписан на `powerMonitor` и `before-quit` — не подписывайся повторно.
- Ctrl+Alt+Space (старт/пауза по умолчанию) на этой машине может быть занят другой программой.
- Источник обновлений — заглушка `[GITHUB_OWNER]/[GITHUB_REPO]` в `electron-builder.yml` и `src/main/updater/source.ts`; значения должны совпадать (тест).
- Звуки: mp3 пользователь кладёт в `assets/sounds/`, точные имена — `assets/sounds/README.md`; без файла звук виден, но не играет.
- Миграции БД (`src/main/db/migrations.ts`) только дописываются в конец; в `src/shared/{types,ipc,defaults}.ts` поля только добавляются.

## Окружение

- `DEEPFOCUS_USER_DATA` — своя папка данных вместо `userData` (изоляция e2e).
- `DEEPFOCUS_NO_RELAUNCH` — не перезапускать приложение после «удалить все данные» (только e2e).
- `DF_REAL_REGISTRY=1` — включает тесты реального реестра.
- `DF_INSTALLED_EXE` — путь к установленной сборке для приёмочного e2e.
- `NODE_OPTIONS=--use-system-ca` — корпоративный сертификат для npm/npx.

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`.
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».

### Правка без автопилота

Мелкий баг или доводка после сборки — обычная сессия, без прогона.

Сначала прочитай:
1. `.autopilot/PROGRESS.md` — что не доделано, известные баги, о чём договорились с пользователем.
2. Что правили после последней сборки — первая строка таблицы в «История git».
3. Только если правка их касается: почему сделано так — `docs/adr/`; что значат слова — `CONTEXT.md`;
   что именно просили — `manifest.md` в папке сборки (указана в начале `PROGRESS.md`).

После правки:
- коммит — по правилам из «История git»;
- строка в «Правки без автопилота» в `PROGRESS.md`: дата — что — почему;
- починенный пункт из «Не доделано» или «Известные баги» — удали;
- договорились с пользователем о том, что следующая сборка не должна пересматривать, —
  строка в «Договорились», его словами.

### История git

Целиком не читай — бери срез под вопрос:

| Вопрос | Команда |
|---|---|
| что правили после последней сборки | `git log --oneline "$(git log -1 --format=%h --grep='^Autopilot: сборка сдана')"..HEAD -- . ':(exclude).autopilot'` |
| всё, что делали ради требования | `git log --oneline --grep="R02"` |
| история файла | `git log --oneline -10 -- <файл>` |
| когда появился или исчез код | `git log --oneline -S "<фрагмент>"` |
| почему строка такая | `git blame -L <с>,<по> <файл>`, затем `git show <sha>` |
| что внутри коммита | `git show --stat <sha>` |

Срез длиннее ~30 коммитов — отдай его субагенту и возьми выжимку в десять строк.

Коммит: заголовок — что (`fix: даты в одном формате`), тело — почему, трейлер
`--trailer "Requirements: R02"`, если правка касается требования из `manifest.md`.
Заголовок `Autopilot: сборка сдана` пишет только автопилот — по нему находят последнюю сборку.
<!-- autopilot:end -->
