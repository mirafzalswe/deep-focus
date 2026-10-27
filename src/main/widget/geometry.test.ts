import { describe, expect, it } from 'vitest';
import { anchorBounds, clampSize, fitBoundsToDisplays, MIN_SIZE, type DisplayInfo } from './geometry';

// Рабочие области (без панели задач 40 px): основной 1920×1080, правый 2560×1440, верхний 1920×1080.
const primary: DisplayInfo = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const right: DisplayInfo = { id: 2, primary: false, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
const top: DisplayInfo = { id: 3, primary: false, workArea: { x: 0, y: -1080, width: 1920, height: 1040 } };

const box = (x: number, y: number, displayId: number | null = null, width = 240, height = 100) => ({
  x,
  y,
  width,
  height,
  displayId,
});

describe('fitBoundsToDisplays', () => {
  it('виджет целиком на экране — позиция и размер не меняются', () => {
    expect(fitBoundsToDisplays(box(100, 200, 1), [primary, right], 'primary')).toEqual(box(100, 200, 1));
    expect(fitBoundsToDisplays(box(3000, 500, 2), [primary, right], 'primary')).toEqual(box(3000, 500, 2));
  });

  it('частичный выход за правый и нижний край — возвращается внутрь того же экрана', () => {
    // 1800 + 240 > 1920 → x = 1920 − 240 = 1680; 1000 + 100 > 1040 → y = 940
    expect(fitBoundsToDisplays(box(1800, 1000, 1), [primary], 'primary')).toEqual(box(1680, 940, 1));
    // выход за левый и верхний край
    expect(fitBoundsToDisplays(box(-50, -30, 1), [primary], 'primary')).toEqual(box(0, 0, 1));
  });

  it('отключили правый монитор, политика primary — виджет на основном экране', () => {
    const fitted = fitBoundsToDisplays(box(3000, 500, 2), [primary], 'primary');
    expect(fitted).toEqual(box(1680, 500, 1));
  });

  it('отключили монитор, политика nearest — ближайший из оставшихся, а не основной', () => {
    // Был монитор справа-сверху (x 1920.., y −1080..); остались основной и верхний.
    // Центр виджета (3620, −950) ближе к верхнему экрану (dy = 0), чем к основному.
    const lost = box(3500, -1000, 4);
    expect(fitBoundsToDisplays(lost, [primary, top], 'nearest')).toEqual(box(1680, -1000, 3));
    expect(fitBoundsToDisplays(lost, [primary, top], 'primary')).toEqual(box(1680, 0, 1));
  });

  it('смена разрешения: экран стал меньше, виджет вне новой области — прижимается к краю своего экрана', () => {
    const shrunk: DisplayInfo = { id: 2, primary: false, workArea: { x: 1920, y: 0, width: 1280, height: 680 } };
    // x: 1920 + 1280 − 240 = 2960; y: 680 − 100 = 580
    expect(fitBoundsToDisplays(box(4000, 1200, 2), [primary, shrunk], 'primary')).toEqual(box(2960, 580, 2));
  });

  it('виджет больше рабочей области — уменьшается до неё', () => {
    const small: DisplayInfo = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 800, height: 560 } };
    expect(fitBoundsToDisplays(box(10, 10, 1, 1000, 700), [small], 'primary')).toEqual(box(0, 0, 1, 800, 560));
  });

  it('displayId неизвестен, но виджет в основном на другом экране — остаётся там', () => {
    // 2000..2240 целиком на правом экране, id сменился после перезагрузки
    expect(fitBoundsToDisplays(box(2000, 300, 99), [primary, right], 'primary')).toEqual(box(2000, 300, 2));
  });

  it('без экранов — без изменений', () => {
    expect(fitBoundsToDisplays(box(5, 5, 1), [], 'nearest')).toEqual(box(5, 5, 1));
  });
});

describe('anchorBounds', () => {
  const size = { width: 200, height: 80 };
  it('четыре угла рабочей области с отступом marginPx', () => {
    expect(anchorBounds(size, right, 'topLeft', 24)).toEqual({ x: 1944, y: 24, width: 200, height: 80, displayId: 2 });
    expect(anchorBounds(size, right, 'topRight', 24)).toEqual({ x: 4256, y: 24, width: 200, height: 80, displayId: 2 });
    expect(anchorBounds(size, right, 'bottomLeft', 24)).toEqual({ x: 1944, y: 1296, width: 200, height: 80, displayId: 2 });
    expect(anchorBounds(size, top, 'bottomRight', 0)).toEqual({ x: 1720, y: -120, width: 200, height: 80, displayId: 3 });
  });

  it('отступ больше свободного места — виджет не выходит за экран', () => {
    const tiny: DisplayInfo = { id: 1, primary: true, workArea: { x: 0, y: 0, width: 300, height: 120 } };
    expect(anchorBounds(size, tiny, 'bottomRight', 500)).toEqual({ x: 0, y: 0, width: 200, height: 80, displayId: 1 });
  });
});

describe('clampSize', () => {
  it('не меньше минимального размера режима', () => {
    expect(clampSize({ width: 10, height: 10 }, 'compact')).toEqual(MIN_SIZE.compact);
    expect(clampSize({ width: 10, height: 500 }, 'expanded')).toEqual({ width: MIN_SIZE.expanded.width, height: 500 });
    expect(MIN_SIZE.compact.width).toBeLessThan(MIN_SIZE.standard.width);
    expect(MIN_SIZE.standard.height).toBeLessThan(MIN_SIZE.expanded.height);
  });
});
