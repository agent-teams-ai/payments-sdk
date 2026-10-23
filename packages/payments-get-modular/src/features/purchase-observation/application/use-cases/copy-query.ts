import { assertIdentifier } from '@agent-teams/payments-core';
import type { PurchaseQuery } from '../models/projection-models.js';

export function copyQuery(query: PurchaseQuery | undefined): PurchaseQuery | undefined {
  if (query === undefined) {return undefined;}
  assertIdentifier(query.buyerId);
  assertIdentifier(query.intentId);
  return { buyerId: query.buyerId, intentId: query.intentId };
}
