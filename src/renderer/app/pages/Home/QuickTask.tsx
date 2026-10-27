// Быстрый ввод задачи одной строкой (§6.6): Enter создаёт задачу и, если таймер свободен, начинает Focus с ней.
import { useState, type KeyboardEvent } from 'react';
import { useT } from '../../../shared/settings';
import { useTimerSnapshot } from '../Timer/useTimer';

export function QuickTask() {
  const t = useT();
  const snap = useTimerSnapshot();
  const [title, setTitle] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !title.trim()) return;
    const created = await window.deepFocus.tasks.create({ title: title.trim() });
    setTitle('');
    if (snap?.status === 'idle') {
      setNotice(null);
      await window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro', kind: 'focus', taskId: created.id });
    } else {
      setNotice(t('tasks.quick.created', { title: created.title }));
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl">
      <input
        aria-label={t('tasks.quick.label')}
        placeholder={t('tasks.quick.placeholder')}
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => void submit(e)}
        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
        data-quick-task
      />
      {notice && (
        <p role="status" className="mt-1 text-xs text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
