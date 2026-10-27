# Интерфейсы

Файл, который каждый исполнитель читает первым. Имена ниже — обязательные: два таска не называют одно поле по-разному.

## Правила проекта

- Electron + TypeScript (strict) + React + Tailwind CSS; сборка — `electron-vite`, упаковка — `electron-builder` (NSIS, установка **для текущего пользователя, без прав администратора**).
- **Никаких прав администратора** ни в одном сценарии (пользователь: «должен работать без этого»). Ничего не пишем в HKLM, в `Program Files`, в hosts.
- Безопасность Electron: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, строгий CSP, renderer ходит в систему **только** через `window.deepFocus` из preload. Каждый IPC-обработчик в main валидирует аргументы.
- Ни одного сетевого запроса наружу, кроме проверки обновлений (GitHub Releases, только если источник настроен). Никакой телеметрии.
- Единственный источник правды о таймере, блокировке, звуке и настройках — **main-процесс**. Окна только отображают снимки и шлют команды.
- Время — `number`, миллисекунды Unix epoch. Длительности — `…Ms` или `…Min` в имени поля, без исключений.
- Тексты интерфейса — только через i18n-словари `src/shared/i18n/{ru,en}.ts`; ключ отсутствует в одном из словарей — ошибка типов.
- Ошибка одного модуля не валит остальные: инициализация каждого модуля в main обёрнута, сбой → статус `error` у модуля + запись в лог.
- Проверка одной командой: `npm run check` = `tsc --noEmit` (все проекты) + `vitest run` + `eslint`.
- **Файлы по доменам, чтобы таски шли параллельно.** Т01 создаёт каркас всех модулей (заглушки), а дальше каждый таск пишет только в свои папки:
  - main: `src/main/<module>/` (включая `ipc.ts` — регистрация обработчиков своего домена); `src/main/index.ts` только вызывает `register<Module>()` и в дальнейших тасках не меняется, кроме Т07 (жизненный цикл);
  - preload: `src/preload/api/<domain>.ts`, собираются в `src/preload/index.ts` (создан в Т01 под все домены);
  - i18n: `src/shared/i18n/{ru,en}/<domain>.ts`;
  - renderer: `src/renderer/app/pages/<Section>/`, вкладки настроек — `src/renderer/app/pages/Settings/<Tab>Tab.tsx` (Timer — Т02, Widget — Т03, Blocker — Т04, Sounds — Т05, General — Т07);
  - тесты рядом с кодом домена: `src/**/<domain>/*.test.ts`, e2e — `tests/e2e/<domain>.spec.ts`.
  - `src/shared/types.ts`, `src/shared/ipc.ts`, `src/shared/defaults.ts` пишет Т01 целиком; позже — только добавление полей своего домена, без переименований.
- Команды (создаёт Т01): `npm run dev` · `npm run build` · `npm run check` · `npx vitest run <файл>` (один файл) · `npm run e2e` (после `npm run build`) · `npm run dist` (Т08).
- Версии: Node 24 на этой машине; Electron — последняя стабильная (45.x на 2026-10-27), версии фиксируются в `package.json` точно, без `^`.
- Перед любой командой npm в этой сети: `NODE_OPTIONS=--use-system-ca` (корпоративный сертификат; без него npm падает с UNABLE_TO_VERIFY_LEAF_SIGNATURE).

## Границы, решённые в спецификации

### Раскладка

```
src/
  shared/            типы, имена IPC-каналов, i18n, чистые функции без Electron
    types.ts         все типы ниже
    ipc.ts           имена каналов (const enum-like объект IPC)
    i18n/ru.ts en.ts
    defaults.ts      DEFAULT_SETTINGS, BUILTIN_TIMER_PRESETS, BUILTIN_SOUND_PRESETS, BUILTIN_BLOCK_RULES, SOUND_LIBRARY, SEED_PROJECTS
  main/
    index.ts         сборка модулей, single-instance, жизненный цикл
    db/              Storage
    settings/        SettingsManager
    timer/           TimerEngine
    widget/          WidgetManager
    blocker/         BlockerController + PacServer + SystemProxy
    audio/           AudioController (сторона main)
    tasks/           TaskService
    analytics/       AnalyticsService
    hotkeys/         HotkeyManager
    notify/          Notifier
    tray/            TrayManager
    updater/         UpdateService
    logger.ts        Logger
  preload/index.ts   window.deepFocus
  renderer/
    app/             главное окно (React-роутинг по разделам)
    widget/          плавающий виджет
    audio/           скрытое окно со звуковым движком (Web Audio)
assets/sounds/       mp3 пользователя (`<soundId>.mp3`), попадают в сборку как extraResources
resources/           иконки
tests/e2e/           Playwright (_electron) + PowerShell-проверки окон
```

### Общие типы (`src/shared/types.ts`)

```ts
type IntervalKind = 'focus' | 'shortBreak' | 'longBreak';
type TimerMode = 'pomodoro' | 'stopwatch' | 'free';   // free — Deep Work без обязательных перерывов
type TimerStatus = 'idle' | 'running' | 'paused' | 'awaiting';  // awaiting — интервал кончился, ждём решения (ручной режим)
type EndReason = 'completed' | 'stopped' | 'skipped' | 'restarted' | 'reset' | 'appQuit' | 'recoveredCompleted';
type SessionOutcome = 'done' | 'partial' | 'later' | 'cancelled';

interface TimerPreset { id: string; name: string; builtin: boolean;
  focusMin: number; shortBreakMin: number; longBreakMin: number; cyclesBeforeLong: number; }

interface TimerSnapshot {
  status: TimerStatus; mode: TimerMode; kind: IntervalKind; presetId: string;
  sessionId: string | null;
  plannedMs: number | null;          // null — stopwatch / free без лимита
  startedAt: number | null; endAt: number | null;   // endAt — абсолютное время конца интервала
  pausedAt: number | null; pausedMs: number; suspendedMs: number;
  elapsedMs: number; remainingMs: number | null; activeMs: number;   // activeMs = elapsed − paused − suspended
  completedFocusInCycle: number; taskId: string | null; projectId: string | null;
  recovered: boolean; now: number;
}

interface SessionRecord { id: string; kind: IntervalKind; mode: TimerMode; presetId: string;
  taskId: string | null; projectId: string | null; startedAt: number; endedAt: number;
  plannedMs: number | null; activeMs: number; pausedMs: number; suspendedMs: number;
  endReason: EndReason; outcome: SessionOutcome | null; recovered: boolean; }

type Priority = 'low' | 'medium' | 'high';
type TaskStatus = 'open' | 'inProgress' | 'done' | 'cancelled';
interface Project { id: string; name: string; color: string; weeklyGoalMin: number | null; archived: boolean; }
interface Task { id: string; title: string; description: string; projectId: string | null;
  priority: Priority; plannedMin: number | null; status: TaskStatus; createdAt: number; updatedAt: number; }

interface Schedule { days: number[]; from: string; to: string; }   // days 0=вс..6=сб, 'HH:MM'
interface BlockRule { id: string; pattern: string;   // нормализованный домен, без схемы и пути
  category: 'social' | 'video' | 'messenger' | 'news' | 'entertainment' | 'custom';
  enabled: boolean; duringFocus: boolean; duringShortBreak: boolean; duringLongBreak: boolean;
  schedule: Schedule | null; builtin: boolean; }
type BlockerState = 'off' | 'active' | 'error' | 'unavailable';
interface BlockerStatus { state: BlockerState; reasonKey: string | null;   // i18n-ключ причины
  activeDomains: string[]; activeRuleIds: string[]; verifiedAt: number | null;
  strictLocked: boolean; unlockAvailableAt: number | null; }

interface SoundDef { id: string; nameKey: string; category: 'nature' | 'noise' | 'ambience' | 'custom';
  source: { type: 'file'; file: string } | { type: 'generated'; generator: 'white' | 'pink' | 'brown' }; }
interface SoundAvailability { id: string; available: boolean; path: string | null; }
interface TrackState { soundId: string; enabled: boolean; volume: number; }   // 0..1
interface SoundPreset { id: string; name: string; builtin: boolean; tracks: TrackState[]; masterVolume: number; }
interface AudioStatus { playing: boolean; presetId: string | null; tracks: TrackState[];
  masterVolume: number; muted: boolean; missing: string[]; error: string | null; }

type WidgetDisplayMode = 'compact' | 'standard' | 'expanded';
type Anchor = 'free' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
interface WidgetBounds { x: number; y: number; width: number; height: number; displayId: number | null; }

interface AppSettings {
  timer: { activePresetId: string; autoSwitch: boolean; autoStartNextCycle: boolean;
    keepBlockingOnPause: boolean; freeExtendMin: number; };
  widget: { opacity: number; backgroundOpacity: number; displayMode: WidgetDisplayMode;
    alwaysOnTop: boolean; clickThrough: boolean; bounds: WidgetBounds | null; anchor: Anchor;
    marginPx: number; showOnSessionStart: boolean; hidden: boolean;
    onDisplayRemoved: 'primary' | 'nearest'; };
  blocker: { enabled: boolean; level: 'standard' | 'strict'; scheduledEnabled: boolean;
    strictUnlockDelaySec: number; };
  sound: { workPresetId: string | null; breakPresetId: string | null; autoStartOnSession: boolean;
    breakBehavior: 'stop' | 'continue' | 'switch' | 'lower'; lowerFactor: number;
    masterVolume: number; fadeOutMs: number; };
  notifications: { enabled: boolean; silent: boolean; sessionStart: boolean; focusEnd: boolean;
    breakStart: boolean; breakEnd: boolean; dailyGoal: boolean; blockerError: boolean; };
  hotkeys: { startPause: string; toggleWidget: string; toggleClickThrough: string;
    endSession: string; toggleSound: string; };   // Electron accelerator, '' — отключено
  goals: { dailyMinutes: number; dailySessions: number; weeklyMinutes: number; showStreak: boolean; };
  general: { theme: 'dark' | 'light' | 'system'; language: 'ru' | 'en'; launchAtLogin: boolean;
    closeToTray: boolean; quitBehavior: 'ask' | 'keep' | 'stop'; };
}
```

### Модули main: владеет · отдаёт · прячет

| Модуль | Владеет | Отдаёт | Прячет |
|---|---|---|---|
| **Storage** (`db/`) | файл `deepfocus.db` в `userData`, миграции | `open(path)`, репозитории: `settings.get/set`, `sessions.insert/list(range)/update`, `tasks.*`, `projects.*`, `timerPresets.*`, `soundPresets.*`, `blockRules.*`, `recovery.get/put/clear` (одна строка JSON), `achievements.insert/list`, `kv.get/set` | SQL, драйвер (better-sqlite3; если нативная сборка невозможна — sql.js с атомарной записью через temp+rename — решает T01 и пишет сюда) |
| **SettingsManager** | `AppSettings` | `get()`, `patch(partial)` (глубокое слияние + валидация, бросает `SettingsError`), `on('change', (next, prev))`, `exportBackup(): BackupFile`, `importBackup(file)` | хранение в Storage, значения по умолчанию |
| **TimerEngine** | состояние таймера, запись `SessionRecord` по концу интервала, строка recovery | команды `start({mode, kind?, presetId?, plannedMin?, taskId?})`, `pause()`, `resume()`, `stop()`, `reset()`, `skipBreak()`, `skipSession()`, `restartSession()`, `switchKind(kind)`, `extend(min)`, `setOutcome(sessionId, outcome)`; `snapshot()`; события `on('tick'\|'state', snap)`, `on('intervalEnded', record)`, `on('sessionStarted', snap)`; `recover(now)` при запуске; `onSuspend()/onResume()` | setInterval (только для тиков отображения), heartbeat, расчёт activeMs |
| **WidgetManager** | окно виджета | `show()`, `hide()`, `toggle()`, `setClickThrough(b)`, `toggleClickThrough()`, `setAlwaysOnTop(b)`, `applySettings(widget)`, `snapToAnchor(anchor)`, `isVisible()`; событие `on('boundsChanged', bounds)` | BrowserWindow, уровень topmost, подписка на `screen` |
| **BlockerController** | правила, системный прокси пользователя, PAC-сервер | `activeDomainsFor(ctx)` (чистая), `applyFor(ctx)`, `deactivate()`, `status()`, `on('status', s)`, `requestUnlock()`, `confirmUnlock(phrase)`, `restoreOnStartup()`, `cleanup()` (для удаления/выхода) | `PacServer` (127.0.0.1, случайный порт), `SystemProxy` (HKCU Internet Settings через `reg.exe` + уведомление WinINET через PowerShell P/Invoke), сохранённые исходные настройки |
| **AudioController** | состояние микшера, скрытое окно audio | `play(presetOrTracks)`, `stop({fade})`, `setTrack(soundId, {enabled?, volume?})`, `setMaster(v)`, `toggleMute()`, `applyBreakBehavior()`, `availability(): SoundAvailability[]`, `addCustomSound(filePath, name)`, `status()`, `on('status', s)` | Web Audio, декодирование, бесшовные петли — в renderer/audio |
| **TaskService** | задачи, проекты | `list(filter)`, `create`, `update`, `remove`, `projects.*`, `applyOutcome(taskId, outcome)` | — |
| **AnalyticsService** | ничего (считает из sessions) | `summary(range, now): AnalyticsSummary`, `goalProgress(now)`, `streak(now)`, `recordAchievements(now)` | — |
| **HotkeyManager** | регистрации globalShortcut | `applyAll(hotkeys): HotkeyResult[]`, `validate(accel, action): HotkeyCheck` | список системных сочетаний |
| **Notifier** | — | `notify(event: NotifyEvent, params)` — сам смотрит настройки | Electron Notification |
| **TrayManager** | иконка трея | `create()`, `refresh(snapshot)` | меню |
| **UpdateService** | — | `checkNow()`, `status()`, `installOnQuit()` | electron-updater |
| **Logger** | `userData/logs/deepfocus.log` (ротация 1 МБ × 3) | `logger.error/warn/info(scope, msg, err?)` | — |

### IPC (`src/shared/ipc.ts`) и `window.deepFocus`

Запросы — `ipcRenderer.invoke`, рассылки — `webContents.send`. Имена каналов — `домен:действие`.

```ts
window.deepFocus = {
  timer:    { command(cmd: TimerCommand): Promise<TimerSnapshot>; snapshot(); presets(); savePreset(p); deletePreset(id);
              setOutcome(sessionId, outcome); onState(cb): Unsubscribe; },
  widget:   { show(); hide(); toggle(); setClickThrough(b); setAlwaysOnTop(b); snapTo(anchor); },
  blocker:  { status(); rules(); saveRule(r): Promise<{rule: BlockRule; warningKey: string|null}>; deleteRule(id);
              requestUnlock(); confirmUnlock(phrase); recheck(); onStatus(cb); },
  audio:    { status(); library(): Promise<(SoundDef & SoundAvailability)[]>; play(presetId|tracks); stop();
              setTrack(id, patch); setMaster(v); toggleMute(); presets(); savePreset(p); deletePreset(id);
              addCustomSound(): Promise<SoundDef|null>; onStatus(cb); },
  tasks:    { list(f); create(t); update(id, patch); remove(id); projects(); saveProject(p); deleteProject(id); },
  analytics:{ summary(range); history(range); goals(); onChanged(cb); },
  settings: { get(); patch(p); onChange(cb); exportBackup(); importBackup(); openDataFolder(); deleteAllData(); },
  hotkeys:  { validate(accel, action); results(); },
  app:      { version(); quit(); checkUpdates(); updateStatus(); logPath(); },
};
type TimerCommand =
  | { type: 'start'; mode: TimerMode; kind?: IntervalKind; presetId?: string; plannedMin?: number | null; taskId?: string | null }
  | { type: 'pause' | 'resume' | 'stop' | 'reset' | 'skipBreak' | 'skipSession' | 'restartSession' }
  | { type: 'switchKind'; kind: IntervalKind } | { type: 'extend'; min: number };
```

Окно audio получает команды по `audio:engine-*` и отвечает статусом; renderer главного окна и виджета в него не ходят.

### Контекст блокировки

```ts
interface BlockContext { timerKind: IntervalKind | null; timerStatus: TimerStatus; now: number;
  scheduledEnabled: boolean; keepBlockingOnPause: boolean; }
// activeDomainsFor(rules, ctx) — чистая функция в src/main/blocker/rules.ts
// buildPac(domains, upstream: {type:'direct'} | {type:'proxy', server, bypass: string[]}, port) — чистая, src/main/blocker/pac.ts
```

### Швы для тестов

- `TimerEngine` получает `Clock { now(): number }` и `TimerStore` (обёртка над Storage) — тестируется на Vitest с фиктивными часами, без Electron.
- `rules.ts`, `pac.ts`, `normalizeDomain()`, `widget/geometry.ts` (`fitBoundsToDisplays(bounds, displays, policy)`, `anchorBounds(...)`), `hotkeys/validate.ts`, `analytics/compute.ts` — чистые функции, Vitest.
- `SystemProxy` — интерфейс `{ read(): ProxySettings; apply(pacUrl): void; restore(saved): void; resolveProxyFor(url): string }`; в тестах — фейк.
- E2E: `@playwright/test` `_electron` против собранного приложения + `tests/e2e/win32.ps1` (P/Invoke `GetWindowLong`) — проверка `WS_EX_TOPMOST`, `WS_EX_TRANSPARENT` у реального окна виджета.

## Что построено в тасках

(Дописывается после каждого таска: что появилось и где.)

### Т01 — каркас (построено)

- **SQLite — better-sqlite3 13.0.3** (N-API prebuild грузится и в Node 24, и в Electron 45 без пересборки). Electron **45.0.0** (Node 24.22), TypeScript 6.0.3, Vite 8.3.5, electron-vite 6.0.0, React 19.3.1, Tailwind 4.3.3, Vitest 5.0.5, ESLint 10.13.0, Playwright 1.64.1. Install-скрипты отключены `.npmrc` (`ignore-scripts=true`): иначе npm собирает better-sqlite3 через node-gyp и падает без Visual Studio. Бинарь Electron — `npm run electron:install` после `npm ci`.
- Команды: `npm run dev|build|check|e2e`, `npm run typecheck|test|lint`, `npx vitest run <файл>`. e2e требует `npm run build` перед запуском.
- Модули: `register<Module>(ctx: MainContext)` в `src/main/<module>/index.ts`; `ctx.services: Partial<Services>`, модуль дополняет тип через `declare module '../context'`. IPC: `handle<A>(channel, checks, fn)` (`src/main/ipc.ts`) проверяет отправителя и аргументы; проверки — `v.*` из `src/main/validate.ts`. Внутренние события — `src/main/events.ts`.
- Storage: `openStorage(path)`, `openStorageSafe(path,{now}) → {storage, corruptBackupPath}`; репозитории `settings.getAll/set/clear`, `sessions.insert/update/get/list(range)`, `tasks.list/get/insert/update/remove`, `projects|timerPresets|soundPresets|blockRules.list/get/upsert/remove`, `recovery.get/put(value, updatedAt)/clear`, `achievements.insert/list`, `kv.get/set/delete`. Миграции в `db/migrations.ts` только дописываются в конец, версия — `kv.schemaVersion`.
- `SettingsError(field)`. i18n: `translate(lang, MessageKey, params)`; в renderer — `useT()`, `useSettings()` (`src/renderer/shared/`); общие UI-примитивы — `src/renderer/shared/ui.tsx`, токены — `theme.css`.
- Добавки к границам: модуль `src/main/app/` (каналы `app:*`, главное окно `app/mainWindow.ts`, окна — `src/main/windows.ts`); каналы `app:modules`, `app:notice`; preload-домен `audioEngine` (`onCommand`/`reportStatus`) — только для скрытого окна audio; рассылки `blocker:statusChanged`, `audio:statusChanged`, `settings:changed`, `analytics:changed`; типы `TaskFilter`, `DateRange`, `BackupFile`, `SettingsPatch`, `FileActionResult`, `AnalyticsSummary` (минимальная — Т06 расширяет), `GoalProgress`, `Achievement`, `HotkeyCheck/Result`, `UpdateStatus`, `ModuleStatus`; i18n-домены `common`, `nav`, `system` (Т07), `updates` (Т08).
- Маршруты renderer — hash `#/<section>/<tab>`. Переменная `DEEPFOCUS_USER_DATA` переопределяет `userData` (e2e). e2e-помощники — `tests/e2e/helpers.ts`.
- Заглушки timer/blocker/audio/tasks/analytics уже читают Storage; их таски заменяют заглушки целиком. «Удалить все данные» сейчас: файл-маркер + перезапуск, удаление до открытия БД при следующем старте (Т07 доводит).

### Т02 — таймер (построено)

- `TimerEngine(deps {clock, store: TimerStore, settings: () => AppSettings['timer'], newId?, onError?})`, экспорт из `src/main/timer/index.ts`; `ctx.services.timer: TimerEngine`. Методы: `command(cmd)`, `start/pause/resume/stop/reset/skipBreak/skipSession/restartSession/switchKind/extend`, `setOutcome`, `snapshot()`, `recover(now)`, `onSuspend()/onResume()`, `refresh()`, `heartbeat()`, `dispose()`.
- События: `on('tick'|'state', snap)`; `on('intervalEnded', SessionRecord)` — на каждую запись с любой причиной; `on('sessionStarted', snap)` — на каждый новый интервал, включая перерывы и автопереход, но не на продолжение после `recover`. Порядок: `intervalEnded → sessionStarted → state`.
- `TimerStore {preset, taskProjectId, insertSession, updateOutcome, loadRecovery, saveRecovery}`, `storageTimerStore(storage)`.
- `timer:state` рассылается на каждом переходе и раз в секунду, пока идёт. В `idle`/`awaiting` снимок держит в `kind`/`plannedMs` предложенный следующий интервал.
- Модуль timer **сам** подписан на `powerMonitor` suspend/resume и `app.before-quit` (финальный heartbeat) — повторно не подписываться.
- Решения: `reset` → idle на тот же интервал полной длины; `restartSession` стартует сразу; `stop` всегда `stopped` и сбрасывает счётчик цикла; пропущенный Focus в цикл не идёт; `switchKind` во время интервала пишет `stopped` и запускает выбранный; конец интервала, замеченный позже 5 с, → `awaiting` вместо автоперехода; скачок часов > 60 с без событий питания → `suspendedMs`.
- e2e: при идущей сессии виджет открывается раньше главного окна — главное окно искать по URL, не `firstWindow()`.

### Т03 — виджет (построено)

- `WidgetManager` (`ctx.services.widget`): `show() hide() toggle() isVisible() setClickThrough(b) toggleClickThrough() setAlwaysOnTop(b) snapToAnchor(anchor) resize(w,h) applySettings(widget) start() dispose()`; события `on('boundsChanged', WidgetBounds)`, `on('visibilityChanged', boolean)`.
- `geometry.ts`: `fitBoundsToDisplays(bounds, DisplayInfo[], 'primary'|'nearest')`, `anchorBounds(size, display, corner, marginPx)`, `targetDisplay`, `clampIntoDisplay`, `clampSize(size, mode)`, `resolveBounds(widgetSettings, displays)`; `DisplayInfo {id, primary, workArea}`.
- IPC: `widget:isVisible`, `widget:showMenu`, `widget:resize`(w,h), рассылка `widget:visibilityChanged`; preload `widget.isVisible() showMenu() resize(w,h) onVisibility(cb)`.
- defaults: `WIDGET_MIN_SIZE`, `WIDGET_DEFAULT_SIZE`, `WIDGET_IDLE_HIDE_MS=5000`. Видимость: `hidden` = «скрыл пользователь»; автоскрытие после сессии `hidden` не меняет.
- Временные глобальные Ctrl+Alt+I/W — `src/main/widget/hotkeys.ts`; **Т07 вызывает `disposeWidgetHotkeys()`** перед своей регистрацией.
- Ресайз — уголком внутри виджета через `widget:resize` (прозрачное окно на Windows не тянется за край).
- До Т07: пока существует окно виджета, закрытие главного окна не завершает приложение (window-all-closed не срабатывает); в меню виджета есть «Открыть Deep Focus». Пункт трея «Показать таймер» (R56) — Т07.
- e2e: z-порядок «виджет выше Блокнота» проверяется всегда, фокус Блокнота — только предупреждением. `shell.spec` (Т01) читает вкладки без ожидания после клика — гонка, иногда падает.

### Т05 — звуки (построено)

- `ctx.services.audio: AudioController`: `play(id|TrackState[])`, `stop({fade?})`, `setTrack`, `setMaster`, `toggleMute`, `applyBreakBehavior()`, `applyFocusBehavior()`, `availability()`, `library()`, `verify(): Promise`, `addCustomSound(path,name)`, `attachFile(soundId,path)`, `status()`, `refresh()`, `bindTimer(timer)`, `on('status')`. `ctx.services.audioEngine: EngineHost` — `window()`, `dispose()`.
- Preload: `audio.addCustomSound(soundId?)` — без id добавляет в «Свои», с id кладёт файл `userData/sounds/<id>.<ext>`. `savePreset` ставит `builtin=false`, id встроенного → `ValidationError`.
- Окно audio: команды `apply{playing,masterGain,fadeMs,tracks[{soundId,source,gain}]}`, `probe{requestId,items}`; ответы `ready`, `trackFailed`, `probeResult`, `error`. Статус движка main принимает **только** от webContents окна audio. Типы `EngineSource`, `AudioEngineCommand`, `AudioEngineReport` в shared/types.ts.
- Свои звуки — kv `audio.customSounds`. URL файлов — `df-sound://sound/<id>`.
- Окно audio создаётся по требованию и уничтожается, когда закрыто последнее другое окно (**Т07 с closeToTray — перепроверить**). Декодирование проверяется при открытии Sounds и при воспроизведении; при запуске — только наличие файлов.
- Громкость = общая (настройки) × masterVolume пресета × lowerFactor на перерыве; mute — только на время работы. Звук, включённый сессией, гаснет при idle; включённый вручную — остаётся. `window.__dfAudio()` в окне audio — снимок для e2e.

### Т04 — блокировка (построено)

- `normalizeDomain(input) → {ok:true, domain, warningKey} | {ok:false, reasonKey}`, `isNormalizedDomain(s)`, `SYSTEM_DOMAINS`; `activeRulesFor(rules, ctx)`, `activeDomainsFor(rules, ctx)`, `isScheduleActive(schedule, now)`; `buildPac(domains, upstream, port)`.
- `PacServer({blockedPage, onError})`: `start/stop/setPac/pacUrl(v)/selfCheck/address`; PAC — `http://127.0.0.1:<port>/deep-focus.pac?v=<время>`; `isOurPacUrl(url)`.
- `SystemProxy {read, apply, restore, resolveProxyFor}` — **все async** (отступление от синхронной подписи). `ProxySettings = {proxyEnable, proxyServer, proxyOverride, autoConfigUrl, defaultConnectionSettings, savedLegacySettings}`.
- `ctx.services.blocker: BlockerController`: `applyFor(ctx)`, `deactivate()`, `status()`, `on('status')`, `requestUnlock()`, `confirmUnlock(phrase)`, `recheck(ctx?)`, `restoreOnStartup()`, `cleanup()` — async, наружу не бросают. kv: `blocker.proxySnapshot`, `blocker.consentAt`. `BlockerStatus.consentGiven`; `window.deepFocus.blocker.giveConsent()`. Причины статуса — ключи `blocker.reason.*`; ошибки saveRule — исключение с ключом `blocker.invalid.*` в message.
- **`--cleanup` и снятие блокировки при выходе (`will-quit`, second-instance с `--cleanup`) — внутри `registerBlocker`**; деинсталлятор Т08 вызывает `DeepFocus.exe --cleanup`.
- Уведомление «Ошибка блокировки» пока идёт напрямую через Electron Notification с учётом `notifications.*` — **Т07 переводит на Notifier**. Статус `error` на Home — Т07. Тексты 4.8.2/4.8.3/4.16 для `docs/limitations.md` — Т08.
- Тест реального реестра — `SystemProxy.registry.test.ts`, только с `DF_REAL_REGISTRY=1`.

### Т06 — задачи и аналитика (построено)

- `ctx.services.tasks: TaskService` (`list/create/update/remove/projects/saveProject/deleteProject/totals/applyOutcome/onIntervalEnded/pendingOutcome/setOutcome/dismissOutcome`); `ctx.services.analytics: AnalyticsService` (`summary/history/goalProgress/streak/recordAchievements/achievements`). `recordAchievements` возвращает **новые** записи — Notifier (Т07) по ним шлёт уведомление о дневной цели.
- Типы: `TaskDraft`, `TaskPatch` (теперь только в shared/types.ts), `TimeTotals`, `OutcomePrompt`, `BreakdownEntry`, `AccuracyBlock`, `ProjectGoalProgress`; `AnalyticsSummary` (completionRate, avgSessionMs, byProject, byTask, hourlyMs[24], accuracy); `GoalProgress.projects[]`.
- IPC: `tasks:totals|pendingOutcome|setOutcome|dismissOutcome`, рассылка `tasks:outcomeChanged`, `analytics:achievements`. `src/shared/periods.ts`: `dayRange/weekRange/monthRange/dayStart/addDays/weekStart/dayKey` (неделя с понедельника).
- Достижения: id `daily:YYYY-MM-DD`, `weekly:<понедельник>`, `project:<id>:<понедельник>`. Сессии в дневной цели — только completed/recoveredCompleted. Серия — дни с любой Focus-активностью; сегодня без работы серию не рвёт.
- Home: `OutcomeCard`, `GoalProgressCard`, `QuickTask` (Enter создаёт задачу и стартует Focus, если таймер idle).
- **Цели задаются только в настройках, а вкладки для них нет — Т07.**

### Т07 — система (построено)

- hotkeys: preload `validate(accel, action)`, `results()`, `assign(action, accel): HotkeyResult`, `setRecording(on)`, `onResults(cb)`; рассылка `hotkeys:resultsChanged`. `HotkeyManager({host, actions, onError})`; `validateHotkey`, `normalizeAccelerator`; причины `system.hotkeys.reason.{invalid,system,needsModifier,duplicate,taken}`.
- `Notifier({settings, t, show}).notify(event, {minutes?, reasonKey?})`, `bindTimer(timer, achievements)`; `ctx.services.notifier`. **`APP_USER_MODEL_ID='com.deepfocus.app'` — Т08 берёт тот же appId.**
- `ctx.services.tray: TrayManager{create, refresh(snap), destroy}` (значок рисуется кодом — Т08 может заменить на файл из `resources/`); `ctx.services.lifecycle: {requestQuit(), isQuitting(), attachMainWindow(win)}`; `HIDDEN_ARG='--hidden'` (запуск свёрнутым).
- `app.quit(): Promise<boolean>`, `app.dataPath()`; `settings.deleteAllData(confirmWord)` → `{ok:true} | {ok:false, errorKey}`; `settings/dataReset`: `requestDeleteAllData`, `deleteAllDataIfRequested(userData, dbPath)`, `isSafeUserDataDir(dir, home)`; `DEEPFOCUS_NO_RELAUNCH` — только e2e.
- Автозапуск (`setLoginItemSettings`) включается только в установленном приложении — Т08 проверяет на собранном.

### Т08 — поставка (построено)

- `UpdateService({source:{owner,repo}, isPackaged, createUpdater, log?})`: `checkNow()/status()/installOnQuit()`; `isSourceConfigured(source)`; `UPDATE_OWNER/UPDATE_REPO` в `src/main/updater/source.ts` должны совпадать с `publish` в `electron-builder.yml` (тест). Карточка обновлений — `Settings/UpdatesCard.tsx` в General.
- `npm run dist` = electron-vite build + `electron-builder --win --publish never` → `release/Deep Focus Setup <версия>.exe` (NSIS per-user, без UAC; `npmRebuild: false` — нет Visual Studio, better-sqlite3 из prebuild; без подписи). `build/installer.nsh` — вызов `--cleanup` при удалении. Иконки — `build/make-icons.mjs` → `resources/`.
- e2e установленной сборки — `DF_INSTALLED_EXE=<путь> npx playwright test tests/e2e/acceptance.spec.ts`.
