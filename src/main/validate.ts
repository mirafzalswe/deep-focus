// Проверки аргументов IPC и данных извне (бэкап, база). Без зависимостей от Electron.
// Check — предикат «значение допустимо».

export type Check = (v: unknown) => boolean;

export const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

/** Имена, через которые JSON-объект может добраться до прототипов. */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

/** key — собственное поле схемы shape (не унаследованное и не __proto__/constructor/prototype). */
export const isSchemaKey = (shape: object, key: string): boolean => !UNSAFE_KEYS.has(key) && Object.hasOwn(shape, key);

export const v = {
  any: (): Check => () => true,
  bool: (): Check => (x) => typeof x === 'boolean',
  num:
    (min = -Infinity, max = Infinity, opts: { int?: boolean } = {}): Check =>
    (x) =>
      typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max && (!opts.int || Number.isInteger(x)),
  int: (min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): Check => v.num(min, max, { int: true }),
  str:
    (opts: { min?: number; max?: number; pattern?: RegExp } = {}): Check =>
    (x) =>
      typeof x === 'string' &&
      x.length >= (opts.min ?? 0) &&
      x.length <= (opts.max ?? 10_000) &&
      (!opts.pattern || opts.pattern.test(x)),
  /** Непустой идентификатор разумной длины. */
  id: (): Check => v.str({ min: 1, max: 200 }),
  oneOf:
    <T extends string | number>(...values: readonly T[]): Check =>
    (x) =>
      values.includes(x as T),
  nullable:
    (check: Check): Check =>
    (x) =>
      x === null || check(x),
  optional:
    (check: Check): Check =>
    (x) =>
      x === undefined || check(x),
  array:
    (item: Check, opts: { max?: number } = {}): Check =>
    (x) =>
      Array.isArray(x) && x.length <= (opts.max ?? 10_000) && x.every(item),
  /** Объект ровно с этими полями (лишние — ошибка; отсутствующие проверяются как undefined). */
  object:
    (shape: Record<string, Check>): Check =>
    (x) =>
      isPlainObject(x) &&
      Object.keys(x).every((k) => isSchemaKey(shape, k)) &&
      Object.entries(shape).every(([k, c]) => c(Object.hasOwn(x, k) ? x[k] : undefined)),
};

/** Ошибка валидации аргумента IPC. */
export class ValidationError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid argument: ${field}`);
    this.name = 'ValidationError';
  }
}

export function assertValid(check: Check, value: unknown, field: string): void {
  if (!check(value)) throw new ValidationError(field);
}
