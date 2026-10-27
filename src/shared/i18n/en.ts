// Английский словарь. Структура обязана совпадать с ru (тип Messages).
import type { Messages } from './ru';
import { analytics } from './en/analytics';
import { blocker } from './en/blocker';
import { common } from './en/common';
import { home } from './en/home';
import { nav } from './en/nav';
import { settings } from './en/settings';
import { sounds } from './en/sounds';
import { system } from './en/system';
import { tasks } from './en/tasks';
import { timer } from './en/timer';
import { updates } from './en/updates';
import { widget } from './en/widget';

export const en: Messages = { common, nav, home, timer, widget, blocker, sounds, tasks, analytics, settings, system, updates };
