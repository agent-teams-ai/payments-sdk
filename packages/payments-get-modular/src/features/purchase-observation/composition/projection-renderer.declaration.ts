import { declareModule } from '@get-modular/assembly';
import { ProjectionRenderer } from './purchase-observation.contracts.js';
export const projectionRendererDeclaration = declareModule({
  moduleId: `agent-teams/payments/observation/host-renderer`, implementationId: `agent-teams/payments/observation/host-renderer/input`, owner: { authority: 'agent-teams', path: ['payments', 'observation'] },
  provides: [ProjectionRenderer.provide()], slots: [],
});
