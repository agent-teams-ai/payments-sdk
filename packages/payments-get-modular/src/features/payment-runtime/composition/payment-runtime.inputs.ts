import { input } from '@get-modular/assembly';
import type { PaymentsCapabilities } from './payment-runtime.contracts.js';
import { paymentsConfigurationDeclaration } from './configuration.declaration.js';

export const paymentsConfiguration = input<PaymentsCapabilities>()(paymentsConfigurationDeclaration);
