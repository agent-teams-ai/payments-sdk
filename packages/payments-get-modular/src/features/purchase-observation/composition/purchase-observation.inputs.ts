import { input } from '@get-modular/assembly';
import type { PurchaseObservationCapabilities } from './purchase-observation.contracts.js';
import { purchaseReadDeclaration } from './purchase-read.declaration.js';
import { projectionConfigurationDeclaration } from './projection-configuration.declaration.js';
import { projectionRendererDeclaration } from './projection-renderer.declaration.js';

export const purchaseReadInput = input<PurchaseObservationCapabilities>()(purchaseReadDeclaration);
export const projectionConfigurationInput = input<PurchaseObservationCapabilities>()(projectionConfigurationDeclaration);
export const projectionRendererInput = input<PurchaseObservationCapabilities>()(projectionRendererDeclaration);
