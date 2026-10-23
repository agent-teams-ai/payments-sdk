import { declareModule } from '@get-modular/assembly';
import { required } from '@get-modular/core';
import { ProjectionView, ProjectionCommands, PurchaseReader, ProjectionConfiguration } from './purchase-observation.contracts.js';
export const purchaseProjectionDeclaration = declareModule({
  moduleId: `agent-teams/payments/observation/projection`, implementationId: `agent-teams/payments/observation/projection/default`, owner: { authority: 'agent-teams', path: ['payments', 'observation'] },
  provides: [ProjectionView.provide(), ProjectionCommands.provide()],
  slots: [PurchaseReader.slot('read', required()), ProjectionConfiguration.slot('configuration', required())],
});
