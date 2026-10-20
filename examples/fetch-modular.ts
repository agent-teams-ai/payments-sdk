/** Fetch handler with the published static Get Modular assembly, not a second payment runtime. */
import { assemblyFor } from '@get-modular/assembly';
import { createScope } from '@get-modular/resources';
import { PaymentsConfiguration, paymentsConfiguration, paymentsGroup, paymentsModule } from '@agent-teams/payments-get-modular';
import type { PaymentsCapabilities } from '@agent-teams/payments-get-modular';
import type { PaymentRuntimeOptions } from '@agent-teams/payments-core';
import { handlePaymentRequest } from './node-http.ts';
import type { HostedPayments, WebhookVerifier } from './node-http.ts';

const preparation = await assemblyFor<PaymentsCapabilities>().prepare({ profileId: 'fixtures/fetch-payments-v1', bindings: [], modules: [paymentsGroup], roots: { payments: paymentsModule }, inputs: { configuration: paymentsConfiguration } });
if (preparation.status !== 'prepared') {throw new Error(`Static payment composition failed: ${preparation.error.code}`);}
const prepared = preparation.prepared;

export async function createFetchModularHost(options: PaymentRuntimeOptions, verify: WebhookVerifier, authenticate: (request: Request) => Promise<string | undefined>) {
  const scope = createScope({ name: `fetch-host-${options.scope.applicationId}` });
  const result = await prepared.run({ scope: scope.resources, inputs: { configuration: { [PaymentsConfiguration.id]: options } } });
  if (result.status !== 'succeeded') { await scope.control.close(); throw new Error(`Payment construction ${result.status}`); }
  const root = result.roots.payments;
  const payments: HostedPayments = { ...root.checkout, ...root.read, ...root.management, ...root.processing, ...root.delivery };
  return { payments, handle: (request: Request) => handlePaymentRequest(request, payments, verify, authenticate), close: () => scope.control.close() };
}
