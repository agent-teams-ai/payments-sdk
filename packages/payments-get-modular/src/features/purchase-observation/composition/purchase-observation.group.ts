import { group } from "@get-modular/assembly";
import { purchaseProjectionDisplayModule } from "./purchase-projection-display.module.js";
import { purchaseProjectionModule } from "./purchase-projection.module.js";

export const purchaseObservationGroup = group("purchase-observation", [
  purchaseProjectionDisplayModule,
  purchaseProjectionModule,
]);
