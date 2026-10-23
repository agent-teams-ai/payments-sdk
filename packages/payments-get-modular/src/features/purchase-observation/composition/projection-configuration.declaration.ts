import { declareModule } from '@get-modular/assembly';
import { ProjectionConfiguration } from './purchase-observation.contracts.js';
export const projectionConfigurationDeclaration = declareModule({
  moduleId: `agent-teams/payments/observation/host-configuration`, implementationId: `agent-teams/payments/observation/host-configuration/input`, owner: { authority: 'agent-teams', path: ['payments', 'observation'] },
  provides: [ProjectionConfiguration.provide()], slots: [],
});
