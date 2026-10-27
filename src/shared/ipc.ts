// Имена IPC-каналов. Формат — `домен:действие`.
// Запросы — ipcRenderer.invoke / ipcMain.handle, рассылки — webContents.send.
// Позже — только добавление каналов своего домена, без переименований.

export const IPC = {
  timer: {
    command: 'timer:command',
    snapshot: 'timer:snapshot',
    presets: 'timer:presets',
    savePreset: 'timer:savePreset',
    deletePreset: 'timer:deletePreset',
    setOutcome: 'timer:setOutcome',
    /** рассылка: TimerSnapshot */
    state: 'timer:state',
  },
  widget: {
    show: 'widget:show',
    hide: 'widget:hide',
    toggle: 'widget:toggle',
    setClickThrough: 'widget:setClickThrough',
    setAlwaysOnTop: 'widget:setAlwaysOnTop',
    snapTo: 'widget:snapTo',
    isVisible: 'widget:isVisible',
    /** окно виджета → main: показать контекстное меню виджета */
    showMenu: 'widget:showMenu',
    /** окно виджета → main: новый размер от уголка ресайза (width, height) */
    resize: 'widget:resize',
    /** рассылка: boolean — виден ли виджет */
    visibilityChanged: 'widget:visibilityChanged',
  },
  blocker: {
    status: 'blocker:status',
    rules: 'blocker:rules',
    saveRule: 'blocker:saveRule',
    deleteRule: 'blocker:deleteRule',
    requestUnlock: 'blocker:requestUnlock',
    confirmUnlock: 'blocker:confirmUnlock',
    recheck: 'blocker:recheck',
    /** экран согласия пройден (§4.8.1): запомнить согласие и включить блокировку. Т04 */
    giveConsent: 'blocker:giveConsent',
    /** рассылка: BlockerStatus */
    statusChanged: 'blocker:statusChanged',
  },
  audio: {
    status: 'audio:status',
    library: 'audio:library',
    play: 'audio:play',
    stop: 'audio:stop',
    setTrack: 'audio:setTrack',
    setMaster: 'audio:setMaster',
    toggleMute: 'audio:toggleMute',
    presets: 'audio:presets',
    savePreset: 'audio:savePreset',
    deletePreset: 'audio:deletePreset',
    addCustomSound: 'audio:addCustomSound',
    /** рассылка: AudioStatus */
    statusChanged: 'audio:statusChanged',
    /** main → скрытое окно audio: команда движку */
    engineCommand: 'audio:engine-command',
    /** скрытое окно audio → main: статус движка */
    engineStatus: 'audio:engine-status',
  },
  tasks: {
    list: 'tasks:list',
    create: 'tasks:create',
    update: 'tasks:update',
    remove: 'tasks:remove',
    projects: 'tasks:projects',
    saveProject: 'tasks:saveProject',
    deleteProject: 'tasks:deleteProject',
    totals: 'tasks:totals',
    pendingOutcome: 'tasks:pendingOutcome',
    setOutcome: 'tasks:setOutcome',
    dismissOutcome: 'tasks:dismissOutcome',
    /** рассылка: OutcomePrompt | null */
    outcomeChanged: 'tasks:outcomeChanged',
  },
  analytics: {
    summary: 'analytics:summary',
    history: 'analytics:history',
    goals: 'analytics:goals',
    achievements: 'analytics:achievements',
    /** рассылка: без данных — «пересчитай» */
    changed: 'analytics:changed',
  },
  settings: {
    get: 'settings:get',
    patch: 'settings:patch',
    exportBackup: 'settings:exportBackup',
    importBackup: 'settings:importBackup',
    openDataFolder: 'settings:openDataFolder',
    deleteAllData: 'settings:deleteAllData',
    /** рассылка: AppSettings */
    changed: 'settings:changed',
  },
  hotkeys: {
    validate: 'hotkeys:validate',
    results: 'hotkeys:results',
  },
  app: {
    version: 'app:version',
    quit: 'app:quit',
    checkUpdates: 'app:checkUpdates',
    updateStatus: 'app:updateStatus',
    logPath: 'app:logPath',
    modules: 'app:modules',
    /** рассылка: { key: string } — i18n-ключ сообщения пользователю (например, база восстановлена) */
    notice: 'app:notice',
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];
export type IpcChannel = Leaves<typeof IPC>;
