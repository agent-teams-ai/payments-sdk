# Payments SDK documentation

Start with the smallest route that answers your task. The [agent instructions](../AGENTS.md) apply to every change. This map introduces no new contract or release claim.

## Choose a task

| Task | Start here |
| --- | --- |
| Install or integrate | [Getting started](getting-started.md), [releasing](releasing.md), [migration 0.5](migrations/0.5.md) |
| Understand guarantees and boundaries | [Architecture](architecture.md), [developer stack](developer-stack.md) |
| Plan or resume implementation | [Implementation plan](implementation-plan.md), [status](implementation-status.md), [SDK hardening](public-sdk-hardening.md) |
| Change persistence or transport | [Storage portability](storage-portability.md), [queue transport](queue-transport.md) |
| Operate or recover | [Operations](operations.md), [recovery](recovery.md), [reconciliation](reconciliation.md), [reclassification](reclassification.md) |
| Qualify or release | [Qualification](qualification.md), [security qualification](security-qualification.md), [runtime security admission](runtime-security-admission.md), [upstream qualification](upstream-qualification.md) |
| Change composition or tooling | [Feature Module Standard](feature-module-adoption.md), [Foundation adoption](foundation-adoption.md), [Get Modular adoption](get-modular-adoption.md), [Get Modular growth](get-modular-growth.md), [Node or Bun adoption](node-or-bun-adoption.md), [governance rollout](governance-rollout.md) |

## Document organization

- [Migrations](migrations/): version-specific instructions, including [0.4](migrations/0.4.md) and [0.5](migrations/0.5.md).
- [Reviews and qualification evidence](reviews/): historical reviews, receipts and experiments. Read the relevant dated evidence only; a past result does not qualify a new version.
- [Changelog](../CHANGELOG.md): release history.

Group new documents by responsibility: consumer guides, architecture and decisions, implementation plans and status, operations, migrations, and review evidence. Keep existing paths stable and extend this map when adding a canonical route. Do not duplicate contracts or evidence here.
