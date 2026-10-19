# WAVE2 — независимое архитектурное ревью

**Четвёртый критик.** Проверен неизменяемый `wave2-plan.md`, SHA-256 `28aebbb5b0c24231f2002e7aa2fb081d60e29cd98fe7a84e0173d55ab723a85a`. Полностью прочитаны пользовательский handoff, Q 1.1.2, `research/get-modular.md`, `research/platform-foundation-q.md` и `research/reuse.md`. Дополнительно проверены опубликованные manifests/declarations Assembly 0.5.0 и Resources 0.1.0, Foundation 1.10.0/FMS 0.1.1 и относящийся к транзакциям код опубликованного pg-boss 12.38.0. Рецензии других критиков и журнал ревью не читались. Реализация, тесты, аккаунты и исходные репозитории не изменялись.

## Вывод

План сохраняет правильное направление зависимостей и минимально достаточные границы. Перепроектирование SDK, новый generic framework, дополнительные пакеты или второй реальный provider не нужны. Обнаружены **один P1 и один P2**: возобновление отложенного consumer effect противоречит сформулированному revision gate; для собственных SQL-транзакций не определены пределы ожидания, необходимые выбранному ingress protocol. P0 не обнаружен.

Отсутствие выполненной SQL/sandbox/packed qualification не считаю дефектом исследовательской задачи: план прямо относит её к следующим этапам. Ниже отмечены именно недостающие правила, которые будущей qualification сейчас нечем проверять. После их уточнения документ пригоден для начала небольших реализационных этапов. Готовностью production это не является.

## P1 — подтверждённый input может навсегда остаться `pending_policy`

**Место:** `wave2-plan.md:172`, T3: только строго более новая evidence revision может вызвать grant/correction; равная revision с тем же digest — duplicate. В то же время строки 190 и 202 предписывают `pending_policy`, если неизвестны однозначный effective binding или политика коррекции. Строка 198 допускает удержание adjustment до разрешения корреляции. Это нормальные состояния, но выход из них не определён.

**Точная трасса отказа:**

1. Credit consumer получает transaction evidence revision 7 с completed purchase. Подтверждение подлинное, но сохранённая история policy пока не даёт однозначного grant mapping.
2. Consumer атомарно записывает receipt, evidence revision 7 и `pending_policy`, затем подтверждает delivery. Это естественное прочтение T3: durable custody обеспечена, начислять пока нельзя.
3. Владелец продукта утверждает недостающее правило или оператор подтверждает нужную историческую привязку. Провайдер не изменился; нового payment evidence нет.
4. Повтор revision 7 распознаётся как duplicate. Payment producer не обязан создавать revision 8 из-за локального решения credit owner. По буквальному правилу T3 consumer не может теперь вызвать grant.
5. Оплаченная возможность остаётся невыданной без дальнейшего внешнего события. Аналогично одобренная позднее refund policy не запускает correction уже принятого отрицательного evidence.

Это не требование реализовать production ledger внутри библиотеки. Дефект находится в описанном протоколе передачи и референсном consumer state machine: он обещает безопасное удержание, но одновременно запрещает его завершение. Повторить транспортную доставку недостаточно; включить `policyVersion` в unique grant key было бы неправильным исправлением, позволяющим вторую выдачу.

**Минимальная коррекция:** разделить принятие source revision и применение производного consumer effect. Только более новая payment revision заменяет evidence projection. Однако consumer сохраняет собственную durable obligation для неразрешённого effect и может позднее повторно вычислить его из **актуальной сохранённой** evidence projection после авторизованного локального решения. Это узкий consumer-owned use case/redrive, а не новый общий движок workflows. Receipt может быть acknowledged после сохранения такой обязанности; acknowledgement не означает, что entitlement или credit effect уже выполнен.

При возобновлении нужны обычные локальные гарантии: блокировка/CAS evidence и consumer resolution state; проверка, что одобренная policy относится к нужному историческому основанию; прежний стабильный benefit/grant key; атомарные effect, obligation status и consumer outbox. Новая локальная версия решения не становится новой payment revision или новым денежным правом. Более свежий refund, пришедший во время согласования, должен учитываться повторным расчётом, а не проигрывать сохранённому решению «выдать по revision 7».

**Приёмка:** completed evidence → durable `pending_policy` → crash/restart → локальное утверждение policy → ровно один grant **без нового payment input**. Повтор approval и replay исходного сообщения не дают ещё одного grant. Второй сценарий: между hold и approval поступает более новая refund revision; возобновление читает её и применяет выбранную политику, исключая выдачу по устаревшему snapshot. Третий: correction, удержанная из-за неизвестной корреляции adjustment, становится исполнимой после её подтверждения с одним стабильным correction basis.

## P2 — собственные SQL-транзакции не имеют определённой границы ожидания

**Место:** T1 требует acknowledgement в пределах пяти секунд (`wave2-plan.md:135`); adjustment admission захватывает общий transaction aggregate и повышает его revision (`:155`). §9 сознательно выбирает ordinary `work`, а T1/T2 выполняются короткими application-owned транзакциями (`:220`). Но ни storage protocol, ни reference deployment не определяют acquisition/lock/statement/transaction budgets и поведение при их исчерпании.

**Точная трасса отказа:** T2 захватывает aggregate row. Его процесс или соединение зависает, оставляя транзакцию открытой; это возможно и без provider I/O внутри SQL. Подписанный adjustment приходит в T1 и ждёт ту же строку. HTTP deadline проходит, Paddle повторяет уведомление, следующие T1 тоже ждут либо занимают очередь borrowed pool. Без границы ожидания этот отказ не превращается в контролируемый rollback/5xx; он способен исчерпать соединения и доступное окно повторных доставок. Общий pool переносит проблему на соседние scopes. Финансовые записи могут оставаться согласованными, но обещанная принимаемость и восстановимость ingress перестают быть ограниченными операциями.

Это не утверждение, что приложение обязано всегда уложиться в пять секунд при отказе БД. Требуется ограниченный **неуспех**, после которого нет продолжившейся SQL-работы с ошибочно освобождённым клиентом. Существующая оговорка о реальном завершении SDK promise полезна, но SQL wait contract она не задаёт.

**Почему pg-boss не закрывает это автоматически:** в inspected `research/sources/reuse/pg-boss/package/dist/manager.js:658–677` установка database transaction timeout находится внутри `if (transactional)`. План этот режим исключает. `IDatabase.beginTransaction` в опубликованном `dist/types.d.ts:31–36` — отдельная optional capability, а простой `executeSql` wrapper ничего не устанавливает для транзакций payment owner. Поэтому нельзя перенести доказательство transactional worker на выбранную ordinary-work интеграцию.

**Минимальная коррекция:** добавить в storage/reference profile явные конечные бюджеты ожидания pool acquisition, row lock, SQL statement и всей открытой transaction, включая idle interval. Для выбранного PG18 можно использовать server-side `transaction_timeout` вместе с более короткими пределами отдельных операций; конкретные значения выбрать на P3, оставив запас ingress deadline. Host задаёт connection budget и admission concurrency, adapter применяет transaction-local настройки на том же checked-out client. Не нужно глобально менять shared pool или добавлять свой transaction manager.

Ошибки до commit возвращают durable-admission failure/5xx и оставляют прежнюю work obligation доступной повтору. Rollback/release должны отражать фактическое завершение SQL; клиент с неопределённым состоянием нельзя вернуть в pool как исправный. Неизвестный результат commit обрабатывается повторным admission с прежней event identity и сравнением digest, а не новым business identity. Эти правила совместимы с уже выбранной at-least-once моделью.

**Приёмка:** реальная PG18-сессия удерживает требуемую строку; T1 ограниченно завершается неуспехом, не создаёт частично принятого input и освобождает собственные ресурсы. После снятия блокировки тот же input принимается один раз. Отдельно зависшая idle transaction прекращается server-side, pool exhaustion имеет конечный исход, sibling scope сохраняет возможность работы при предусмотренном бюджете. При потере ответа commit повтор сходится на существующем inbox, не на второй покупке. Это focused integration gate, не нагрузочная платформа.

## Что следует сохранить

**Границы ответственности.** Payment evidence, продуктовые права, credit accounting и operational usage действительно меняются по разным причинам. Техническая provider-subscription projection не дублирует Commercial Access Subscription, если сохраняются нынешние naming/provenance и запрет использовать provider `active` как entitlement. План верно не материализует Commercial Accounting, которого accepted Platform пока не определила. Отдельное решение о владельце кредитов нужно перед production, но оно не блокирует разработку payment core.

**Consumer snapshots и observations.** Полные immutable evidence revisions оправданы доставкой без требования получить каждую промежуточную revision. Их monotonic admission защищает от `refund r4 → paid-only r3`; stable business effect keys защищают от двух transactions за одно основание. Это две различные гарантии, и объединять их в один dedup key нельзя. SDK-aware presence/unknown/mapping-collapse также является настоящей границей знания. Не следует заменять её предполагаемым raw HTTP seam или считать SDK `null` доказанным wire absence. Уже описанный qualification hold честнее ложной полноты.

**Малое число портов и поставок.** Согласованный `PaymentStore` защищает реальные атомарные операции. Репозиторий на таблицу или Unit of Work, протекающий в consumers, ухудшил бы контракт. Четыре distribution boundaries разумны: core, provider, storage и optional GM имеют разные dependency sets. Их можно реализовать функциями без обязательной классовой иерархии. Дополнительные пакеты для money, refunds, callbacks, policy или каждой command не нужны. Оценку строк следует оставить диапазоном, а не превращать в основание удалить необходимые протоколы.

**Переиспользование.** pg-boss снимает generic очередь; собственные inbox/outbox/effect identities выражают знания о платежах и потому остаются. В этом нет нарушения DRY. Выбор ordinary workers с коротким idempotent commit честно оставляет gap до queue completion и восстанавливает его replay. Money integer-string/native bigint достаточно выбранному профилю; Decimal/Dinero не снимают алгоритм, которым v1 владеет. Zod оправдан при реально сложном codec, а Standard Schema без caller-supplied validator является ненужной extension point.

## Get Modular, Foundation и передача следующему разработчику

§10 соответствует прочитанным published declarations: `defineContract`, `declareModule`, `implement`, static `group`, `assemblyFor().prepare` и `run` существуют в Assembly 0.5.0. Его manifest действительно зависит от Core **ровно 0.5.0**. Поэтому требование согласованных peers и одной физической Resources следует сохранить и проверять на tarballs, включая transitive resolution; одного удовлетворённого широкого диапазона недостаточно. Conformance остаётся dev tooling. Платёжная фабрика остаётся plain factory, descriptors — внешней composition responsibility.

Разделение опубликованной линии .5/.1/.3 и pending observation train .6/.2/.4/.1 корректно. Не следует менять его на «latest» или смешивать документы main/pending CMS. Определённых Get Modular lifecycle hooks нет; ownership, start/drain/cleanup остаются Host. Описанный actual-settlement shutdown защищает borrowed pool лучше формального `stop` timeout. В P6 статический GM consumer может быть завершён на опубликованной линии; observation — отдельная qualification после upstream admission, без подмены финансовой доставки `watch/load`. Для wiring полезны уже исследованные isolate/smoke и независимый oracle выбора provider, соразмерно фактическим модулям.

Foundation 1.10.0 только в development, exact TypeScript 7.0.2, owning strict projects и packed NodeNext/Bundler с `skipLibCheck:false` — содержательные ограничения, а не декорация. Actual FMS0.1.1 optional peer `^1.10.0` учтён правильно; исправление в main не выдаётся за опубликованное. V2 source policy оправдана обычными workspace packages, root tooling отдельно охвачен typecheck; при необходимости архитектурной root authority требуется квалифицировать exact V3 artifact. FMS следует оставить opt-in. Платёжная задача не разрешает обновление Foundation в существующей Platform.

## Условия готовности

До передачи P1–P3 следующему разработчику следует внести два правила выше и согласовать с ними acceptance cases. Достаточно уточнить существующие T3/storage sections; отдельный пакет, ADR-ритуал или полная новая схема не нужны. В catalog contract при реализации нужно сохранить уже обещанную согласованность immutable offer version и соответствующего provider mapping: не читать «последнюю цену» для старого intent.

Затем обязательны уже выбранные свидетельства: pure core invariants; реальные PG18 atomicity/concurrency/crash/repair; SDK-specific normalization и absence-dependent qualification; два изолированных packed consumers с различным wiring; borrowed-pool startup/drain; проверка отсутствия Foundation/Paddle/GM из core и правильной peer identity. Node floors 24.21.0/26.11.1, Linux и PG18 остаются **выбранными целями**, а не результатом этого review. Расширять matrix до Bun/edge, другой БД или provider ради архитектурного доказательства не требуется.

До production отдельно нужны утверждённые grant/refund/late-renewal policies, credit owner и полномочия customer portal. Их отсутствие сейчас не оправдывает жёстко заданные бизнес-числа. Главное условие после исправления P1: неопределённость должна оставаться durable и возобновляемой, а не превращаться либо в самовольную выдачу, либо в бесконечный hold без дальнейшего разрешённого перехода.

**Проверка неизменности:** после записи рецензии SHA-256 исходного `wave2-plan.md` повторно вычислен и совпал: `28aebbb5b0c24231f2002e7aa2fb081d60e29cd98fe7a84e0173d55ab723a85a`.
