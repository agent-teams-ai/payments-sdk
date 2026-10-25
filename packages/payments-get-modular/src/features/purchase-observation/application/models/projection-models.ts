import type {
  CompletionFact,
  EvidenceFlag,
  PurchaseIntentRead,
  TransactionObservation,
} from "@agent-teams/payments-core";

export type PurchaseQuery = Readonly<{ buyerId: string; intentId: string }>;
export type PurchaseTransactionView = Readonly<{
  transactionRef: string;
  revision: number;
  evidenceRevision: number;
  flags: readonly EvidenceFlag[];
  pendingAdverse: readonly string[];
  currentProfileFlags?: readonly EvidenceFlag[];
  retainedFlags?: readonly EvidenceFlag[];
  completion?: Readonly<Pick<CompletionFact, "factId" | "classification" | "total">>;
  current?: Readonly<Pick<TransactionObservation, "version" | "status" | "statusMeaning">>;
}>;
/** A finite display contract. Recursive receipts, provider sources and historical observations stay out. */
export type PurchaseReadValue =
  | Readonly<{
      intent: Readonly<Pick<PurchaseIntentRead, "intentId" | "buyerId" | "offer" | "createdAt">>;
      transactions: readonly PurchaseTransactionView[];
    }>
  | undefined;
export type PurchaseProjectionState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "loading"; query: PurchaseQuery }>
  | Readonly<{ status: "ready"; query: PurchaseQuery; purchase: PurchaseReadValue }>
  | Readonly<{
      status: "failed";
      query: PurchaseQuery;
      error: Readonly<{ code: "purchase_read_failed" }>;
    }>;
export type PurchaseProjectionRecord = Readonly<{ state: PurchaseProjectionState }>;
export type PurchaseProjectionCommands = Readonly<{
  /** Host-authorized selection. Undefined clears the view without starting a query. */
  select: (query: PurchaseQuery | undefined) => undefined;
  /** Re-read the current selection after a durable commit; refreshing an idle view does nothing. */
  refresh: () => undefined;
}>;
