import type { PgPolicy, PgPolicyConfig, PgRole, PgRoleConfig } from 'drizzle-orm/pg-core';
import type { CockroachPolicy, CockroachPolicyConfig, CockroachRole, CockroachRoleConfig } from 'drizzle-orm/cockroach-core';

type Accept<Condition extends true> = Condition;
type Reject<Condition extends false> = Condition;

/** Strict compile-time probes: optional undefined is accepted without weakening actual field types. */
export type DrizzleDeclarationContract = [
  Accept<{ as: undefined; for: undefined; to: undefined; using: undefined; withCheck: undefined } extends PgPolicyConfig ? true : false>,
  Accept<{ createDb: undefined; createRole: undefined; inherit: undefined } extends PgRoleConfig ? true : false>,
  Accept<{ as: undefined; for: undefined; to: undefined; using: undefined; withCheck: undefined } extends CockroachPolicyConfig ? true : false>,
  Accept<{ createDb: undefined; createRole: undefined } extends CockroachRoleConfig ? true : false>,
  Accept<PgPolicy extends PgPolicyConfig ? true : false>,
  Accept<PgRole extends PgRoleConfig ? true : false>,
  Accept<CockroachPolicy extends CockroachPolicyConfig ? true : false>,
  Accept<CockroachRole extends CockroachRoleConfig ? true : false>,
  Reject<{ as: 'unsupported' } extends PgPolicyConfig ? true : false>,
  Reject<{ for: 'merge' } extends PgPolicyConfig ? true : false>,
  Reject<{ using: string } extends PgPolicyConfig ? true : false>,
  Reject<{ createDb: number } extends PgRoleConfig ? true : false>,
  Reject<{ createRole: string } extends CockroachRoleConfig ? true : false>,
];
