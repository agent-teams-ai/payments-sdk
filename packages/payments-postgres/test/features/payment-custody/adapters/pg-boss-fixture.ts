import { PgBoss } from 'pg-boss';
import { paymentJobRetention } from '../../../../src/job-transport.ts';
import type { PgBossPaymentTransportOptions } from '../../../../src/job-transport.ts';
import { createPaymentSqlExecutor } from '../../../../src/features/payment-custody/adapters/database.ts';
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
