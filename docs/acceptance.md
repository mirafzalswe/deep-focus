# Критерии готовности: чем подтверждён каждый сценарий

Семнадцать сценариев из раздела «Критерии готовности» брифа. Автоматические проверки запускаются командами `npm run check` (Vitest, типы, линтер) и `npm run build && npm run e2e` (Playwright против собранного приложения на Windows 10). Файл разбирает `tests/e2e/acceptance.spec.ts`: все 17 строк на месте, все указанные файлы существуют.

| № | Сценарий | Чем подтверждён | Файлы |
|---|---|---|---|
| 1 | Таймер корректно отсчитывает время | Движок на фиктивных часах: старт, пауза без потери времени, стоп, секундомер; e2e — отсчёт в окне и запись в базе | `src/main/timer/TimerEngine.test.ts`, `tests/e2e/timer.spec.ts` |
| 2 | Рабочие и перерывные интервалы переключаются по настройкам | Циклы 4×Focus → длинный перерыв, автопереход, ручной режим, свой пресет | `src/main/timer/TimerEngine.test.ts`, `src/main/timer/presets.test.ts`, `tests/e2e/timer.spec.ts` |
| 3 | Виджет остаётся поверх обычных окон | e2e читает у настоящего окна `WS_EX_TOPMOST` через PowerShell и сравнивает z-порядок с Блокнотом (фокус Блокнота — предупреждением, если Windows его не отдала) | `tests/e2e/widget.spec.ts`, `tests/e2e/win32.ps1` |
| 4 | Виджет свободно перемещается и меняется в размере | Привязка к углам, ограничения размера, перетаскивание сохраняет границы; логика экранов — чистыми функциями | `src/main/widget/WidgetManager.test.ts`, `src/main/widget/geometry.test.ts` |
| 5 | Прозрачность регулируется без потери читаемости | Прозрачность окна и фона применяются из настроек; e2e проверяет значение у реального окна. Читаемость на 30% — ручной пункт 12 (глазами) | `src/main/widget/WidgetManager.test.ts`, `tests/e2e/widget.spec.ts`, `docs/manual-checklist.md` |
| 6 | Click-through и интерактивный режим работают | e2e читает `WS_EX_TRANSPARENT` у реального окна, переключение горячей клавишей и из главного окна | `tests/e2e/widget.spec.ts`, `src/main/widget/WidgetManager.test.ts` |
| 7 | Настройки виджета сохраняются после перезапуска | e2e перезапускает приложение: позиция, прозрачность, click-through, скрытость | `tests/e2e/widget.spec.ts`, `src/main/settings/settings.test.ts` |
| 8 | Таймер работает при переключении приложений | Время считается в main на абсолютных метках, окна только показывают; e2e уводит фокус в Блокнот при идущей сессии | `tests/e2e/widget.spec.ts`, `src/main/timer/TimerEngine.test.ts` |
| 9 | Блокировка препятствует открытию выбранных URL | e2e: после согласия Focus переключает системный прокси на PAC, `youtube.com` ведёт на заглушку, по окончании настройки ровно исходные; PAC и правила — юнит-тестами. Реальные Edge и Chrome — ручные пункты 16–19 | `tests/e2e/blocker.spec.ts`, `src/main/blocker/pac.test.ts`, `src/main/blocker/rules.test.ts`, `docs/manual-checklist.md` |
| 10 | Статус блокировки отображается корректно | Состояния off / active / error / unavailable с причиной и проверкой после включения | `tests/e2e/blocker.spec.ts`, `src/main/blocker/BlockerController.test.ts` |
| 11 | Звуки могут воспроизводиться одновременно | e2e микширует генератор и файл в окне audio, снимок `__dfAudio()` | `tests/e2e/sounds.spec.ts`, `src/main/audio/AudioController.test.ts` |
| 12 | Громкость дорожек регулируется независимо | Громкость каждой дорожки, общая громкость и mute проверяются раздельно | `tests/e2e/sounds.spec.ts`, `src/main/audio/AudioController.test.ts` |
| 13 | Сессии и задачи корректно сохраняются | Задачи, проекты, исходы сессий; e2e: сессия в базе, данные после перезапуска | `src/main/tasks/TaskService.test.ts`, `tests/e2e/tasks.spec.ts`, `tests/e2e/timer.spec.ts` |
| 14 | Аналитика соответствует фактическому времени | Суммы activeMs по границам дня, недели и месяца, разбивки, часы, точность учёта | `src/main/analytics/compute.test.ts`, `src/main/analytics/AnalyticsService.test.ts` |
| 15 | Приложение восстанавливает состояние после сбоя | Строка recovery, продолжение интервала, интервал, истёкший пока приложение было выключено; e2e — перезапуск с идущей сессией; удаление блокировки после сбоя (`--cleanup`) | `src/main/timer/TimerEngine.test.ts`, `tests/e2e/timer.spec.ts`, `tests/e2e/system.spec.ts`, `tests/e2e/blocker.spec.ts` |
| 16 | Ошибка одного модуля не ломает всё приложение | Падение окна audio не останавливает таймер; повреждённая база переименовывается, приложение стартует; сбой блокировки не мешает сессии; установленное приложение стартует без модулей в ошибке | `tests/e2e/sounds.spec.ts`, `tests/e2e/shell.spec.ts`, `tests/e2e/blocker.spec.ts`, `tests/e2e/acceptance.spec.ts` |
| 17 | Системные ограничения и исключения документированы | Полноэкранные приложения, браузеры без системного прокси, отдельные браузеры, поддомены, открытые вкладки, корпоративный PAC, сон, SmartScreen | `docs/limitations.md`, `README.md`, `docs/manual-checklist.md` |

## Проверки безопасности и поставки

- `npm audit --omit=dev` — без уязвимостей уровня high и critical.
- `tests/e2e/acceptance.spec.ts`: ни в одном исходнике нет `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`; строгий CSP во всех трёх страницах; главное окно и виджет созданы с `contextIsolation`, `sandbox`, без `nodeIntegration`.
- `src/main/updater/UpdateService.test.ts`: пока `[GITHUB_OWNER]/[GITHUB_REPO]` не заполнены, проверка обновлений выключена и `electron-updater` не создаётся; настроенный источник — проверка, скачивание по второму нажатию, установка при выходе.
- Установленное приложение: `DF_INSTALLED_EXE="<папка установки>\Deep Focus.exe" npx playwright test tests/e2e/acceptance.spec.ts` — запуск установленной сборки, база, окна, ресурсы, обновления, автозапуск выключен без согласия пользователя.

## Что проверяется только вручную

Windows 11, два монитора, реальные Edge и Chrome, сон компьютера, автозапуск после входа в систему, уведомления в Центре уведомлений Windows 11 — [manual-checklist.md](manual-checklist.md). Причина: на этой машине одна версия Windows и один монитор.
