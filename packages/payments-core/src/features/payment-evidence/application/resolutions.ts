import type { PaymentOperationRead } from "./models/read-models.js";
import { operationSnapshot } from "./read-snapshots.js";
import type { PaymentOperation } from "../domain/model.js";
import type { OperationResult, OperationCommit, ResolveUnknown } from "./models/payment-models.js";
import { assertIdentifier } from "../domain/values.js";
import type { PaymentRuntimeContext } from "./runtime-context.js";
import { unavailable } from "./runtime-context.js";
import { operationCommit, resultState, successfulOutcomeChanges } from "./outcomes.js";

function resolutionRejection(
  command: ResolveUnknown,
  operation: PaymentOperation,
): "conflict" | "validation" | undefined {
  if (command.action === "retry" && operation.attempts.length >= 100) {
    return "conflict";
  }
  if (command.action === "retry" && command.acceptedDuplicateRisk !== true) {
    return "validation";
  }
  if (command.action === "bind_outcome" && !command.outcome) {
    return "validation";
  }
  return;
}

export async function resolveUnknownOperation(
  ctx: PaymentRuntimeContext,
  command: ResolveUnknown,
): Promise<OperationResult<PaymentOperationRead>> {
  const { store, scope, now } = ctx;
  if (!ctx.accepting) {
    return unavailable;
  }
  for (const value of [command.actorId, command.auditRef, command.reason]) {
    assertIdentifier(value);
  }
  const input = await store.loadOperation(scope, command.operationId);
  if (!input) {
    return { kind: "rejected", code: "ownership_mismatch" };
  }
  if (
    input.operation.revision !== command.expectedRevision ||
    !["dispatch_started", "outcome_unknown"].includes(input.operation.state)
  ) {
    return { kind: "rejected", code: "conflict" };
  }
  const rejection = resolutionRejection(command, input.operation);
  if (rejection) {
    return { kind: "rejected", code: rejection };
  }
  const operation = structuredClone(input.operation);
  operation.audits.push({
    actorId: command.actorId,
    auditRef: command.auditRef,
    reason: command.reason,
    acceptedDuplicateRisk: command.acceptedDuplicateRisk === true,
    at: now(),
    action: command.action,
  });
  operation.revision += 1;
  if (command.action === "retry") {
    operation.state = "prepared";
    delete operation.result;
  } else if (command.action === "bind_outcome" && command.outcome) {
    operation.result = command.outcome;
    operation.state = resultState(command.outcome);
  } else {
    operation.state = "outcome_unknown";
  }
  let changes: Pick<OperationCommit, "binding" | "intent"> = {};
  if (command.action === "bind_outcome" && command.outcome?.kind === "succeeded") {
    try {
      changes = successfulOutcomeChanges(input, command.outcome.value);
    } catch (error) {
      if (error instanceof TypeError) {
        return { kind: "rejected", code: "validation" };
      }
      throw error;
    }
  }
  const committed = await store.commitOperation(scope, {
    ...operationCommit(input, operation),
    ...changes,
  });
  return committed.kind === "committed"
    ? { kind: "succeeded", value: operationSnapshot(operation) }
    : committed.kind === "recovery_fenced"
      ? unavailable
      : { kind: "rejected", code: "conflict" };
}
