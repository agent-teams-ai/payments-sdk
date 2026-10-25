import type {
  PaymentsCheckout,
  PaymentsRead,
  PaymentsProcessing,
  PaymentsModule,
} from "../../src/index.ts";

/** Compile-time consumer boundary; intentionally never invoked by runtime tests. */
export function readFacetDoesNotCarryCommands(
  read: PaymentsRead,
  checkout: PaymentsCheckout,
  module: PaymentsModule,
): void {
  void read.readOperation("operation");
  void checkout.startPurchase({ buyerId: "buyer", offerId: "offer", requestKey: "request" });
  // @ts-expect-error read-only consumers cannot create purchases
  void ("startPurchase" satisfies keyof PaymentsRead);
  // @ts-expect-error the Host retains resource control outside the module
  void ("control" satisfies keyof typeof module);
  // @ts-expect-error checkout consumers do not receive processing authority
  void ("processInbox" satisfies keyof PaymentsCheckout);
}

/** Audited recovery stays on the managed runtime, with read and mutation authority segregated. */
export function subscriptionSelectionSurface(
  read: PaymentsRead,
  processing: PaymentsProcessing,
  command: Parameters<PaymentsProcessing["selectSubscriptionStream"]>[0],
): void {
  void read.readSubscriptionSelection(
    command.buyerId,
    command.bindingId,
    command.providerSubscriptionRef,
  );
  void processing.selectSubscriptionStream(command);
  // @ts-expect-error read-only consumers cannot authorize a support-stream change
  void ("selectSubscriptionStream" satisfies keyof PaymentsRead);
}

/** Function properties reject implementations with stronger inbound preconditions. */
export function capabilityVariance(checkout: PaymentsCheckout, read: PaymentsRead): void {
  const strongerCheckout = (
    command: Parameters<PaymentsCheckout["startPurchase"]>[0] & { authorization: string },
  ) => checkout.startPurchase(command);
  // @ts-expect-error a replacement must accept every declared checkout command
  const invalidCheckout: PaymentsCheckout = { startPurchase: strongerCheckout };
  const narrowerRead = (buyerId: "one-authorized-buyer", intentId: string) =>
    read.readPurchase(buyerId, intentId);
  // @ts-expect-error a replacement must accept the full declared buyer identifier domain
  const invalidRead: PaymentsRead = { ...read, readPurchase: narrowerRead };
  void invalidCheckout;
  void invalidRead;
}

/** Read results are detached, deeply readonly snapshots without private publication state. */
export async function publicReadModels(read: PaymentsRead): Promise<void> {
  const purchase = await read.readPurchase("buyer", "intent");
  if (purchase !== undefined) {
    // @ts-expect-error intent custody does not escape through the read facet
    purchase.intent.transactionRefs[0] = "extra";
    const transaction = purchase.transactions[0];
    if (transaction !== undefined) {
      // @ts-expect-error aggregate publication work stays private
      void transaction.publicationRequired;
      // @ts-expect-error public evidence flags cannot mutate owner state
      transaction.flags[0] = "duplicate_initial_purchase";
    }
  }
  const selection = await read.readSubscriptionSelection("buyer", "binding", "subscription");
  if (selection !== undefined) {
    void selection.version;
    // @ts-expect-error storage read-set tuples do not cross the application boundary
    void selection.expectedReadSet;
  }
}
