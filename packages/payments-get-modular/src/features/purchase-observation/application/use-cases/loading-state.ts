import type { PurchaseProjectionState, PurchaseQuery } from "../models/projection-models.js";
import { copyQuery } from "./copy-query.js";

export function loading(query: PurchaseQuery | undefined): PurchaseProjectionState {
  const selected = copyQuery(query);
  return selected === undefined ? { status: "idle" } : { status: "loading", query: selected };
}
