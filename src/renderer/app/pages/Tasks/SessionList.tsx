// История сессий: дата, длительность, причина завершения, результат, флаг «восстановлена».
import type { SessionRecord } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { formatDateTime, formatDuration } from '../Analytics/format';

export function SessionList({ sessions, titleOf }: { sessions: SessionRecord[]; titleOf?: (s: SessionRecord) => string | null }) {
  const t = useT();
  const { settings } = useSettings();
  const language = settings.general.language;
  return (
    <ul className="divide-y divide-line text-sm" data-session-list>
      {sessions.map((s) => {
        const title = titleOf?.(s);
        return (
          <li key={s.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2" data-session-row>
            <span className="w-32 shrink-0 text-muted">{formatDateTime(s.startedAt, language)}</span>
            <span className="w-24 shrink-0 tabular-nums text-fg">{formatDuration(s.activeMs, t)}</span>
            {title && <span className="min-w-0 flex-1 truncate text-fg">{title}</span>}
            <span className="text-muted">{t(`tasks.reasons.${s.endReason}`)}</span>
            <span className="text-muted">{s.outcome ? t(`tasks.outcomes.${s.outcome}`) : t('tasks.noOutcome')}</span>
            {s.recovered && <span className="text-faint">{t('tasks.recovered')}</span>}
          </li>
        );
      })}
    </ul>
  );
}
