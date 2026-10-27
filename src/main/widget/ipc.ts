// ЗАГЛУШКА Т01 → заполняет Т03 (WidgetManager: окно виджета, topmost, click-through, геометрия).
import { IPC } from '../../shared/ipc';
import type { Anchor } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';

const isAnchor = v.oneOf<Anchor>('free', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight');

export function registerWidget(ctx: MainContext): void {
  const todo = (what: string) => () => ctx.logger.info('widget', `${what}: not implemented yet`);
  handle<[]>(IPC.widget.show, [], todo('show'));
  handle<[]>(IPC.widget.hide, [], todo('hide'));
  handle<[]>(IPC.widget.toggle, [], todo('toggle'));
  handle<[boolean]>(IPC.widget.setClickThrough, [v.bool()], todo('setClickThrough'));
  handle<[boolean]>(IPC.widget.setAlwaysOnTop, [v.bool()], todo('setAlwaysOnTop'));
  handle<[Anchor]>(IPC.widget.snapTo, [isAnchor], todo('snapTo'));
}
