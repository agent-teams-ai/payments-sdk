import type {
  Money,
  PurchaseIntent,
  TransactionBinding,
  PaymentScope,
  OfferSnapshot,
  ProviderLine,
  TransactionObservation,
  SubscriptionBinding,
  CompletionFact,
  EvidenceFlag,
  PaymentState,
} from "./model.js";
import type { TransactionOriginMeaning } from "./vocabulary.js";
import { assertIdentifier, compareTime, digest, money } from "./values.js";
import { transactionOriginMeaning } from "./vocabulary.js";
import { known } from "./observation-fields.js";

export function transactionStatusFlags(
  observation: Readonly<{ statusMeaning?: TransactionObservation["statusMeaning"] }>,
): EvidenceFlag[] {
  switch (observation.statusMeaning?.kind) {
    case "completed":
    case "not_completed":
      return [];
    case "unsupported":
      return ["unsupported"];
    case undefined:
    default:
      return ["incomplete"];
  }
}

export function validateOffer(offer: OfferSnapshot, scope: PaymentScope): void {
  for (const id of [offer.offerId, offer.version, offer.policyVersion, offer.applicationId]) {
    assertIdentifier(id);
  }
  if (
    offer.applicationId !== scope.applicationId ||
    !["one_time", "monthly"].includes(offer.profile) ||
    offer.lines.length !== 1 ||
    typeof offer.allowZeroTotal !== "boolean"
  ) {
    throw new TypeError("Unsupported or foreign offer");
  }
  money(offer.currency, "0");
  for (const line of offer.lines) {
    assertIdentifier(line.benefitSlotId);
    assertIdentifier(line.providerPriceRef);
    const quantity: unknown = line.quantity;
    if (quantity !== 1) {
      throw new TypeError("Unsupported offer quantity");
    }
  }
}

function validLine(line: ProviderLine, offer: OfferSnapshot): boolean {
  const expected = offer.lines[0];
  if (
    !expected ||
    line.providerPriceRef !== expected.providerPriceRef ||
    line.quantity !== 1 ||
    line.amount.currency !== offer.currency ||
    !known(line.trial) ||
    line.trial.value ||
    !known(line.proration) ||
    line.proration.value ||
    !known(line.billingCycle)
  ) {
    return false;
  }
  money(line.amount.currency, line.amount.minorUnits);
  assertIdentifier(line.providerLineRef);
  if (BigInt(line.amount.minorUnits) < 0n) {
    return false;
  }
  if (offer.profile === "one_time") {
    return line.billingCycle.value === null && (!known(line.period) || line.period.value === null);
  }
  const cycle = line.billingCycle.value;
  if (
    cycle?.interval !== "month" ||
    cycle.frequency !== 1 ||
    !known(line.period) ||
    line.period.value === null
  ) {
    return false;
  }
  return compareTime(line.period.value.startsAt, line.period.value.endsAt) < 0;
}

export type Classification =
  | Readonly<{ kind: "commercial"; fact: CompletionFact; holdReason?: EvidenceFlag }>
  | Readonly<{ kind: "management" }>
  | Readonly<{ kind: "held"; reason: EvidenceFlag }>
  | Readonly<{ kind: "not_completed" }>;

type CompletionFields = Readonly<{
  lines: readonly ProviderLine[];
  total: Money;
  currency: string;
  customerRef: string | null;
}>;
type ProfileClassification =
  | Readonly<{ kind: "held"; reason: EvidenceFlag }>
  | Readonly<{
      kind: "classified";
      classification: CompletionFact["classification"];
      subscription?: Readonly<{ bindingId: string; providerSubscriptionRef: string }>;
      holdReason?: EvidenceFlag;
    }>;
function completionFields(
  observation: TransactionObservation,
  offer: OfferSnapshot,
): CompletionFields | undefined {
  if (
    !known(observation.lines) ||
    !known(observation.total) ||
    !known(observation.currency) ||
    !known(observation.origin) ||
    !known(observation.customerRef) ||
    (offer.profile === "monthly" && !known(observation.subscriptionRef))
  ) {
    return;
  }
  if (
    observation.lines.value.some(
      (line) =>
        !known(line.billingCycle) ||
        !known(line.trial) ||
        !known(line.proration) ||
        (offer.profile === "monthly" && !known(line.period)),
    )
  ) {
    return;
  }
  return {
    lines: observation.lines.value,
    total: observation.total.value,
    currency: observation.currency.value,
    customerRef: observation.customerRef.value,
  };
}
function completionHold(
  observation: TransactionObservation,
  fields: CompletionFields,
  intent: PurchaseIntent,
  binding: TransactionBinding,
  origin: TransactionOriginMeaning | undefined,
): EvidenceFlag | undefined {
  const offer = intent.offer;
  if (
    fields.currency !== offer.currency ||
    fields.total.currency !== offer.currency ||
    fields.lines.length !== offer.lines.length ||
    !fields.lines.every((line) => validLine(line, offer))
  ) {
    return "catalog_mismatch";
  }
  money(fields.total.currency, fields.total.minorUnits);
  if (
    BigInt(fields.total.minorUnits) < 0n ||
    (!offer.allowZeroTotal && fields.total.minorUnits === "0")
  ) {
    return "catalog_mismatch";
  }
  if (fields.customerRef === null) {
    return "incomplete";
  }
  if (binding.customerRef !== null && binding.customerRef !== fields.customerRef) {
    return "ownership_mismatch";
  }
  if (
    known(observation.intentCorrelation) &&
    observation.intentCorrelation.value !== null &&
    observation.intentCorrelation.value !== intent.intentId
  ) {
    return "ownership_mismatch";
  }
  if (origin === "unsupported_profile") {
    return "unsupported";
  }
  return;
}
function bindSubscriptionStream(
  subscription: SubscriptionBinding,
  ref: string,
  customerRef: string | null,
): boolean {
  if (!subscription.providerSubscriptionRefs.includes(ref)) {
    subscription.providerSubscriptionRefs.push(ref);
  }
  if (subscription.customerRef !== null && subscription.customerRef !== customerRef) {
    return false;
  }
  subscription.customerRef ??= customerRef;
  if (
    !(
      typeof subscription.selectedSubscriptionRef === "string" &&
      subscription.selectedSubscriptionRef.length > 0
    )
  ) {
    subscription.selectedSubscriptionRef = ref;
  }
  return true;
}
function renewalHold(
  state: PaymentState,
  subscription: SubscriptionBinding,
  intentId: string,
  ref: string,
): EvidenceFlag | undefined {
  const duplicateInitial =
    subscription.classificationDecision?.duplicateInitialPurchase ??
    Object.values(state.transactions).some(
      (candidate) =>
        candidate.completion?.intentId === intentId &&
        candidate.flags.includes("duplicate_initial_purchase"),
    );
  return subscription.selectedSubscriptionRef !== ref ||
    (duplicateInitial && !subscription.streamSelection)
    ? "duplicate_initial_purchase"
    : undefined;
}
function classifyMonthly(
  state: PaymentState,
  observation: TransactionObservation,
  intent: PurchaseIntent,
  binding: TransactionBinding,
  origin: TransactionOriginMeaning | undefined,
): ProfileClassification {
  const ref = known(observation.subscriptionRef) ? observation.subscriptionRef.value : null;
  if (
    !(typeof ref === "string" && ref.length > 0) ||
    !(typeof intent.subscriptionBasisId === "string" && intent.subscriptionBasisId.length > 0)
  ) {
    return { kind: "held", reason: "incomplete" };
  }
  const subscription = state.subscriptionBindings[intent.subscriptionBasisId];
  if (!subscription) {
    return { kind: "held", reason: "unresolved_binding" };
  }
  const classification =
    origin === "recurring_subscription"
      ? binding.purpose === "recovery"
        ? "recovery"
        : "renewal"
      : "initial";
  if (classification === "initial" && origin !== "checkout" && origin !== "initial_subscription") {
    return { kind: "held", reason: "unsupported" };
  }
  const customerRef = known(observation.customerRef) ? observation.customerRef.value : null;
  if (!bindSubscriptionStream(subscription, ref, customerRef)) {
    return { kind: "held", reason: "ownership_mismatch" };
  }
  const holdReason =
    classification === "renewal" || classification === "recovery"
      ? renewalHold(state, subscription, intent.intentId, ref)
      : undefined;
  return {
    kind: "classified",
    classification,
    subscription: { bindingId: subscription.bindingId, providerSubscriptionRef: ref },
    ...(holdReason ? { holdReason } : {}),
  };
}
function classifyOneTime(
  observation: TransactionObservation,
  origin: TransactionOriginMeaning | undefined,
): ProfileClassification {
  if (
    (known(observation.subscriptionRef) && observation.subscriptionRef.value !== null) ||
    origin !== "checkout"
  ) {
    return { kind: "held", reason: "unsupported" };
  }
  return { kind: "classified", classification: "one_time" };
}
function completionLines(
  lines: readonly ProviderLine[],
  offer: OfferSnapshot,
): CompletionFact["lines"] {
  return lines.map((line) => {
    const benefitSlotId = offer.lines.find(
      (expected) => expected.providerPriceRef === line.providerPriceRef,
    )?.benefitSlotId;
    if (!(typeof benefitSlotId === "string" && benefitSlotId.length > 0)) {
      throw new Error("Validated line has no benefit");
    }
    const period = known(line.period) ? line.period.value : null;
    return {
      providerLineRef: line.providerLineRef,
      benefitSlotId,
      amount: line.amount,
      quantity: 1,
      ...(period === null ? {} : { period }),
    };
  });
}
/** Final server completed classifier. Neither amount, customer nor correlation alone proves ownership. */
export function classifyCompletion(
  state: PaymentState,
  scope: PaymentScope,
  observation: TransactionObservation,
): Classification {
  const statusHold = transactionStatusFlags(observation)[0];
  if (statusHold) {
    return { kind: "held", reason: statusHold };
  }
  if (observation.statusMeaning.kind !== "completed") {
    return { kind: "not_completed" };
  }
  const binding = state.bindings[observation.transactionRef];
  if (!binding) {
    return { kind: "held", reason: "unresolved_binding" };
  }
  if (binding.purpose === "payment_method") {
    return { kind: "management" };
  }
  const origin = known(observation.origin)
    ? transactionOriginMeaning(observation.origin.value)
    : undefined;
  if (origin === "payment_method") {
    return { kind: "management" };
  }
  const intent = state.intents[binding.intentId];
  if (!intent) {
    return { kind: "held", reason: "unresolved_binding" };
  }
  const fields = completionFields(observation, intent.offer);
  if (!fields) {
    return { kind: "held", reason: "incomplete" };
  }
  const reason = completionHold(observation, fields, intent, binding, origin);
  if (reason) {
    return { kind: "held", reason };
  }
  const profile =
    intent.offer.profile === "monthly"
      ? classifyMonthly(state, observation, intent, binding, origin)
      : classifyOneTime(observation, origin);
  if (profile.kind === "held") {
    return profile;
  }
  binding.customerRef ??= fields.customerRef;
  const { classification, subscription, holdReason } = profile;
  const lines = completionLines(fields.lines, intent.offer);
  return {
    kind: "commercial",
    ...(holdReason ? { holdReason } : {}),
    fact: {
      factId: digest([
        scope.provider,
        scope.paymentAccountId,
        scope.environment,
        observation.transactionRef,
        "completion",
      ]),
      scope,
      transactionRef: observation.transactionRef,
      intentId: intent.intentId,
      buyerId: intent.buyerId,
      ...(subscription
        ? {
            subscriptionBasisId: subscription.bindingId,
            providerSubscriptionRef: subscription.providerSubscriptionRef,
          }
        : {}),
      classification,
      offer: intent.offer,
      total: fields.total,
      lines,
      source: observation.source,
    },
  };
}
