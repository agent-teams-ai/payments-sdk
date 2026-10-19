/**
 * Exact declaration repair for pg-boss 12.38.0 (MIT; see the distributed NOTICE).
 * Upstream commit 2c1005b744952360e999c2000e155a1bfebb8951 marks these interfaces internal,
 * then emits declarations which still reference them while stripInternal removes their definitions.
 * This augmentation restores the source types; it does not alter vendor files or runtime behavior.
 * Requalify/remove on upgrade. Packed NodeNext and Bundler consumers keep skipLibCheck:false.
 */
import type { Clock, ConstructorOptions } from 'pg-boss/dist/types.js';

declare module 'pg-boss/dist/types.js' {
  interface CompatibilityFlags {
    noSkipLocked?: boolean;
    noMultiMutationCte?: boolean;
    noTablePartitioning?: boolean;
    noDeferrableConstraints?: boolean;
    noAdvisoryLocks?: boolean;
    noCoveringIndexes?: boolean;
    inlineTableIndexes?: boolean;
    noAddColumnBackfill?: boolean;
    noListenNotify?: boolean;
    noIndexProgressView?: boolean;
    noReindex?: boolean;
    noMonitorVacuum?: boolean;
    noTransactionalHeartbeat?: boolean;
  }

  interface ResolvedConstructorOptions extends ConstructorOptions, CompatibilityFlags {
    schema: string;
    clock: Clock;
    monitorIntervalSeconds: number;
    cronMonitorIntervalSeconds: number;
    maintenanceIntervalSeconds: number;
    bamIntervalSeconds: number;
    flowIntervalSeconds: number;
    reindexIntervalSeconds: number;
    registerInstance: boolean;
    instanceHeartbeatSeconds: number;
  }
}
