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
