# Wave 4 — независимое денежное и consumer-contract ревью

**Вход:** неизменяемый `research/reviews/wave4-plan.md`, редакция R3. SHA-256: `1cc43a1e8ed904e3f7dc1d85a496ff7769656173172be3a5bda5a5d4748713f9`.

**Метод:** полностью прочитаны пользовательский хендоф `upload/Вставленный текст(2).txt`, Q 1.1.2 и snapshot плана. Дополнительно изучен существующий исследовательский dossier `research/paddle-sdk.md`; он использован как контекст, а не как замена более свежему source-aware контракту плана. Рецензии других критиков и отдельный журнал результатов волн не использовались. Проверялись архитектурные обещания и контрпримеры; реализации, изменения аккаунтов, API mutations, платежи и выполнение тестов не производились.

## Итог и классификация

**Материальных P0/P1/P2 замечаний по проверенной денежной области не установлено.** Это результат анализа заявленных контрактов, а не доказательство работоспособности будущего runtime. План содержит необходимые ограничения, атомарные границы и запланированные проверки именно для рассматриваемых атакующих последовательностей. Требовать сейчас production ledger, утверждения тарифов, второй provider или общий межконтекстный transaction означало бы расширить задачу без устранения установленного дефекта.

| Приоритет | Результат |
| --- | --- |
| P0 | Не найдено противоречия, разрешающего необратимую потерю денежной истории или повторный автоматический monetary dispatch вопреки заявленным гарантиям. |
| P1 | Не найдена последовательность, которая при соблюдении всех условий R3 создаёт второй eligible benefit либо позволяет устаревшему consumer decision победить новое принятое evidence. |
| P2 | Новых обязательных изменений дизайна не требуется. Ниже перечислены границы, которые необходимо буквально сохранить при реализации и квалификации, без создания дополнительных сервисов. |

## 1. Initial intent: две подписки и разные первоначальные периоды

**Атакующая последовательность.** Один первоначальный recurring intent I имеет попытку A с неопределённым исходом. Авторизованное решение допускает связанную попытку B с записанным риском дубля. Позже обнаруживаются две completed transactions, разные provider subscriptions S1/S2 и несовпадающие initial periods P1/P2. Если бы unique grant key содержал только provider subscription или exact period, обе оплаты прошли бы независимо. Последующие renewals двух streams закрепили бы ошибку.

**Почему R3 выдерживает её.** §4 резервирует стабильную локальную техническую subscription basis до dispatch и относит обе attempts и provider IDs к кандидатам поддержки одной basis. Дополнительный initial-fulfillment guard привязан к originating intent и benefit slot, а не к внешнему периоду. §6 требует проверять его в одной consumer транзакции с period decision. Поэтому различие P1/P2 не создаёт второе первоначальное право. Duplicate-initial-purchase hold сохраняет обе оплаты и кандидатов; selected-stream правило удерживает renewals невыбранной внешней подписки.

Это не заменяет продуктовую Subscription техническим provider ID: коммерческий владелец остаётся Commercial Access. Также не вводится универсальный запрет на вторую подписку пользователя: отдельный намеренный intent может создать другое право по политике продукта. Такое разделение ответственности соответствует Q и исходному хендофу.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** все перестановки двух initial completions, конкурентный commit, restart и дальнейшие renewals обоих streams дают максимум одну eligible initial выдачу; unresolved duplicate даёт hold, выбранный stream допускает только собственные квалифицированные renewals. Другой явно разрешённый intent сохраняет возможность отдельной выдачи. Этот сценарий уже прямо включён в дополнение третьей волны §12.

## 2. Causal contributions и полный read-set решения

**Атакующая последовательность.** Обработчик H1 читает paid transaction A и отсутствие блокирующей отмены. Пока он вычисляет grant, H2 принимает новое subscription cancellation, adverse revision A либо вторую transaction B того же benefit. Проверка только source revision A не обнаружила бы новый источник B или изменение lifecycle; H1 мог бы записать решение по устаревшему набору фактов.

**Почему R3 выдерживает её.** §5/T3 отдельно определяет ingestion revision для каждого source aggregate и общий benefit-basis/commercial decision. Все writers решения, включая transaction feed, subscription feed и operator resolution, обязаны применять общий порядок блокировок либо валидировать полный expected read set. Plan отдельно запрещает коммитить для basis решения по разным устаревшим наборам contributions. Численные revisions разных источников не сравниваются. Следовательно, проверка одного transaction watermark не удовлетворяет контракту даже при корректном source dedup.

В реализации важен именно полный набор: новый contributor является изменением входа решения, хотя его раньше не было в списке прочитанных source rows. Общая блокировка basis либо проверяемая версия состава contributions реализует уже требуемую гарантию; это не новый architectural layer и не основание добавить generic coordinator.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** одновременно запускать A→decision, новый B→contribution и subscription cancel→contribution; останавливать первый обработчик после чтения. Он либо проигрывает commit и перечитывает всё, либо коммитится до конкурирующего изменения, после чего последующая decision revision исправляет результат. Нельзя объявить успешным stale commit лишь потому, что revision A не менялась. Тот же oracle применяется к равной producer revision с другим digest и к authorized redrive.

## 3. Duplicate hold и независимость результата от порядка

**Атакующая последовательность.** A уже полностью refunded, B paid; обе transactions претендуют на один локальный benefit. При A→B наивная реализация может решить, что первая оплата «исчезла», и выдать по B. При B→A она может сначала выдать, затем компенсировать B чужим refund A. Оба исхода нарушают causal support и дают различное конечное право.

**Почему R3 выдерживает её.** §5/T3 сохраняет completed facts как отдельные contributions, выбранную поддержку и состояние applied outcome. Полный refund A не удаляет исторический факт второй оплаты. Reference policy переводит неоднозначный duplicate в eligible/spendable allocation 0 независимо от порядка, удерживая ранее выданное через policy hold. Это отдельный consumer restriction, а не фиктивный provider refund. Explicit resolution выбирает допустимую поддержку; причинный источник уже существующего grant не меняется скрытно.

§12 задаёт именно A-refunded/B-paid как обязательный пример и разрешает различаться истории промежуточной выдачи при одинаковом конечном decision. Это корректная форма convergence: невозможно задним числом сделать два фактически разных исполнения одинаковым аудитом, но можно потребовать одинаковое право при полном одинаковом evidence и той же resolution.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** оба порядка до resolution дают eligible 0 и duplicate hold; выбор B даёт Q, максимум одну original issuance и ни одной компенсации grant B из-за refund A. Повтор resolution ничего не добавляет; новый adverse B заставляет решение учитывать новое evidence. Проверяется сумма eligible/held, support identity и effect history, а не только число grant rows.

## 4. Adjustments, reversal и отсутствие несуществующей компенсации

**Атакующая последовательность.** Approved adverse приходит до completion, затем повторяется в новых snapshots. Позже provider меняет original adjustment на reversed и отдельно создаёт reverse adjustment. Наивное накопление отрицательных/положительных deltas сначала создаёт долг без первоначальной выдачи, затем дважды восстанавливает её.

**Почему R3 выдерживает её.** §§5/7 хранят identities, states, versions, signed amounts и item allocations. Pending barrier T1 не позволяет подготовленному до adverse reducer успешно закоммитить revision как будто нового adverse нет. Нормальный decoder failure не убирает barrier: quarantine/failure publication доносит pending/conflict до consumers. Original reversed и отдельный reverse не становятся двумя синтетическими компенсациями core.

Consumer contract различает never-issued, issued, reduced и restored. Qualified adverse до первой выдачи означает withheld 0; после выдачи — единственную correction. Restoration требует доказанной корреляции и актуальной policy. Unsupported/partial/неоднозначный reversal удерживается, а денежная сумма не делится автоматически на цену AI-кредита. Это достаточная минимальная граница между payment facts и продуктовой коррекцией.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** refund-first не создаёт отрицательный grant; повтор snapshots не повторяет correction; две provider representations одного reversal дают максимум одну квалифицированную restoration. Если correlation не доказана, результат held. Refund, поступивший после T2, может потребовать eventual correction после выдачи: §7 честно определяет эту межконтекстную экспозицию и не обещает общей транзакции.

## 5. Held decision после transport acknowledgement

**Атакующая последовательность.** Consumer durably принимает completion, но mapping/policy неизвестна. Sender получает ACK и очищает job. После restart оператор устанавливает нужную policy; повтор того же сообщения source revision уже не повышает, поэтому обычный replay не должен выдавать benefit. Без другого пути покупка навсегда осталась бы held.

**Почему R3 выдерживает её.** §5/T3 явно разделяет custody ACK и fulfillment. Consumer сохраняет durable obligation с basis, blocker, read set и historical policy. `resolveHeldDecision`/redrive пересчитывает её без synthetic producer revision, удаления receipt или policyVersion в unique grant key. Expected decision revision и весь актуальный evidence read set проверяются в локальной транзакции; actor/approval, effects и consumer outbox сохраняются вместе.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** held+acked→удалённый sender job→restart→authorized resolution выдаёт положенный benefit один раз. Одновременный refund блокирует stale resolution. Повтор исходного message остаётся duplicate, повтор разрешения идемпотентен. Путь восстановления принадлежит consumer и не зависит от срока жизни sender queue row.

## 6. Ограниченный incomplete envelope

**Атакующая последовательность.** После ранее принятого complete evidence история adjustments превышает payload limit либо producer выпускает неподдержанную payload schema. Если producer просто не доставляет новый snapshot, consumer продолжает считать старое положительное evidence текущим. Если историю обрезать, omission может выглядеть как отсутствие adverse.

**Почему R3 выдерживает её.** §5 вводит отдельный bounded `held/incomplete` control с устойчивыми identity/revision/digest и reason/reference. Он не содержит растущую историю и имеет заранее зарезервированный предел. Commit сохраняет revision, delivery targets и resolution obligation атомарно. Consumer продвигает source revision, считает прежнюю contribution только lastKnown и пересчитывает hold/restriction; старый complete уже не снимает hold. Известный envelope с неизвестной payload schema принимает custody как incomplete, а непроверяемая identity остаётся transport quarantine без business ACK.

**Минимальная поправка:** не требуется. **Будущий acceptance oracle:** complete N→overflow control N+1→restart/удаление job→старый complete N сохраняет ограничение; квалифицированный complete N+2 восстанавливает полноту один раз. Нельзя считать отказ сериализации успешной публикацией. Совместимый control путь обязателен при rolling upgrade и уже описан в плане.

## Заключение

R3 в проверенной области последовательно защищает денежные факты, consumer policy и независимые атомарные границы. Ключевые исправления следует сохранить буквально: intent guard поверх period keys, causal support вместо безымянного netting, общий decision read set, policy hold для duplicate ambiguity, consumer-owned redrive и bounded incomplete control. Их дальнейшая детализация в SQL/schema и executable fixtures остаётся необходимой работой P2–P5, а не неустранённым архитектурным противоречием. Дополнительных обязательных изменений перед передачей плана в реализацию по этому lens не предлагаю.
