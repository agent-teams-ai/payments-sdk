import type {
  EvidenceFlag,
  ProfileEvidenceHolds,
  TransactionAggregate,
  SubscriptionAggregate,
  PaymentState,
} from "./model.js";

type FlaggedEvidence = ProfileEvidenceHolds & { flags: EvidenceFlag[] };

export function flag(target: FlaggedEvidence, value: EvidenceFlag): void {
  if (target.retainedFlags && !target.retainedFlags.includes(value)) {
    target.retainedFlags.push(value);
  }
  if (!target.flags.includes(value)) {
    target.flags.push(value);
  }
}

export function removeFlag(target: FlaggedEvidence, value: EvidenceFlag): void {
  if (target.retainedFlags) {
    target.retainedFlags = target.retainedFlags.filter((item) => item !== value);
  }
  target.flags = target.flags.filter(
    (item) => item !== value || target.currentProfileFlags?.includes(item) === true,
  );
}

export function setCurrentProfileFlags(target: FlaggedEvidence, flags: EvidenceFlag[]): void {
  // Existing persisted flags and independently added controls remain historical. A matching
  // historical flag must survive even when a current profile hold with the same name resolves.
  target.retainedFlags = [
    ...new Set([
      ...(target.retainedFlags ?? []),
      ...target.flags.filter((item) => !(target.currentProfileFlags?.includes(item) === true)),
    ]),
  ];
  target.currentProfileFlags = [...new Set(flags)];
  target.flags = [...new Set([...target.retainedFlags, ...target.currentProfileFlags])];
}

export function transactionAggregate(state: PaymentState, ref: string): TransactionAggregate {
  return (state.transactions[ref] ??= {
    transactionRef: ref,
    revision: 0,
    evidenceRevision: 0,
    observations: [],
    adjustments: {},
    pendingAdverse: [],
    flags: [],
    publicationRequired: false,
  });
}

export function subscriptionAggregate(state: PaymentState, ref: string): SubscriptionAggregate {
  return (state.subscriptions[ref] ??= {
    subscriptionRef: ref,
    revision: 0,
    evidenceRevision: 0,
    flags: [],
    publicationRequired: false,
  });
}
