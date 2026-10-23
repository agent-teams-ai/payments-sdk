import { declareModule } from '@get-modular/assembly';
import { PaymentsConfiguration } from './payment-runtime.contracts.js';
export const paymentsConfigurationDeclaration = declareModule({
  moduleId: 'agent-teams/payments/configuration',
  implementationId: 'agent-teams/payments/configuration/host',
  owner: { authority: 'agent-teams', path: ['payments'] },
  provides: [PaymentsConfiguration.provide()],
  slots: [],
});
