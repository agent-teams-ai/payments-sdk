import { ApiError } from '@paddle/paddle-node-sdk';
import type { ErrorCode, ProviderResult } from '@agent-teams/payments-core';

/** Only a certified provider rejection establishes a mutation's known non-success. */
const rejections: Readonly<Record<string, ErrorCode>> = {
  authentication_missing: 'unauthorized_configuration', authentication_invalid: 'unauthorized_configuration', authentication_malformed: 'unauthorized_configuration',
  forbidden: 'permission_denied', permission_denied: 'permission_denied',
  bad_request: 'validation', invalid_field: 'validation', validation_error: 'validation',
  not_found: 'validation', entity_not_found: 'validation', conflict: 'conflict',
  rate_limit_exceeded: 'rate_limited', too_many_requests: 'rate_limited',
};

export function translatePaddleError(error: unknown, mutation: boolean): ProviderResult<never> {
  if (error instanceof ApiError) {
    const diagnostic = { providerCode: error.code };
    const code = rejections[error.code];
    if (code !== undefined) return { kind: 'rejected', code, diagnostic };
    if (!mutation) return { kind: 'rejected', code: error.retryAfter !== null ? 'rate_limited' : error.type === 'api_error' ? 'unavailable' : 'unclassified_external_state', diagnostic };
    return { kind: 'outcome_unknown', diagnostic };
  }
  // A network, JSON, or SDK mapping failure can follow a successful provider effect.
  return mutation ? { kind: 'outcome_unknown' } : { kind: 'rejected', code: error instanceof TypeError || error instanceof SyntaxError ? 'unclassified_external_state' : 'unavailable' };
}
