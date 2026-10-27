// Геометрия виджета — чистые функции без Electron (§3.6, §3.7, §3.10).
import { WIDGET_DEFAULT_SIZE, WIDGET_MIN_SIZE } from '../../shared/defaults';
import type { Anchor, WidgetBounds, WidgetDisplayMode } from '../../shared/types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Экран так, как его видит виджет: id и рабочая область (без панели задач). */
export interface DisplayInfo {
  id: number;
  primary: boolean;
  workArea: Rect;
}

export interface WidgetSize {
  width: number;
  height: number;
}

export type DisplayPolicy = 'primary' | 'nearest';
export type Corner = Exclude<Anchor, 'free'>;

/** Минимальный размер окна на режим: меньше — цифры перестают помещаться. */
export const MIN_SIZE: Record<WidgetDisplayMode, WidgetSize> = WIDGET_MIN_SIZE;

/** Размер при первом показе и при смене режима. */
export const DEFAULT_SIZE: Record<WidgetDisplayMode, WidgetSize> = WIDGET_DEFAULT_SIZE;

export function clampSize(size: WidgetSize, mode: WidgetDisplayMode): WidgetSize {
  const min = MIN_SIZE[mode];
  return { width: Math.max(min.width, Math.round(size.width)), height: Math.max(min.height, Math.round(size.height)) };
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Расстояние от точки до прямоугольника (0 — точка внутри). */
function distanceToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x - px, 0, px - (r.x + r.width));
  const dy = Math.max(r.y - py, 0, py - (r.y + r.height));
  return Math.hypot(dx, dy);
}

/** Окно целиком внутри рабочей области экрана: размер урезается до неё, позиция прижимается к краю. */
export function clampIntoDisplay(bounds: Rect, display: DisplayInfo): WidgetBounds {
  const wa = display.workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  return {
    x: clamp(bounds.x, wa.x, wa.x + wa.width - width),
    y: clamp(bounds.y, wa.y, wa.y + wa.height - height),
    width,
    height,
    displayId: display.id,
  };
}

function byPolicy(bounds: Rect, displays: DisplayInfo[], policy: DisplayPolicy): DisplayInfo {
  if (policy === 'primary') return displays.find((d) => d.primary) ?? displays[0]!;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return displays.reduce((best, d) =>
    distanceToRect(cx, cy, d.workArea) < distanceToRect(cx, cy, best.workArea) ? d : best,
  );
}

/** Экран, на котором должен оказаться виджет с такими границами. */
export function targetDisplay(bounds: WidgetBounds, displays: DisplayInfo[], policy: DisplayPolicy): DisplayInfo | null {
  if (displays.length === 0) return null;
  const area = bounds.width * bounds.height;
  let best = displays[0]!;
  let bestArea = -1;
  for (const d of displays) {
    const a = intersectionArea(bounds, d.workArea);
    if (a > bestArea) {
      best = d;
      bestArea = a;
    }
  }
  // В основном виден на каком-то экране — остаётся на нём (в том числе если id экрана сменился)
  if (bestArea > 0 && bestArea * 2 >= area) return best;
  // Свой экран на месте (смена разрешения, частичный выход за край) — возвращаем на него
  const own = displays.find((d) => d.id === bounds.displayId);
  if (own) return own;
  if (bestArea > 0) return best;
  // Экрана, где был виджет, больше нет
  return byPolicy(bounds, displays, policy);
}

/**
 * Возвращает виджет на доступный экран: отключённый монитор, частичный выход за край, смена разрешения.
 * policy — куда переносить, если экрана виджета больше нет: основной или ближайший.
 */
export function fitBoundsToDisplays(bounds: WidgetBounds, displays: DisplayInfo[], policy: DisplayPolicy): WidgetBounds {
  const target = targetDisplay(bounds, displays, policy);
  return target ? clampIntoDisplay(bounds, target) : { ...bounds };
}

/** Позиция в углу рабочей области экрана с отступом marginPx от краёв. */
export function anchorBounds(size: WidgetSize, display: DisplayInfo, anchor: Corner, marginPx: number): WidgetBounds {
  const wa = display.workArea;
  const left = anchor === 'topLeft' || anchor === 'bottomLeft';
  const upper = anchor === 'topLeft' || anchor === 'topRight';
  const x = left ? wa.x + marginPx : wa.x + wa.width - size.width - marginPx;
  const y = upper ? wa.y + marginPx : wa.y + wa.height - size.height - marginPx;
  return clampIntoDisplay({ x, y, width: size.width, height: size.height }, display);
}

/**
 * Итоговые границы виджета по настройкам: сохранённые (подогнанные под экраны) или угол по умолчанию.
 * Привязка к углу (anchor ≠ 'free') пересчитывается на экране, где стоит виджет.
 */
export function resolveBounds(
  widget: { bounds: WidgetBounds | null; anchor: Anchor; marginPx: number; displayMode: WidgetDisplayMode; onDisplayRemoved: DisplayPolicy },
  displays: DisplayInfo[],
): WidgetBounds | null {
  if (displays.length === 0) return widget.bounds;
  const corner: Corner = widget.anchor === 'free' ? 'topRight' : widget.anchor;
  if (!widget.bounds) {
    const main = displays.find((d) => d.primary) ?? displays[0]!;
    return anchorBounds(DEFAULT_SIZE[widget.displayMode], main, corner, widget.marginPx);
  }
  const size = clampSize(widget.bounds, widget.displayMode);
  const fitted = fitBoundsToDisplays({ ...widget.bounds, ...size }, displays, widget.onDisplayRemoved);
  if (widget.anchor === 'free') return fitted;
  const display = displays.find((d) => d.id === fitted.displayId) ?? displays[0]!;
  return anchorBounds(fitted, display, corner, widget.marginPx);
}
