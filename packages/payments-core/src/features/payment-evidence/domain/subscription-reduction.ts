import type {
  PaymentState,
  SubscriptionObservation,
  SubscriptionBinding,
  SubscriptionAggregate,
  EvidenceFlag,
} from "./model.js";
import { canonicalJson, compareTime, exactTime } from "./values.js";
import { known, semantic, compatible, mergeFields } from "./observation-fields.js";
import { subscriptionProfileFlags } from "./subscription-profile.js";
import {
  flag,
  removeFlag,
  setCurrentProfileFlags,
  subscriptionAggregate,
} from "./evidence-state.js";

export function subscriptionOwnershipMismatch(
  state: PaymentState,
  observation: SubscriptionObservation,
): boolean {
  const customer = observation.customerRef;
  return (
    known(customer) &&
    Object.values(state.subscriptionBindings).some(
      (binding) =>
        binding.providerSubscriptionRefs.includes(observation.subscriptionRef) &&
        binding.customerRef !== null &&
        binding.customerRef !== customer.value,
    )
  );
}

export function requireSubscriptionReclassification(
  state: PaymentState,
  binding: SubscriptionBinding,
): void {
  const revision = (binding.classificationDecision?.revision ?? 0) + 1;
  binding.classificationDecision = {
    revision,
    duplicateInitialPurchase: binding.classificationDecision?.duplicateInitialPurchase ?? false,
  };
  state.reclassifications[binding.bindingId] = {
    bindingId: binding.bindingId,
    decisionRevision: revision,
    complete: false,
  };
}

export function reduceSubscription(
  state: PaymentState,
  observation: SubscriptionObservation,
): void {
  exactTime(observation.version);
  const aggregate = subscriptionAggregate(state, observation.subscriptionRef);
  if (
    known(observation.currentPeriod) &&
    observation.currentPeriod.value &&
    compareTime(observation.currentPeriod.value.startsAt, observation.currentPeriod.value.endsAt) >=
      0
  ) {
    throw new TypeError("Invalid subscription period");
  }
  if (known(observation.scheduledChange) && observation.scheduledChange.value) {
    exactTime(observation.scheduledChange.value.effectiveAt);
  }
  const newOwnershipHold =
    subscriptionOwnershipMismatch(state, observation) &&
    !aggregate.flags.includes("ownership_mismatch");
  if (newOwnershipHold) {
    flag(aggregate, "ownership_mismatch");
  }
  const current = aggregate.current;
  if (current) {
    const order = compareTime(observation.version, current.version);
    if (order < 0) {
      if (newOwnershipHold) {
        aggregate.revision += 1;
        aggregate.publicationRequired = true;
      }
      return;
    }
    if (order === 0 && !compatible(semantic(current), semantic(observation))) {
      flag(aggregate, "conflict");
      aggregate.revision += 1;
      aggregate.publicationRequired = true;
      return;
    }
    if (order === 0) {
      observation = mergeFields(current, observation);
    } else {
      aggregate.lastKnown = current;
    }
  }
  aggregate.current = observation;
  const profileFlags = subscriptionProfileFlags(observation);
  applySubscriptionBindings(state, observation, aggregate, profileFlags);
  setCurrentProfileFlags(aggregate, profileFlags);
  aggregate.revision += 1;
  aggregate.publicationRequired = true;
}

function applySubscriptionBindings(
  state: PaymentState,
  observation: SubscriptionObservation,
  aggregate: SubscriptionAggregate,
  profileFlags: EvidenceFlag[],
): void {
  const profileFields: Partial<Pick<SubscriptionObservation, "collection" | "items">> = observation;
  const bindings = Object.values(state.subscriptionBindings).filter((binding) =>
    binding.providerSubscriptionRefs.includes(observation.subscriptionRef),
  );
  if (bindings.length !== 1) {
    flag(aggregate, "unresolved_binding");
  } else {
    removeFlag(aggregate, "unresolved_binding");
    const binding = bindings[0];
    if (
      binding &&
      known(observation.customerRef) &&
      binding.customerRef !== null &&
      observation.customerRef.value !== binding.customerRef
    ) {
      flag(aggregate, "ownership_mismatch");
    }
    if (
      binding &&
      profileFields.items?.presence === "known" &&
      canonicalJson(profileFields.items.value.map((item) => item.providerPriceRef).toSorted()) !==
        canonicalJson(binding.offer.lines.map((line) => line.providerPriceRef).toSorted())
    ) {
      profileFlags.push("catalog_mismatch");
    }
  }
}
