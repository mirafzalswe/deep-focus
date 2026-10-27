import type { Messages } from '../ru';

export const system: Messages['system'] = {
  moduleError: 'Module “{name}” failed to start — everything else works. See the log for details.',

  hotkeys: {
    title: 'Hotkeys',
    hint: 'Work in every program. Click a field, then press the shortcut; Esc cancels.',
    action: {
      startPause: 'Start / pause',
      toggleWidget: 'Show / hide timer',
      toggleClickThrough: 'Widget interactivity',
      endSession: 'End session',
      toggleSound: 'Sound on / off',
    },
    recording: 'Press a shortcut…',
    off: 'Off',
    clear: 'Turn off',
    reset: 'Default',
    saved: 'Shortcut saved',
    notRegistered: 'Not working: {reason}',
    reason: {
      invalid: 'This shortcut cannot be assigned',
      system: 'This is a Windows system shortcut',
      needsModifier: 'Use at least two modifiers: Ctrl, Alt or Shift',
      duplicate: 'This shortcut is already used by another action',
      taken: 'Another program uses this shortcut — the previous one still works',
    },
  },

  notify: {
    sessionStart: { title: 'Focus started', body: '{minutes} min. Have a good session.', bodyOpen: 'No time limit.' },
    focusEnd: { title: 'Focus interval finished', body: 'Good work. Time for a break.' },
    breakStart: { title: 'Break', body: '{minutes} min to rest.', bodyOpen: 'Take a short rest.' },
    breakEnd: { title: 'Break is over', body: 'Time to get back to work.' },
    dailyGoal: { title: 'Daily goal reached', body: '{minutes} min of focus today.' },
  },

  tray: {
    tooltipIdle: 'Deep Focus',
    tooltipLeft: 'Deep Focus — {kind}: {time} left',
    tooltipElapsed: 'Deep Focus — {kind}: {time}',
    tooltipPaused: 'Deep Focus — {kind}, paused: {time}',
    tooltipAwaiting: 'Deep Focus — interval finished',
    kind: { focus: 'focus', shortBreak: 'break', longBreak: 'long break' },
    open: 'Open Deep Focus',
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    showTimer: 'Show timer',
    interactive: 'Interactive widget',
    alwaysOnTop: 'Always on top',
    quit: 'Quit',
  },

  quit: {
    message: 'A session is running. What should happen to it when you quit?',
    detail:
      'Website blocking is removed on quit either way. If you continue, the timer resumes the session the next time Deep Focus starts, and blocking turns back on.',
    stop: 'Stop the session',
    keep: 'Continue on next launch',
    remember: 'Remember my choice',
  },

  home: {
    sound: 'Sound',
    soundPreset: 'Sound profile',
    soundPlaying: 'Playing',
    soundSilent: 'Silence',
    play: 'Play',
    stop: 'Stop',
    blocker: 'Website blocking',
    blockerDetails: 'Details',
    today: 'Today',
    deepWork: 'Deep Work',
    sessions: 'Sessions completed',
  },
};
