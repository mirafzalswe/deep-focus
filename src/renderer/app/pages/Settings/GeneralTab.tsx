// Настройки → Общие (§11.1, §11.3): тема, язык, автозапуск, трей, выход с идущей сессией, горячие клавиши,
// уведомления (шесть событий), цели, данные.
import { useState } from 'react';
import type { AppSettings, Language, NotifyEvent, Theme } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Card, Field, Segmented } from '../../../shared/ui';
import { Toggle } from '../Timer/controls';
import { DataCard } from './DataCard';
import { HotkeysCard } from './HotkeysCard';

type QuitBehavior = AppSettings['general']['quitBehavior'];
type NumericGoal = 'dailyMinutes' | 'dailySessions' | 'weeklyMinutes';

const NOTIFY_EVENTS: readonly NotifyEvent[] = ['sessionStart', 'focusEnd', 'breakStart', 'breakEnd', 'dailyGoal', 'blockerError'];
const GOAL_MAX: Record<NumericGoal, number> = { dailyMinutes: 24 * 60, dailySessions: 100, weeklyMinutes: 7 * 24 * 60 };

/** Число цели: сохраняется при уходе с поля, неверное значение подсвечивается и не сохраняется. */
function GoalInput({ goal, label }: { goal: NumericGoal; label: string }) {
  const { settings, patch } = useSettings();
  const saved = settings.goals[goal];
  const [text, setText] = useState(String(saved));
  const [lastSaved, setLastSaved] = useState(saved);
  if (saved !== lastSaved) {
    // значение поменялось извне (резервная копия, другое окно)
    setLastSaved(saved);
    setText(String(saved));
  }
  const n = /^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  const invalid = !(n >= 0 && n <= GOAL_MAX[goal]);
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      aria-invalid={invalid}
      data-goal-input={goal}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (invalid || n === saved) return;
        // Своё значение ждём заранее: запоздавший ответ не должен затирать то, что уже вводится дальше.
        setLastSaved(n);
        void patch({ goals: { [goal]: n } }).catch(() => setText(String(saved)));
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      className={`w-24 rounded-lg border bg-surface-2 px-3 py-1.5 text-right text-sm text-fg focus:outline-none ${
        invalid ? 'border-danger' : 'border-line focus:border-accent'
      }`}
    />
  );
}

export default function GeneralTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const { general, notifications, goals } = settings;

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('settings.appearance')}>
        <Field label={t('settings.theme')}>
          <Segmented<Theme>
            label={t('settings.theme')}
            value={general.theme}
            onChange={(theme) => void patch({ general: { theme } })}
            options={[
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'system', label: t('settings.themeSystem') },
            ]}
          />
        </Field>
        <Field label={t('settings.language')}>
          <Segmented<Language>
            label={t('settings.language')}
            value={general.language}
            onChange={(language) => void patch({ general: { language } })}
            options={[
              { value: 'ru', label: t('settings.languageRu') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
          />
        </Field>
      </Card>

      <Card title={t('settings.startup')}>
        <div data-setting="launchAtLogin" className="py-1.5">
          <Field label={t('settings.launchAtLogin')} hint={t('settings.launchAtLoginHint')}>
            <Toggle
              label={t('settings.launchAtLogin')}
              checked={general.launchAtLogin}
              onChange={(launchAtLogin) => void patch({ general: { launchAtLogin } })}
            />
          </Field>
        </div>
        <div data-setting="closeToTray" className="py-1.5">
          <Field label={t('settings.closeToTray')} hint={t('settings.closeToTrayHint')}>
            <Toggle
              label={t('settings.closeToTray')}
              checked={general.closeToTray}
              onChange={(closeToTray) => void patch({ general: { closeToTray } })}
            />
          </Field>
        </div>
        <div data-setting="quitBehavior" className="py-1.5">
          <Field label={t('settings.quitBehavior')} hint={t('settings.quitBehaviorHint')}>
            <Segmented<QuitBehavior>
              label={t('settings.quitBehavior')}
              value={general.quitBehavior}
              onChange={(quitBehavior) => void patch({ general: { quitBehavior } })}
              options={[
                { value: 'ask', label: t('settings.quitAsk') },
                { value: 'keep', label: t('settings.quitKeep') },
                { value: 'stop', label: t('settings.quitStop') },
              ]}
            />
          </Field>
        </div>
      </Card>

      <HotkeysCard />

      <Card title={t('settings.notifications')}>
        <div data-notify-setting="enabled" className="py-1.5">
          <Field label={t('settings.notificationsEnabled')}>
            <Toggle
              label={t('settings.notificationsEnabled')}
              checked={notifications.enabled}
              onChange={(enabled) => void patch({ notifications: { enabled } })}
            />
          </Field>
        </div>
        <div data-notify-setting="silent" className="py-1.5">
          <Field label={t('settings.notificationsSilent')}>
            <Toggle
              label={t('settings.notificationsSilent')}
              checked={notifications.silent}
              disabled={!notifications.enabled}
              onChange={(silent) => void patch({ notifications: { silent } })}
            />
          </Field>
        </div>
        <div className="mt-2 grid gap-x-8 border-t border-line pt-3 sm:grid-cols-2">
          {NOTIFY_EVENTS.map((event) => (
            <div key={event} data-notify-setting={event} className="py-1.5">
              <Field label={t(`settings.notify.${event}`)}>
                <Toggle
                  label={t(`settings.notify.${event}`)}
                  checked={notifications[event]}
                  disabled={!notifications.enabled}
                  onChange={(on) => void patch({ notifications: { [event]: on } })}
                />
              </Field>
            </div>
          ))}
        </div>
      </Card>

      <Card title={t('settings.goals')}>
        <p className="mb-3 text-sm text-muted">{t('settings.goalsHint')}</p>
        <Field label={t('settings.goalDailyMinutes')}>
          <GoalInput goal="dailyMinutes" label={t('settings.goalDailyMinutes')} />
        </Field>
        <Field label={t('settings.goalDailySessions')}>
          <GoalInput goal="dailySessions" label={t('settings.goalDailySessions')} />
        </Field>
        <Field label={t('settings.goalWeeklyMinutes')}>
          <GoalInput goal="weeklyMinutes" label={t('settings.goalWeeklyMinutes')} />
        </Field>
        <div data-setting="showStreak" className="py-1.5">
          <Field label={t('settings.goalShowStreak')}>
            <Toggle
              label={t('settings.goalShowStreak')}
              checked={goals.showStreak}
              onChange={(showStreak) => void patch({ goals: { showStreak } })}
            />
          </Field>
        </div>
      </Card>

      <DataCard />
    </div>
  );
}
