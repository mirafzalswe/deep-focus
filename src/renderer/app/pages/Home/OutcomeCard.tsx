// Карточка результата после Focus-сессии с задачей (§6.4): не модальная, необязательная.
import { useEffect, useState } from 'react';
import type { OutcomePrompt, SessionOutcome } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button } from '../../../shared/ui';

const CHOICES: SessionOutcome[] = ['done', 'partial', 'later', 'cancelled'];

export function OutcomeCard() {
  const t = useT();
  const [prompt, setPrompt] = useState<OutcomePrompt | null>(null);

  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.tasks.onOutcomeChanged((next) => setPrompt(next));
    void window.deepFocus.tasks.pendingOutcome().then((p) => {
      if (alive) setPrompt((cur) => cur ?? p);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!prompt) return null;
  return (
    <section
      aria-label={t('tasks.outcome.prompt', { title: prompt.taskTitle })}
      className="mx-auto w-full max-w-xl rounded-xl border border-line bg-surface p-4"
      data-outcome-card
    >
      <p className="text-sm text-fg">{t('tasks.outcome.prompt', { title: prompt.taskTitle })}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {CHOICES.map((choice) => (
          <Button
            key={choice}
            variant={choice === 'done' ? 'primary' : 'secondary'}
            data-outcome={choice}
            onClick={() => void window.deepFocus.tasks.setOutcome(prompt.sessionId, choice)}
          >
            {t(`tasks.outcome.${choice}`)}
          </Button>
        ))}
        <Button variant="ghost" data-outcome="dismiss" onClick={() => void window.deepFocus.tasks.dismissOutcome()}>
          {t('tasks.outcome.dismiss')}
        </Button>
      </div>
    </section>
  );
}
