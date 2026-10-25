export type PaymentScope = Readonly<{
  applicationId: string;
  provider: string;
  paymentAccountId: string;
  environment: "sandbox" | "production";
}>;
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | {
      readonly [key: string]: JsonValue;
    };
export type Money = Readonly<{
  currency: string;
  minorUnits: string;
}>;
export type ExactTime = Readonly<{
  original: string;
  seconds: string;
  fraction: string;
}>;
export type Period = Readonly<{
  startsAt: string;
  endsAt: string;
}>;
export type ErrorCode =
  | "validation"
  | "unauthorized_configuration"
  | "permission_denied"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "ownership_mismatch"
  | "catalog_mismatch"
  | "unclassified_external_state";
export type ProviderResult<T> =
  | Readonly<{
      kind: "succeeded";
      value: T;
    }>
  | Readonly<{
      kind: "rejected";
      code: ErrorCode;
      diagnostic?: Readonly<{
        requestId?: string;
        providerCode?: string;
      }>;
    }>
  | Readonly<{
      kind: "outcome_unknown";
      diagnostic?: Readonly<{
        requestId?: string;
        providerCode?: string;
      }>;
    }>
  | Readonly<{
      kind: "unsupported";
      capability: string;
    }>;
