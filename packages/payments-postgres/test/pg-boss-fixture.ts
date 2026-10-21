import { PgBoss } from 'pg-boss';
import { paymentJobRetention } from '@agent-teams/payments-postgres/pg-boss';
import type { PgBossPaymentTransportOptions } from '@agent-teams/payments-postgres/pg-boss';
import { createPaymentSqlExecutor } from '../dist/database.js';

/** Independent vendor administration for integration oracles, never a public runner capability. */
export function paymentBossFixture(options: PgBossPaymentTransportOptions): PgBoss {
  const boss = new PgBoss({
    db: createPaymentSqlExecutor(options.database, options.timeouts), schema: options.jobSchema,
    migrate: false, createSchema: false, supervise: false, schedule: false,
    reindex: false, useListenNotify: false, registerInstance: false, ...paymentJobRetention,
  });
  boss.on('error', options.onError);
  return boss;
}
