import type { PurchaseRead } from '@agent-teams/payments-core';

/** Borrowed query only: no financial command, delivery or lifecycle authority. */
export type PurchaseReadPort = Readonly<{ readPurchase: (buyerId: string, intentId: string) => Promise<PurchaseRead | undefined> }>;
