// Настройки → Плавающий виджет (§3): вид, положение и размер, поведение, подсказка про полноэкранный режим.
import { useEffect, useState } from 'react';
import { WIDGET_DEFAULT_SIZE, WIDGET_MIN_SIZE } from '@shared/defaults';
import type { Anchor, AppSettings, WidgetDisplayMode } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, cx, Field, Segmented } from '../../../shared/ui';

type WidgetSettings = AppSettings['widget'];

export default function WidgetTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const w = settings.widget;
  const hotkeys = settings.hotkeys;
  const setWidget = (p: Partial<WidgetSettings>) => void patch({ widget: p });
  const visible = useWidgetVisible();
  const min = WIDGET_MIN_SIZE[w.displayMode];
  const size = w.bounds ?? { ...WIDGET_DEFAULT_SIZE[w.displayMode], x: 0, y: 0, displayId: null };

  const setSize = (dim: 'width' | 'height', value: number) => {
    if (!w.bounds) return;
    setWidget({ bounds: { ...w.bounds, [dim]: Math.max(min[dim], value) } });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('widget.settings.behavior')}>
        <Field
          label={t('widget.settings.visibility')}
          hint={t('widget.settings.visibilityHint', { hotkey: hotkeys.toggleWidget || '—' })}
        >
          <div className="flex items-center gap-3">
            <span data-testid="widget-visibility" className="text-sm text-muted">
              {t(visible ? 'widget.settings.shown' : 'widget.settings.hidden')}
            </span>
            <Button onClick={() => void (visible ? window.deepFocus.widget.hide() : window.deepFocus.widget.show())}>
              {t(visible ? 'widget.settings.hide' : 'widget.settings.show')}
            </Button>
          </div>
        </Field>
        <Field label={t('widget.settings.showOnSessionStart')} hint={t('widget.settings.showOnSessionStartHint')}>
          <Switch
            label={t('widget.settings.showOnSessionStart')}
            checked={w.showOnSessionStart}
            onChange={(showOnSessionStart) => setWidget({ showOnSessionStart })}
          />
        </Field>
        <Field label={t('widget.settings.alwaysOnTop')} hint={t('widget.settings.alwaysOnTopHint')}>
          <Switch
            label={t('widget.settings.alwaysOnTop')}
            checked={w.alwaysOnTop}
            onChange={(on) => void window.deepFocus.widget.setAlwaysOnTop(on)}
          />
        </Field>
        <Field
          label={t('widget.settings.clickThrough')}
          hint={t('widget.settings.clickThroughHint', { hotkey: hotkeys.toggleClickThrough || '—' })}
        >
          <Switch
            label={t('widget.settings.clickThrough')}
            checked={w.clickThrough}
            onChange={(on) => void window.deepFocus.widget.setClickThrough(on)}
          />
        </Field>
      </Card>

      <Card title={t('widget.settings.appearance')}>
        <Field label={t('widget.settings.displayMode')} hint={t('widget.settings.displayModeHint')}>
          <Segmented<WidgetDisplayMode>
            label={t('widget.settings.displayMode')}
            value={w.displayMode}
            onChange={(displayMode) => setWidget({ displayMode })}
            options={[
              { value: 'compact', label: t('widget.menu.compact') },
              { value: 'standard', label: t('widget.menu.standard') },
              { value: 'expanded', label: t('widget.menu.expanded') },
            ]}
          />
        </Field>
        <Field label={t('widget.settings.opacity')} hint={t('widget.settings.opacityHint')}>
          <Slider
            label={t('widget.settings.opacity')}
            min={40}
            max={95}
            value={Math.round(w.opacity * 100)}
            onChange={(v) => setWidget({ opacity: v / 100 })}
          />
        </Field>
        <Field label={t('widget.settings.backgroundOpacity')} hint={t('widget.settings.backgroundOpacityHint')}>
          <Slider
            label={t('widget.settings.backgroundOpacity')}
            min={0}
            max={100}
            value={Math.round(w.backgroundOpacity * 100)}
            onChange={(v) => setWidget({ backgroundOpacity: v / 100 })}
          />
        </Field>
      </Card>

      <Card title={t('widget.settings.position')}>
        <Field label={t('widget.settings.corner')} hint={t('widget.settings.cornerHint')}>
          <Segmented<Anchor>
            label={t('widget.settings.corner')}
            value={w.anchor}
            onChange={(anchor) => void window.deepFocus.widget.snapTo(anchor)}
            options={[
              { value: 'free', label: t('widget.settings.cornerFree') },
              { value: 'topLeft', label: '↖' },
              { value: 'topRight', label: '↗' },
              { value: 'bottomLeft', label: '↙' },
              { value: 'bottomRight', label: '↘' },
            ]}
          />
        </Field>
        <Field label={t('widget.settings.margin')}>
          <NumberInput
            label={t('widget.settings.margin')}
            name="marginPx"
            min={0}
            max={500}
            value={w.marginPx}
            onCommit={(marginPx) => setWidget({ marginPx })}
          />
        </Field>
        <Field label={t('widget.settings.width')} hint={t('widget.settings.sizeHint', { width: min.width, height: min.height })}>
          <div className="flex items-center gap-2">
            <NumberInput
              label={t('widget.settings.width')}
              name="width"
              min={min.width}
              max={4000}
              value={size.width}
              onCommit={(v) => setSize('width', v)}
            />
            <span className="text-faint">×</span>
            <NumberInput
              label={t('widget.settings.height')}
              name="height"
              min={min.height}
              max={4000}
              value={size.height}
              onCommit={(v) => setSize('height', v)}
            />
          </div>
        </Field>
        <Field label={t('widget.settings.onDisplayRemoved')}>
          <Segmented<WidgetSettings['onDisplayRemoved']>
            label={t('widget.settings.onDisplayRemoved')}
            value={w.onDisplayRemoved}
            onChange={(onDisplayRemoved) => setWidget({ onDisplayRemoved })}
            options={[
              { value: 'primary', label: t('widget.settings.displayPrimary') },
              { value: 'nearest', label: t('widget.settings.displayNearest') },
            ]}
          />
        </Field>
      </Card>

      <p className="px-1 text-xs text-muted">{t('widget.settings.fullscreenNote')}</p>
    </div>
  );
}

function useWidgetVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.widget.onVisibility(setVisible);
    void window.deepFocus.widget.isVisible().then((v) => alive && setVisible(v));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return visible;
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 items-center rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line bg-surface-2',
      )}
    >
      <span
        className={cx(
          'inline-block size-3.5 rounded-full transition-transform',
          checked ? 'translate-x-[18px] bg-accent-fg' : 'translate-x-[2px] bg-muted',
        )}
      />
    </button>
  );
}

function Slider(props: { label: string; min: number; max: number; value: number; onChange(v: number): void }) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-44 accent-[var(--df-accent)]"
      />
      <span className="w-10 text-right font-mono text-sm text-muted tabular-nums">{props.value}%</span>
    </div>
  );
}

/** Поле числа: применяется по Enter или потере фокуса, вне пределов — прижимается к ним. */
function NumberInput(props: {
  label: string;
  name: string;
  min: number;
  max: number;
  value: number;
  onCommit(v: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Math.round(Number(draft));
    setDraft(null);
    if (Number.isFinite(n) && n !== props.value) props.onCommit(Math.min(props.max, Math.max(props.min, n)));
  };
  return (
    <input
      type="number"
      name={props.name}
      aria-label={props.label}
      min={props.min}
      max={props.max}
      value={draft ?? String(props.value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-20 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-right font-mono text-sm text-fg tabular-nums"
    />
  );
}
