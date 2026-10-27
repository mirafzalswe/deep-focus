# F1 — Правки по ревью ветки

**Требования:** R67, R69, R141, R133, R137, R148, R30, R54, R153
**Зависит от:** —
**Зона:** `src/main/blocker/` · `src/renderer/app/pages/Blocker/` · `src/main/settings/` · `src/main/validate.ts` · `src/main/ipc.ts` · `src/main/windows.ts` · `src/main/index.ts` · `src/main/widget/` · `tests/e2e/shell.spec.ts` · `tests/e2e/blocker.spec.ts`
**Волна:** 6
**Ревью:** да — ремонт ветки
**Модель:** сильная

## Что должно заработать

Закрыты находки финального код-ревью, которые оставлять дороже, чем исправить. Строгий режим нельзя обойти. Возврат прокси никогда не стирает чужие настройки. Импорт бэкапа не может испортить процесс. Чужая страница не получает доступ к API приложения. Сбой БД виден пользователю. Виджет переживает падение и закрытие окна.

## Из брифа, дословно

> «Strict Mode — Во время сессии отключение блокировки требует дополнительного подтверждения или завершения заданного периода.»
> «приложение должно корректно сохранять исходные настройки, изменять только принадлежащие ему правила и восстанавливать их при отключении функции или удалении приложения.»
> «Интеграцию с операционной системой следует реализовывать через контролируемый основной процесс Electron, а не предоставлять renderer-процессу неограниченный доступ к системным возможностям.»
> «Ошибка одной функции не должна приводить к остановке всех остальных.» · «Корректное восстановление после аварийного завершения.»

## Разделы спецификации

§4 (4.7, 4.12, 4.13), §1 (1.2), §12 (12.2, 12.3), §3 (3.12).

## Критерии приёмки

Находки ревью, дословно:

- [ ] src/main/blocker/ipc.ts:180,192 + src/renderer/app/pages/Blocker/RulesCard.tsx:217,224-226 + src/main/settings/ipc.ts:31 — в Strict во время сессии блокировка снимается без ожидания и без фразы: выключить тумблер правила, снять флажок Focus, удалить правило, через settings.patch выставить blocker.enabled=false или level=standard, либо поставить паузу и выключить keepBlockingOnPause. Каким должно быть: пока status.strictLocked, main отклоняет (ошибкой blocker.invalid.strictLocked) изменения, которые убирают действующий домен, и отклоняет blocker.enabled/level/strictUnlockDelaySec и timer.keepBlockingOnPause; те же элементы в RulesCard неактивны; тест в BlockerController.test или e2e (§4.7).
- [ ] src/main/blocker/SystemProxy.ts:107-121 + BlockerController.ts:233-249,292-295 — restore удаляет любой текущий AutoConfigURL и перезаписывает DefaultConnectionSettings старым снимком, даже если AutoConfigURL уже чужой (VPN/пользователь поставил свой PAC во время сессии); engage при существующем снимке перезаписывает чужой AutoConfigURL без проверки isOurPacUrl. Каким должно быть: AutoConfigURL и двоичные настройки трогаются только если текущее значение isOurPacUrl; иначе снимок снимается без записи, а engage со снимком на чужом PAC даёт `unavailable/foreignPac`. Плюс тест.
- [ ] Безопасность · src/main/settings/SettingsManager.ts:50-57 и src/main/validate.ts:80 — ключи проверяются через `in`, проходят `__proto__`, `toString`, `constructor`; импорт бэкапа `{"app":"deep-focus","version":1,"settings":{"__proto__":{"toString":"x"}}}` подменяет Object.prototype.toString в main. Каким должно быть: только собственные ключи схемы (Object.hasOwn), `__proto__`/`constructor`/`prototype` → SettingsError/ValidationError; тест.
- [ ] Безопасность · src/main/ipc.ts:15 и src/main/windows.ts:36 — доверенным считается любой file://, и навигация на любой file:// разрешена: перетащенный .html получает window.deepFocus и может вызвать settings.deleteAllData, blocker.* и т. д. Каким должно быть: и доверие, и навигация — только для URL собственных renderer/{app,widget,audio}/index.html (в dev — те же пути на dev-сервере); тест.
- [ ] Spec 12.3 · src/main/index.ts:84-91 и :134 — если БД не открылась, приложение молча работает в памяти, moduleStatuses отдаёт storage=ok. Каким должно быть: пользователь видит диалог «данные не сохраняются, путь, журнал», storage получает статус error.
- [ ] Craft · tests/e2e/shell.spec.ts:33 — вкладки читаются через evaluateAll сразу после клика, гонка. Каким должно быть: перед чтением `await expect(page.locator('[role="tab"]')).toHaveCount(5)`.
- [ ] Spec §12.2 · src/main/widget/electron.ts:20-38, src/main/widget/ipc.ts:39-40, src/main/widget/WidgetManager.ts:250-251 — окно виджета не восстанавливается после сбоя: нет обработчиков `render-process-gone` и `close`, после `closed` WidgetManager держит уничтоженное `win`; `widget.show()` не создаёт окно, `isVisible()` врёт true. Каким должно быть: при падении renderer или закрытии окна виджета (не во время выхода) WidgetManager сбрасывает `win` и пересоздаёт окно с текущими настройками, если виджет должен быть виден; пользовательское закрытие приравнено к `hide()`; тест.

Добавлены оркестратором из «report» (безопасность, дёшево, сказано пользователю):

- [ ] src/main/blocker/ipc.ts:156 — при выключении/выходе из Windows `will-quit` не срабатывает, в HKCU остаётся `http://127.0.0.1:<порт>/deep-focus.pac`; любой локальный процесс может занять порт и пустить трафик пользователя через свой прокси. Каким должно быть: на `session-end` окна синхронно удалять наш AutoConfigURL (только если он наш).
- [ ] src/main/blocker/PacServer.ts:240-249 — PAC отдаётся без `X-Content-Type-Options: nosniff` и без проверки Host: сайт, угадавший порт, читает список блокировки и прокси пользователя. Каким должно быть: nosniff, 403 при Host ≠ `127.0.0.1:<порт>`; тест.
- [ ] tests/e2e/blocker.spec.ts:108-227 — каждый `npm run e2e` меняет настоящий прокси HKCU без явного разрешения. Каким должно быть: `test.skip(!process.env.DF_REAL_REGISTRY)` как у SystemProxy.registry.test.ts.
