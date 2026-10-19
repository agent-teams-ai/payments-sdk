# WAVE1 — независимое архитектурное ревью

**Объект:** `wave1-plan.md`, SHA-256 `bf6902d8bbba502ce4b93492dc5646d0a1a704e575f0f98fabf012f61ccb6cce`. Прочитаны весь план, исходный пользовательский хендоф и весь Q 1.1.2; дополнительно проверены retained research о Platform/Foundation и Get Modular. Чужие рецензии не использовались. Реализация и изменение плана не выполнялись.

## Вердикт

**Направление архитектуры принять; контракт доставки ещё нельзя считать закрытым для реализации.** P0 не обнаружено. Два P1 относятся к идентичности и применению evidence revisions; ещё три P2 следует уточнить до фиксации схемы и consumer fixtures. Это недостаточность конкретных контрактов плана, а не утверждение, что уже существует ошибочная реализация.

Сильная часть решения — реальные владельцы и направление зависимостей. Payment core отделён от SDK, SQL, Get Modular и моделей продукта; Commercial Access не превращён в payment/credit ledger; отсутствие принятого Commercial Accounting отражено честно. Обычная фабрика и opt-in GM integration не создают второй production root в одном Host. Durable обработка не делегирована `watch/load`. Внешние неизвестные исходы не притворяются обычными retryable ошибками. Для Q это важнее числа пакетов или интерфейсов.

Субъективно: **архитектурное направление 8/10; риск избыточной архитектуры 3/10**, где 10 означает высокий риск. Баллы не являются доказательством качества: оценка снижена за незавершённый межкомпонентный протокол, а не за отсутствие классов, второго настоящего провайдера или дополнительных ADR. Четыре точки поставки соответствуют четырём независимо подключаемым зависимостям; причин требовать новые пакеты сейчас нет.

## P1 — закрыть до реализации протокола и его схемы

### A1. Не разделены identity денежного факта, evidence message и consumer effect

**Место:** §5 «Конкретный storage protocol», строки 129–131; §5 T3, строки 135–139.

Completed fact имеет единственную identity на transaction: `(provider, stableAccount, environment, transactionId, completion)`. Далее предлагается передавать меняющиеся `PaymentEvidenceChanged` revisions, но delivery target определён как `(factId, consumerId)`. Не определено, означает ли `factId` completed fact или отдельную immutable evidence revision. При этом отдельный stable message ID упомянут, но его отношение к обоим ключам не задано.

**Сценарий и эффект:** completion доставлен и отмечен acknowledged. Позже приходит approved refund того же transaction. Если target создаётся с тем же completed `factId`, существующая delivery уже выполнена и изменение не доставляется. Другой естественный вариант реализации — считать каждую revision новым денежным effect key; тогда повтор evidence может стать новым grant. План содержит правильные намерения, но допускает оба несовместимых прочтения.

**Минимальная правка:** явно определить три независимые identity: неизменяемый payment/completion fact; immutable evidence change с identity, однозначно связанной с aggregate и local evidence revision; денежный consumer effect key. Delivery dedup — `(evidenceChangeId, consumerId)`, повторная отправка сохраняет message identity. Grant dedup использует собственный grant basis, а не message ID. Уточнить, что schema version не создаёт новый оплаченный effect. Ввести один acceptance case: completion acknowledged → approved adjustment → новая доставка тому же consumer → отсутствие второй выдачи. Нового транспорта или пакета не требуется.

### A2. Snapshot устраняет gap, но сам по себе не устраняет применение старой revision после новой

**Место:** §5, строка 131: «Revision 4, пришедшая раньше 3 … может безопасно заменить consumer projection»; §5 T3; §12 P5.

Полный snapshot действительно позволяет обработать revision 4 без ожидания 3. Однако T3 описывает только dedup по message receipt. Revision 3 и 4 — разные сообщения, поэтому обе пройдут такой dedup. Для consumer не сформулировано обязательное монотонное применение local evidence revision.

**Сценарий и эффект:** revision 3 содержит approved refund; revision 4 — его reversal или более полную корреляцию reverse adjustments. Consumer сначала применяет 4, затем задержавшуюся 3. Без собственного CAS последняя доставка откатывает evidence projection и способна повторно изменить entitlement/credit correction. Все сообщения при этом уникальны, подписи верны, inbox и outbox работают штатно. Provider watermarks из §6 защищают payment-owner projection, но не заменяют проверку в независимой БД consumer.

**Минимальная правка:** consumer transaction атомарно сохраняет receipt, сравнивает evidence revision для конкретного aggregate и применяет только более новую revision; старая получает durable stale acknowledgement без effects. Равная revision с иным canonical payload — conflict, а не новая информация. Consumer policy выводит grant/correction из принятой evidence projection, сохраняя отдельные effect identities. Сравнение revisions разных transaction не вводить. В P5 добавить доказательство последовательностей `4→3→4` и равной revision с конфликтующим содержимым. Это уточнение существующего snapshot protocol, а не требование очереди с глобальным порядком.

## P2 — уточнить перед реализацией соответствующей границы

### A3. Для subscription-only changes не определён durable контракт передачи потребителю

**Место:** §1 scope; §3 `readObservedSubscription`; §5 T2/T3 и payload строки 131; §6 отмена/past_due; §12 P5.

Единственный конкретизированный межкомпонентный payload связан с transaction aggregate. Подписочная projection описана внутри payment owner; доступен read, но не сказано, как независимый consumer надёжно узнаёт subscription-only transitions и как восстанавливает их после своего простоя. Общая фраза об outbox фактов не задаёт identity, revision или recovery этой категории.

**Сценарий и эффект:** subscription отменена немедленно через разрешённое действие провайдера либо изменена внешним оператором без новой transaction. Payment projection обновилась, однако `PaymentEvidenceChanged` для какого-либо transaction не возник. Commercial Access продолжает работать по старой информации, если integration ошибочно считает transaction outbox полным feed коммерчески значимых provider observations. Перенос решения об access в payment core ради устранения этого пробела нарушил бы уже правильно проведённую границу.

**Минимальная правка:** выбрать один явный механизм. Предпочтительно — versioned `ObservedSubscriptionEvidenceChanged` с local subscription binding, provider provenance/revision, status, scheduled change/effectiveAt и flags, записываемый T2 вместе с outbox. Допустим и документированный polling protocol по durable projection с consumer checkpoint и recovery; одного обычного read без такого протокола недостаточно для обещанной доставки. Consumer сам решает access, grace и restrictions. Добавить сценарий «subscription-only cancel → consumer недоступен → восстановление»; не требовать production реализации Commercial Access в этом задании.

### A4. Provider line identity и стабильный benefit/grant-basis item пока названы слишком похоже

**Место:** §3 snapshot предложения; §5 строка 129 «Item identity — `details.line_items[].id`»; §6 строка 153 «subscription, устойчивый benefit/item и конкретный период».

Transaction line ID правильно нужен для точной истории и adjustment allocations. Но он не определяет один и тот же коммерческий benefit между разными transaction. План одновременно обещает не выдавать второй grant при другом оплаченной transaction того же периода и не определяет, откуда берётся стабильный benefit/item в соответствующем unique key.

**Сценарий и эффект:** из-за внешнего дубля существуют два оплаченных transaction одной subscription за один период. У каждого собственная transaction line identity. Если consumer использует единственный явно названный `item` из §5, grant keys различаются и обе оплаты дают квоту, хотя §6 требует одну. Подмена line ID на price ID глобально тоже неверна: это разрушит точность финансовой истории и allocations.

**Минимальная правка:** назвать отдельно `providerLineRef` и catalog-owned `benefitKey`/grant-basis item. Для узкого v1 допустим явно описанный mapping из доверенного offer identity, если он стабилен для одного обещанного benefit. Сохранить mapping в immutable offer/subscription binding и передавать consumer достаточно данных для его применения. Не делать ключ частью Paddle DTO и не включать policy version в effect key. Acceptance: два transaction, разные line IDs, один binding/benefit/period → два денежных факта, один grant и видимая аномалия.

### A5. Восстановление unknown заканчивается «операционным решением», но изменение состояния после этого не законтрактовано

**Место:** §3 `readOperation`; §4 шаги 5–7; §9 unknown/reconciliation; §12 P7 runbook.

План верно запрещает повтор неизвестной мутации и признаёт crash после durable `dispatch_started`, но до фактического send. Такой случай может навсегда оставаться unknown: отсутствие объекта в list не доказывает неисполнение. Упомянута новая попытка после безопасного исхода либо явного операционного решения, но не определён владелец и атомарность этого перехода.

**Сценарий и эффект:** оператор должен восстановить покупку после такого crash. Без контрактного пути реализация либо оставляет intent бессрочно заблокированным, либо добавляет в админке прямое изменение SQL/обычный retry, обходя историю, fingerprint и защиту от позднего результата старой попытки. Это не повод вводить распределённый workflow engine; это незакрытый переход уже существующей state machine.

**Минимальная правка:** описать узкую operator recovery capability или private application use case: expected operation revision, проверенное evidence/обоснование решения, actor/audit reference, зафиксированный риск, результат «оставить unknown / связать доказанный outcome / разрешить новую связанную attempt». CAS, audit и изменение допуска retry — одна payment-owner транзакция. Host авторизует оператора; библиотека не выдаёт ему права. Поздняя observation предыдущей attempt после решения остаётся отдельным фактом и конфликтом, не перезаписью новой истории. Проверить это одним fault/recovery сценарием; конкретный административный UI не входит в v1.

## Что не является блокером или требованием расширить scope

- **Не нужен второй настоящий provider.** Исследование различий плюс честный fake/contract profile достаточно для заявленной независимости исходников. Переносимость денежных semantics всё ещё не доказана и план правильно этого не обещает.
- **Не нужно дробить `PaymentStore` по таблицам.** Один cohesive порт, защищающий локальные атомарные границы, совместим с Q; уточнять нужно semantics commit/claim, а не число интерфейсов.
- **pg-boss внутри PostgreSQL adapter допустим.** Его job history не объявлена финансовой authority, same-tx admission и внешнее управление worker lifecycle описаны. Не следует добавлять альтернативный queue engine ради абстракции. На момент реализации останется проверить фактические полномочия/инфраструктуру Host, как и сказано в исходном задании.
- **Нельзя устранять перечисленные пробелы переносом credit ledger или entitlement policy в core.** Все fixes помещаются в существующие boundaries: payment evidence, durable delivery, trusted catalog mapping и узкая recovery capability.
- **P5 consumer fixtures должны выбрать явную тестовую policy.** Это позволяет проверять grants/reversals и `pending_policy` без превращения примерных цен, partial-refund правил или сроков кредита в утверждённую коммерческую модель. Это уточнение acceptance, а не новый продуктовый gate для исследования.

## Основания оценки

Q 1.1.2, разделы Clean Architecture, LSP, DIP и DRY: consumer-shaped contracts включают ошибки и side effects; replicated projections допустимы при явных правилах синхронизации; тесты не должны доказывать только совпадение формы. Retained `research/platform-foundation-q.md`, §3: Commercial Access стратегически принят, accounting не принят, cross-context SQL/shared UoW запрещены. Retained `research/get-modular.md`, §3–6: plain ports вне composition, один production composition authority, resource custody и observation не заменяют durable delivery. Эти источники поддерживают существующее направление плана; перечисленные замечания уточняют денежные протоколы внутри этого направления.
