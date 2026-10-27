// Источник обновлений: GitHub Releases. Владелец и репозиторий — заглушки, пока пользователь их не впишет.
// Те же значения должны стоять в electron-builder.yml (publish) — это проверяет UpdateService.test.ts.
export const UPDATE_OWNER = '[GITHUB_OWNER]';
export const UPDATE_REPO = '[GITHUB_REPO]';

export interface UpdateSource {
  owner: string;
  repo: string;
}

const VALID_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/;

/** Источник настроен, если оба поля — настоящие имена GitHub, а не заглушка в квадратных скобках. */
export function isSourceConfigured(source: UpdateSource): boolean {
  return VALID_NAME.test(source.owner) && VALID_NAME.test(source.repo);
}
