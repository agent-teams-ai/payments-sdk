import { declareModule } from '@get-modular/assembly';
import { required } from '@get-modular/core';
import { ProjectionDisplay, ProjectionView, ProjectionRenderer } from './purchase-observation.contracts.js';
export const purchaseProjectionDisplayDeclaration = declareModule({
  moduleId: `agent-teams/payments/observation/display-consumer`, implementationId: `agent-teams/payments/observation/display-consumer/default`, owner: { authority: 'agent-teams', path: ['payments', 'observation'] },
  provides: [ProjectionDisplay.provide()],
  slots: [ProjectionView.slot('view', required()), ProjectionRenderer.slot('renderer', required())],
});
