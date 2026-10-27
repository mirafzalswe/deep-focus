// Изолированная инициализация модулей main: сбой одного → статус 'error' + запись в журнал,
// остальные продолжают запускаться (§12.2, R148).
import type { ModuleName, ModuleStatus } from '../shared/types';
import type { Logger } from './logger';

export interface ModuleDef<Ctx> {
  name: ModuleName;
  init(ctx: Ctx): void | Promise<void>;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function initModule<Ctx>(def: ModuleDef<Ctx>, ctx: Ctx, logger: Logger): Promise<ModuleStatus> {
  try {
    await def.init(ctx);
    return { name: def.name, state: 'ok', error: null };
  } catch (err) {
    logger.error(def.name, 'module init failed', err);
    return { name: def.name, state: 'error', error: message(err) };
  }
}

/** Последовательно инициализирует модули в заданном порядке; никогда не бросает. */
export async function initModules<Ctx>(defs: ModuleDef<Ctx>[], ctx: Ctx, logger: Logger): Promise<ModuleStatus[]> {
  const statuses: ModuleStatus[] = [];
  for (const def of defs) statuses.push(await initModule(def, ctx, logger));
  return statuses;
}
