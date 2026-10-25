import { implement } from "@get-modular/assembly";
import { scoped } from "@get-modular/resources";
import { purchaseProjectionDeclaration } from "./purchase-projection.declaration.js";
import {
  ProjectionView,
  ProjectionCommands,
  type PurchaseObservationCapabilities,
} from "./purchase-observation.contracts.js";
import { createPurchaseProjection } from "./purchase-projection.js";
export const purchaseProjectionModule = implement<PurchaseObservationCapabilities>()(
  purchaseProjectionDeclaration,
  async ({ read, configuration }, { resources }) => {
    const instance = createPurchaseProjection({ ...configuration, read }, { resources });
    return {
      instance,
      capabilities: {
        [ProjectionView.id]: instance.view,
        [ProjectionCommands.id]: instance.commands,
      },
    };
  },
  scoped,
);
