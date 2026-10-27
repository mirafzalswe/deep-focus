import { describe, expect, it } from 'vitest';
import { translate } from '@shared/i18n';
import { formatDuration } from './format';

const ru = (key: Parameters<typeof translate>[1]) => translate('ru', key);

describe('formatDuration', () => {
  it.each([
    [0, '0 мин'],
    [25 * 60_000, '25 мин'],
    [60 * 60_000, '1 ч'],
    [90 * 60_000, '1 ч 30 мин'],
    [20_000, '20 с'],
  ])('%i мс → %s', (ms, expected) => {
    expect(formatDuration(ms, ru)).toBe(expected);
  });
});
