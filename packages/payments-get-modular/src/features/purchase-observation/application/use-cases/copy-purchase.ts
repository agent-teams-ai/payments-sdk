import type { PurchaseReadPort } from "../ports/purchase-reader.js";
import type { PurchaseReadValue } from "../models/projection-models.js";

export function copyPurchase(
  purchase: Awaited<ReturnType<PurchaseReadPort["readPurchase"]>>,
): PurchaseReadValue {
  if (purchase === undefined) {
    return undefined;
  }
  const view = {
    intent: {
      intentId: purchase.intent.intentId,
      buyerId: purchase.intent.buyerId,
      offer: purchase.intent.offer,
      createdAt: purchase.intent.createdAt,
    },
    transactions: purchase.transactions.map((transaction) => ({
      transactionRef: transaction.transactionRef,
      revision: transaction.revision,
      evidenceRevision: transaction.evidenceRevision,
      flags: transaction.flags,
      pendingAdverse: transaction.pendingAdverse,
      ...(transaction.currentProfileFlags === undefined
        ? {}
        : { currentProfileFlags: transaction.currentProfileFlags }),
      ...(transaction.retainedFlags === undefined
        ? {}
        : { retainedFlags: transaction.retainedFlags }),
      ...(transaction.completion === undefined
        ? {}
        : {
            completion: {
              factId: transaction.completion.factId,
              classification: transaction.completion.classification,
              total: transaction.completion.total,
            },
          }),
      ...(transaction.current === undefined
        ? {}
        : {
            current: {
              version: transaction.current.version,
              status: transaction.current.status,
              statusMeaning: transaction.current.statusMeaning,
            },
          }),
    })),
  } satisfies Exclude<PurchaseReadValue, undefined>;
  // Clone only the finite consumer shape, including every retained nested array and record. No
  // borrowed core object is frozen, and receipt/source graphs never become observation values.
  return structuredClone(view);
}
