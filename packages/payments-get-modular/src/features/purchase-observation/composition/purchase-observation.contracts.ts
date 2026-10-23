import { defineContract, type CapabilitiesOf } from '@get-modular/assembly';
import type { ReadonlyStore } from '@get-modular/observation';
import type { PurchaseProjectionCommands, PurchaseProjectionRecord, PurchaseProjectionState } from '../application/models/projection-models.js';
import type { PurchaseReadPort } from '../application/ports/purchase-reader.js';
import type { PurchaseProjectionOptions } from './projection-types.js';

export type PurchaseProjectionRenderer = Readonly<{ render: (state: PurchaseProjectionState) => undefined }>;
/** Direct reads are current; rendered updates follow the normal later-task observation contract. */
export type PurchaseProjectionDisplay = Readonly<{ current: () => PurchaseProjectionState }>;

const identity = 'agent-teams/payments/observation';
export const PurchaseReader = defineContract<PurchaseReadPort>()({ id: `${identity}/reader`, revision: 1 });
export const ProjectionConfiguration = defineContract<PurchaseProjectionOptions>()({ id: `${identity}/configuration`, revision: 1 });
export const ProjectionView = defineContract<ReadonlyStore<PurchaseProjectionRecord>>()({ id: `${identity}/view`, revision: 1 });
export const ProjectionCommands = defineContract<PurchaseProjectionCommands>()({ id: `${identity}/commands`, revision: 1 });
export const ProjectionRenderer = defineContract<PurchaseProjectionRenderer>()({ id: `${identity}/renderer`, revision: 1 });
export const ProjectionDisplay = defineContract<PurchaseProjectionDisplay>()({ id: `${identity}/display`, revision: 1 });
export interface PurchaseObservationCapabilities extends CapabilitiesOf<
  typeof PurchaseReader | typeof ProjectionConfiguration | typeof ProjectionView | typeof ProjectionCommands | typeof ProjectionRenderer | typeof ProjectionDisplay
> {}
