import { describe, expect, it } from 'vitest';
import { v } from './validate';

describe('v.object', () => {
  const isPoint = v.object({ x: v.int(), y: v.int() });

  it('пропускает ровно поля схемы', () => {
    expect(isPoint({ x: 1, y: 2 })).toBe(true);
    expect(isPoint({ x: 1, y: 2, z: 3 })).toBe(false);
  });

  it('унаследованные имена (__proto__, constructor, toString, prototype) — не поля схемы', () => {
    for (const key of ['__proto__', 'constructor', 'toString', 'prototype', 'hasOwnProperty']) {
      const value = JSON.parse(`{"x":1,"y":2,"${key}":{"polluted":true}}`) as unknown;
      expect(isPoint(value), key).toBe(false);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
