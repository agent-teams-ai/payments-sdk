import assert from "node:assert/strict";
import test from "node:test";
import type { CapabilitiesOf } from "@get-modular/assembly";
import type {
  PaymentsConfiguration,
  Checkout,
  Read,
  Management,
  Processing,
  Delivery,
  PaymentsCapabilities,
} from "../../src/index.ts";
import type {
  PurchaseReader,
  ProjectionConfiguration,
  ProjectionView,
  ProjectionCommands,
  ProjectionRenderer,
  ProjectionDisplay,
  PurchaseObservationCapabilities,
} from "../../src/observation/index.ts";

// Descriptor unions retain the source fragments; the final interface expands each
// concrete source independently instead of traversing inherited named maps.
type PaymentContracts =
  | typeof PaymentsConfiguration
  | typeof Checkout
  | typeof Read
  | typeof Management
  | typeof Processing
  | typeof Delivery;
type ObservationContracts =
  | typeof PurchaseReader
  | typeof ProjectionConfiguration
  | typeof ProjectionView
  | typeof ProjectionCommands
  | typeof ProjectionRenderer
  | typeof ProjectionDisplay;
interface CombinedCapabilities
  extends CapabilitiesOf<PaymentContracts>, CapabilitiesOf<ObservationContracts> {}

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const allKeys: Equal<
  keyof CombinedCapabilities,
  keyof PaymentsCapabilities | keyof PurchaseObservationCapabilities
> = true;
const allEntries: Equal<
  CombinedCapabilities,
  PaymentsCapabilities & PurchaseObservationCapabilities
> = true;

void test("descriptor fragments preserve both actual Payments maps and complete entry metadata", () => {
  assert.deepEqual([allKeys, allEntries], [true, true]);
});
