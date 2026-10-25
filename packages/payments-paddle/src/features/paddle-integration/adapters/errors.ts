import { ApiError } from "@paddle/paddle-node-sdk";
import type { ErrorCode } from "@agent-teams/payments-core";
import type { ProviderResult } from "@agent-teams/payments-core/provider";

/**
 * Only an enumerated documented rejection establishes a mutation's known non-success.
 * https://developer.paddle.com/errors/ — unknown/new codes remain outcome_unknown.
 */
const rejections: Readonly<Record<string, ErrorCode>> = {
  authentication_missing: "unauthorized_configuration",
  authentication_invalid: "unauthorized_configuration",
  authentication_malformed: "unauthorized_configuration",
  forbidden: "permission_denied",
  permission_denied: "permission_denied",
  bad_request: "validation",
  invalid_field: "validation",
  validation_error: "validation",
  not_found: "validation",
  entity_not_found: "validation",
  conflict: "conflict",
  rate_limit_exceeded: "rate_limited",
  too_many_requests: "rate_limited",
  invalid_json: "validation",
  invalid_url: "validation",
  invalid_time_query_parameter: "validation",
  request_body_too_large: "validation",
  request_headers_too_large: "validation",
  unexpected_request_body: "validation",
  unsupported_media_type: "validation",
  invalid_token: "unauthorized_configuration",
  paddle_billing_not_enabled: "unauthorized_configuration",
  concurrent_modification: "conflict",
  entity_archived: "conflict",
  transaction_price_not_found: "catalog_mismatch",
  transaction_product_not_found: "catalog_mismatch",
  transaction_duplicate_price_ids: "catalog_mismatch",
  transaction_price_different_billing_cycle: "catalog_mismatch",
  transaction_price_different_trial_period: "catalog_mismatch",
  transaction_checkout_not_enabled: "unauthorized_configuration",
  transaction_default_checkout_url_not_set: "unauthorized_configuration",
  transaction_checkout_url_domain_is_not_approved: "unauthorized_configuration",
  transaction_item_quantity_out_of_range: "validation",
  transaction_invalid_status_change: "conflict",
  transaction_immutable: "conflict",
  transaction_immutable_while_processing_payment: "conflict",
  subscription_is_canceled_action_invalid: "conflict",
  subscription_is_inactive_action_invalid: "conflict",
  subscription_update_when_canceled: "conflict",
  subscription_locked_processing: "conflict",
  subscription_locked_renewal: "conflict",
  subscription_locked_pending_changes: "conflict",
  subscription_scheduled_change_invalid_update: "conflict",
  subscription_not_automatic_collection: "validation",
  subscription_immediate_charge_hour_limit_exceeded: "rate_limited",
  subscription_immediate_charge_24_hour_limit_exceeded: "rate_limited",
};

export function translatePaddleError(error: unknown, mutation: boolean): ProviderResult<never> {
  if (error instanceof ApiError) {
    const diagnostic = { providerCode: error.code };
    const code = rejections[error.code];
    if (code !== undefined) {
      return { kind: "rejected", code, diagnostic };
    }
    if (!mutation) {
      return {
        kind: "rejected",
        code:
          error.retryAfter !== null
            ? "rate_limited"
            : error.type === "api_error"
              ? "unavailable"
              : "unclassified_external_state",
        diagnostic,
      };
    }
    return { kind: "outcome_unknown", diagnostic };
  }
  // A network, JSON, or SDK mapping failure can follow a successful provider effect.
  return mutation
    ? { kind: "outcome_unknown" }
    : {
        kind: "rejected",
        code:
          error instanceof SyntaxError ||
          (error instanceof TypeError && error.message !== "fetch failed")
            ? "unclassified_external_state"
            : "unavailable",
      };
}
