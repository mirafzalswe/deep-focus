import type { Language } from '../types';
import { en } from './en';
import { ru, type Messages } from './ru';

export type { Messages };

export const dictionaries: Record<Language, Messages> = { ru, en };

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

/** Любой ключ словаря в виде 'домен.ключ'. Несуществующий ключ — ошибка типов. */
export type MessageKey = Paths<Messages>;

export type TranslateParams = Record<string, string | number>;

function lookup(dict: Messages, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Текст по ключу; неизвестный ключ (например, пришедший строкой из main) возвращается как есть. */
export function translate(lang: Language, key: MessageKey, params?: TranslateParams): string {
  const text = lookup(dictionaries[lang], key) ?? lookup(dictionaries.ru, key) ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** Для ключей, пришедших строкой во время выполнения (reasonKey и т.п.). */
export function translateDynamic(lang: Language, key: string, params?: TranslateParams): string {
  return translate(lang, key as MessageKey, params);
}
