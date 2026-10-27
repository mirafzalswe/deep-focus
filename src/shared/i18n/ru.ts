// Русский словарь — эталон структуры. Домены — в ru/<domain>.ts.
import { analytics } from './ru/analytics';
import { blocker } from './ru/blocker';
import { common } from './ru/common';
import { home } from './ru/home';
import { nav } from './ru/nav';
import { settings } from './ru/settings';
import { sounds } from './ru/sounds';
import { system } from './ru/system';
import { tasks } from './ru/tasks';
import { timer } from './ru/timer';
import { updates } from './ru/updates';
import { widget } from './ru/widget';

export const ru = { common, nav, home, timer, widget, blocker, sounds, tasks, analytics, settings, system, updates };

type DeepStrings<T> = { [K in keyof T]: T[K] extends string ? string : DeepStrings<T[K]> };
/** Структура словаря: en обязан повторить её целиком — лишний или пропущенный ключ = ошибка типов. */
export type Messages = DeepStrings<typeof ru>;
