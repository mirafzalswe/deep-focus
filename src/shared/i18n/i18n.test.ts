import { describe, expect, it } from 'vitest';
import { dictionaries, translate } from './index';

function keysOf(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [prefix + k] : keysOf(v as object, `${prefix}${k}.`),
  );
}

describe('i18n', () => {
  it('ru и en содержат одинаковый набор ключей', () => {
    expect(keysOf(dictionaries.en).sort()).toEqual(keysOf(dictionaries.ru).sort());
  });

  it('переводит ключ на выбранный язык', () => {
    expect(translate('ru', 'nav.settings')).toBe('Настройки');
    expect(translate('en', 'nav.settings')).toBe('Settings');
    expect(translate('en', 'sounds.lib.brownNoise')).toBe('Brown noise');
  });

  it('подставляет параметры {name}', () => {
    expect(translate('en', 'settings.invalidValue', { field: 'widget.opacity' })).toBe('Invalid value: widget.opacity');
  });

  it('отсутствующий ключ — ошибка типов', () => {
    // @ts-expect-error — такого ключа нет в словаре
    expect(translate('en', 'nav.nope')).toBe('nav.nope');
  });
});
