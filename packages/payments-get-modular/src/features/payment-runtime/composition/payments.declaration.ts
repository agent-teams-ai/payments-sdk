import { declareModule } from "@get-modular/assembly";
import { required } from "@get-modular/core";
import {
  Checkout,
  Delivery,
  Management,
  PaymentsConfiguration,
  Processing,
  Read,
} from "./payment-runtime.contracts.js";
export const paymentsDeclaration = declareModule({
  moduleId: "agent-teams/payments/runtime",
  implementationId: "agent-teams/payments/runtime/default",
  owner: { authority: "agent-teams", path: ["payments"] },
  provides: [
    Checkout.provide(),
    Read.provide(),
    Management.provide(),
    Processing.provide(),
    Delivery.provide(),
  ],
  slots: [PaymentsConfiguration.slot("configuration", required())],
});
