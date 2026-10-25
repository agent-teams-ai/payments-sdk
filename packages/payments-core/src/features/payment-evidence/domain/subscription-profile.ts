import type { EvidenceFlag, SubscriptionObservation, SubscriptionItem } from "./model.js";
import { known } from "./observation-fields.js";
import { isSupportedSubscriptionStatus, supportedScheduledChangeAction } from "./vocabulary.js";
type ProfileFields = Partial<Pick<SubscriptionObservation, "collection" | "items">>;
function unsupportedProfile(observation: SubscriptionObservation, fields: ProfileFields): boolean {
  return (
    (known(observation.status) && !isSupportedSubscriptionStatus(observation.status.value)) ||
    (known(observation.scheduledChange) &&
      observation.scheduledChange.value !== null &&
      observation.scheduledChange.value.action !== supportedScheduledChangeAction) ||
    (fields.collection?.presence === "known" && fields.collection.value.kind !== "automatic")
  );
}
function incompleteProfile(observation: SubscriptionObservation, fields: ProfileFields): boolean {
  return (
    !known(observation.status) ||
    !known(observation.scheduledChange) ||
    !known(observation.currentPeriod) ||
    !known(observation.customerRef) ||
    fields.collection?.presence !== "known" ||
    fields.items?.presence !== "known"
  );
}
function itemFlags(item: SubscriptionItem): EvidenceFlag[] {
  const flags: EvidenceFlag[] = [];
  if (!known(item.quantity) || !known(item.billingCycle) || !known(item.trial)) {
    flags.push("incomplete");
  }
  if (
    (known(item.quantity) && item.quantity.value !== 1) ||
    (known(item.billingCycle) &&
      (item.billingCycle.value?.interval !== "month" || item.billingCycle.value.frequency !== 1)) ||
    (known(item.trial) && item.trial.value)
  ) {
    flags.push("unsupported");
  }
  return flags;
}
/** Only the current provider profile can replace these holds; retained contradictions stay separate. */
export function subscriptionProfileFlags(observation: SubscriptionObservation): EvidenceFlag[] {
  const fields: ProfileFields = observation,
    flags: EvidenceFlag[] = [];
  if (unsupportedProfile(observation, fields)) {
    flags.push("unsupported");
  }
  if (incompleteProfile(observation, fields)) {
    flags.push("incomplete");
  }
  if (fields.items?.presence === "known") {
    for (const item of fields.items.value) {
      flags.push(...itemFlags(item));
    }
  }
  return flags;
}
