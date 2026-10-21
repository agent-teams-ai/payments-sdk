import { PgBoss } from 'pg-boss';
import { paymentJobRetention } from '../dist/index.js';
import type { PgBossPaymentTransportOptions } from '../dist/index.js';
import { createPaymentSqlExecutor } from '../dist/database.js';

/** Independent vendor administration for integration oracles, never a public runner capability. */
export function paymentBossFixture(options: PgBossPaymentTransportOptions): PgBoss {
  const boss = new PgBoss({
    db: createPaymentSqlExecutor(options.pool, options.timeouts), schema: options.jobSchema,
    migrate: false, createSchema: false, supervise: false, schedule: false,
    reindex: false, useListenNotify: false, registerInstance: false, ...paymentJobRetention,
  });
  boss.on('error', options.onError);
  return boss;
}
