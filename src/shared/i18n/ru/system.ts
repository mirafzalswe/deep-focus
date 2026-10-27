// Горячие клавиши, уведомления, трей, жизненный цикл, сводка Home (Т07)
export const system = {
  moduleError: 'Модуль «{name}» не запустился — остальное работает. Подробности в журнале.',

  hotkeys: {
    title: 'Горячие клавиши',
    hint: 'Работают во всех программах. Нажмите на поле, затем сочетание; Esc — отмена.',
    action: {
      startPause: 'Старт / пауза',
      toggleWidget: 'Показать / скрыть таймер',
      toggleClickThrough: 'Интерактивность виджета',
      endSession: 'Завершить сессию',
      toggleSound: 'Звук вкл / выкл',
    },
    recording: 'Нажмите сочетание…',
    off: 'Отключено',
    clear: 'Отключить',
    reset: 'По умолчанию',
    saved: 'Сочетание сохранено',
    notRegistered: 'Не работает: {reason}',
    reason: {
      invalid: 'Такое сочетание нельзя назначить',
      system: 'Это системное сочетание Windows',
      needsModifier: 'Нужны хотя бы два модификатора: Ctrl, Alt или Shift',
      duplicate: 'Это сочетание уже назначено другому действию',
      taken: 'Сочетание занято другой программой — прежнее осталось рабочим',
    },
  },

  notify: {
    sessionStart: { title: 'Фокус начался', body: '{minutes} мин. Удачной работы.', bodyOpen: 'Без ограничения по времени.' },
    focusEnd: { title: 'Рабочий интервал завершён', body: 'Хорошая работа. Можно отдохнуть.' },
    breakStart: { title: 'Перерыв', body: '{minutes} мин отдыха.', bodyOpen: 'Отдохните немного.' },
    breakEnd: { title: 'Перерыв окончен', body: 'Пора возвращаться к работе.' },
    dailyGoal: { title: 'Дневная цель достигнута', body: '{minutes} мин фокуса сегодня.' },
  },

  tray: {
    tooltipIdle: 'Deep Focus',
    tooltipLeft: 'Deep Focus — {kind}: осталось {time}',
    tooltipElapsed: 'Deep Focus — {kind}: {time}',
    tooltipPaused: 'Deep Focus — {kind}, пауза: {time}',
    tooltipAwaiting: 'Deep Focus — интервал завершён',
    kind: { focus: 'фокус', shortBreak: 'перерыв', longBreak: 'длинный перерыв' },
    open: 'Открыть Deep Focus',
    start: 'Старт',
    pause: 'Пауза',
    resume: 'Продолжить',
    showTimer: 'Показать таймер',
    interactive: 'Интерактивный виджет',
    alwaysOnTop: 'Поверх всех окон',
    quit: 'Выход',
  },

  quit: {
    message: 'Идёт сессия. Что сделать с ней при выходе?',
    detail:
      'Блокировка сайтов снимется при выходе в любом случае. Если продолжить, таймер продолжит сессию при следующем запуске Deep Focus, и блокировка включится снова.',
    stop: 'Остановить сессию',
    keep: 'Продолжить при следующем запуске',
    remember: 'Запомнить выбор',
  },

  home: {
    sound: 'Звук',
    soundPreset: 'Звуковой профиль',
    soundPlaying: 'Играет',
    soundSilent: 'Тишина',
    play: 'Включить',
    stop: 'Выключить',
    blocker: 'Блокировка сайтов',
    blockerDetails: 'Подробнее',
    today: 'Сегодня',
    deepWork: 'Deep Work',
    sessions: 'Завершено сессий',
  },
};
