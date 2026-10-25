import { declareModule } from "@get-modular/assembly";
import { PurchaseReader } from "./purchase-observation.contracts.js";
export const purchaseReadDeclaration = declareModule({
  moduleId: `agent-teams/payments/observation/host-reader`,
  implementationId: `agent-teams/payments/observation/host-reader/input`,
  owner: { authority: "agent-teams", path: ["payments", "observation"] },
  provides: [PurchaseReader.provide()],
  slots: [],
});
