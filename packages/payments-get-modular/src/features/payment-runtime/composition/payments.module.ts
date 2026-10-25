import { createPayments } from "@agent-teams/payments-core";
import { implement } from "@get-modular/assembly";
import { scoped } from "@get-modular/resources";
import { createRuntimeFacets } from "../application/use-cases/create-runtime-facets.js";
import { paymentsDeclaration } from "./payments.declaration.js";
import {
  Checkout,
  Delivery,
  Management,
  Processing,
  Read,
  type PaymentsCapabilities,
} from "./payment-runtime.contracts.js";

/** Inert entry; resource acquisition and physical drain belong to each run. */
export const paymentsModule = implement<PaymentsCapabilities>()(
  paymentsDeclaration,
  async ({ configuration }, { resources }) => {
    const owned = await resources.setup({
      name: "runtime",
      setup: () => createRuntimeFacets(createPayments(configuration), resources.signal),
      cleanup: (value) => value.close(),
    });
    const instance = owned.instance;
    return {
      instance,
      capabilities: {
        [Checkout.id]: instance.checkout,
        [Read.id]: instance.read,
        [Management.id]: instance.management,
        [Processing.id]: instance.processing,
        [Delivery.id]: instance.delivery,
      },
    };
  },
  scoped,
);
