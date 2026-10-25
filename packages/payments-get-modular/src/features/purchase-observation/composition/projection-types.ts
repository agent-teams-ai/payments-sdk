import type { ListenerError, ReadonlyStore } from "@get-modular/observation";
import type {
  PurchaseProjectionRecord,
  PurchaseProjectionCommands,
  PurchaseQuery,
} from "../application/models/projection-models.js";
import type { PurchaseReadPort } from "../application/ports/purchase-reader.js";

export type PurchaseProjection = Readonly<{
  view: ReadonlyStore<PurchaseProjectionRecord>;
  commands: PurchaseProjectionCommands;
}>;
export type PurchaseProjectionOptions = Readonly<{
  initialQuery: PurchaseQuery | undefined;
  /** Receives real observation callback/source-close reports. The Host's sink must not throw. */
  reportError: (report: ListenerError) => undefined;
}>;
export type PurchaseProjectionConfiguration = PurchaseProjectionOptions &
  Readonly<{ read: PurchaseReadPort }>;
