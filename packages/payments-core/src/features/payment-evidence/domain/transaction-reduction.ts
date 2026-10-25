import type {
  PaymentState,
  TransactionObservation,
  CompletionFact,
  PaymentScope,
  AdjustmentObservation,
} from "./model.js";
import { compareTime, exactTime, money } from "./values.js";
import {
  isSupportedAdjustmentAction,
  isSupportedAdjustmentStatus,
  transactionOriginMeaning,
} from "./vocabulary.js";
import { known, semantic, compatible, mergeFields } from "./observation-fields.js";
import { transactionStatusFlags, classifyCompletion } from "./completion.js";
import {
  flag,
  removeFlag,
  setCurrentProfileFlags,
  transactionAggregate,
} from "./evidence-state.js";
import {
  requireSubscriptionReclassification,
  reduceSubscription,
} from "./subscription-reduction.js";

function bindRenewal(state: PaymentState, observation: TransactionObservation): void {
  if (
    state.bindings[observation.transactionRef] ||
    !known(observation.subscriptionRef) ||
    !(
      typeof observation.subscriptionRef.value === "string" &&
      observation.subscriptionRef.value.length > 0
    ) ||
    !known(observation.origin) ||
    transactionOriginMeaning(observation.origin.value) !== "recurring_subscription"
  ) {
    return;
  }
  const matches = Object.values(state.subscriptionBindings).filter((binding) =>
    binding.providerSubscriptionRefs.includes(
      observation.subscriptionRef.presence === "known"
        ? (observation.subscriptionRef.value ?? "")
        : "",
    ),
  );
  if (matches.length !== 1) {
    return;
  }
  const binding = matches[0];
  if (!binding) {
    return;
  }
  state.bindings[observation.transactionRef] = {
    transactionRef: observation.transactionRef,
    intentId: binding.originatingIntentId,
    buyerId: binding.buyerId,
    purpose: "commercial",
    customerRef: binding.customerRef,
  };
}

function markDuplicates(state: PaymentState, fact: CompletionFact): void {
  if (!["initial", "one_time"].includes(fact.classification)) {
    return;
  }
  const candidates = Object.values(state.transactions).filter(
    (aggregate) =>
      aggregate.completion?.intentId === fact.intentId &&
      aggregate.completion.classification === fact.classification,
  );
  if (candidates.length < 2) {
    return;
  }
  const duplicateFlag =
    fact.classification === "initial" ? "duplicate_initial_purchase" : "duplicate_payment";
  for (const aggregate of candidates) {
    if (!aggregate.flags.includes(duplicateFlag)) {
      flag(aggregate, duplicateFlag);
      aggregate.publicationRequired = true;
      aggregate.revision += 1;
    }
  }
  const binding =
    typeof fact.subscriptionBasisId === "string" && fact.subscriptionBasisId.length > 0
      ? state.subscriptionBindings[fact.subscriptionBasisId]
      : undefined;
  if (
    fact.classification === "initial" &&
    binding &&
    !(binding.classificationDecision?.duplicateInitialPurchase === true)
  ) {
    binding.classificationDecision = {
      revision: binding.classificationDecision?.revision ?? 0,
      duplicateInitialPurchase: true,
    };
    requireSubscriptionReclassification(state, binding);
  }
}

function comparableCompletion(fact: CompletionFact): unknown {
  return semantic({
    ...fact,
    classification: fact.classification === "recovery" ? "renewal" : fact.classification,
    source: undefined,
  });
}

export function reduceTransaction(
  state: PaymentState,
  scope: PaymentScope,
  observation: TransactionObservation,
): void {
  exactTime(observation.version);
  const aggregate = transactionAggregate(state, observation.transactionRef);
  let effective = observation;
  const sameVersion = aggregate.observations.find(
    (item) => compareTime(item.version, observation.version) === 0,
  );
  if (sameVersion) {
    if (!compatible(semantic(sameVersion), semantic(observation))) {
      flag(aggregate, "conflict");
      aggregate.publicationRequired = true;
      aggregate.revision += 1;
      return;
    }
    effective = mergeFields(sameVersion, observation);
    aggregate.observations[aggregate.observations.indexOf(sameVersion)] = effective;
  } else {
    aggregate.observations.push(observation);
  }
  if (!aggregate.current || compareTime(effective.version, aggregate.current.version) >= 0) {
    aggregate.current = effective;
    setCurrentProfileFlags(aggregate, transactionStatusFlags(effective));
  }
  bindRenewal(state, effective);
  const classification = classifyCompletion(state, scope, effective);
  if (classification.kind === "commercial") {
    if (aggregate.completion) {
      if (
        !compatible(
          comparableCompletion(aggregate.completion),
          comparableCompletion(classification.fact),
        )
      ) {
        flag(aggregate, "conflict");
      }
    } else {
      aggregate.completion = classification.fact;
    }
    removeFlag(aggregate, "incomplete");
    removeFlag(aggregate, "unresolved_binding");
    if (classification.holdReason) {
      flag(aggregate, classification.holdReason);
    } else if (["renewal", "recovery"].includes(classification.fact.classification)) {
      removeFlag(aggregate, "duplicate_initial_purchase");
    }
    markDuplicates(state, classification.fact);
    const subRef = classification.fact.providerSubscriptionRef;
    const subscription =
      typeof subRef === "string" && subRef.length > 0
        ? state.subscriptions[subRef]?.current
        : undefined;
    if (subscription) {
      reduceSubscription(state, subscription);
    }
  } else if (classification.kind === "held" && transactionStatusFlags(effective).length === 0) {
    flag(aggregate, classification.reason);
  } else if (classification.kind === "management") {
    removeFlag(aggregate, "unresolved_binding");
  }
  aggregate.revision += 1;
  aggregate.publicationRequired = true;
}

export function reduceAdjustment(state: PaymentState, observation: AdjustmentObservation): void {
  exactTime(observation.version);
  money(observation.amount.currency, observation.amount.minorUnits);
  for (const allocation of observation.allocations) {
    money(allocation.amount.currency, allocation.amount.minorUnits);
  }
  const aggregate = transactionAggregate(state, observation.transactionRef),
    current = aggregate.adjustments[observation.adjustmentRef];
  if (current) {
    const order = compareTime(observation.version, current.version);
    if (order < 0) {
      return;
    }
    if (order === 0 && !compatible(semantic(current), semantic(observation))) {
      flag(aggregate, "conflict");
      aggregate.revision += 1;
      aggregate.publicationRequired = true;
      return;
    }
  }
  aggregate.adjustments[observation.adjustmentRef] = observation;
  if (
    observation.allocations.some(
      (allocation) => allocation.amount.currency !== observation.amount.currency,
    )
  ) {
    flag(aggregate, "unsupported");
  }
  if (
    !isSupportedAdjustmentAction(observation.action) ||
    !isSupportedAdjustmentStatus(observation.status)
  ) {
    flag(aggregate, "unsupported");
  }
  aggregate.revision += 1;
  aggregate.publicationRequired = true;
}
