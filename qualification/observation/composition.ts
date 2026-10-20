import { declareModule, defineContract, group, implement, input, type CapabilitiesOf } from '@get-modular/assembly';
import { required } from '@get-modular/core';
import { scoped } from '@get-modular/resources';
import type { ReadonlyStore } from '@get-modular/observation';
import {
  createPurchaseProjection,
  type PurchaseProjectionCommands,
  type PurchaseProjectionOptions,
  type PurchaseProjectionRecord,
  type PurchaseProjectionState,
  type PurchaseReadPort,
} from './projection.ts';

export type PurchaseProjectionRenderer = Readonly<{ render: (state: PurchaseProjectionState) => undefined }>;
/** Direct reads are current; rendered updates follow the normal later-task observation contract. */
export type PurchaseProjectionDisplay = Readonly<{ current: () => PurchaseProjectionState }>;

const identity = 'agent-teams/payments/qualification/observation';
const owner = { authority: 'agent-teams', path: ['payments', 'qualification'] } as const;
export const PurchaseReader = defineContract<PurchaseReadPort>()({ id: `${identity}/reader`, revision: 1 });
export const ProjectionConfiguration = defineContract<PurchaseProjectionOptions>()({ id: `${identity}/configuration`, revision: 1 });
export const ProjectionView = defineContract<ReadonlyStore<PurchaseProjectionRecord>>()({ id: `${identity}/view`, revision: 1 });
export const ProjectionCommands = defineContract<PurchaseProjectionCommands>()({ id: `${identity}/commands`, revision: 1 });
export const ProjectionRenderer = defineContract<PurchaseProjectionRenderer>()({ id: `${identity}/renderer`, revision: 1 });
export const ProjectionDisplay = defineContract<PurchaseProjectionDisplay>()({ id: `${identity}/display`, revision: 1 });
export interface ObservationCandidateCapabilities extends CapabilitiesOf<
  typeof PurchaseReader | typeof ProjectionConfiguration | typeof ProjectionView | typeof ProjectionCommands | typeof ProjectionRenderer | typeof ProjectionDisplay
> {}

export const purchaseReadDeclaration = declareModule({
  moduleId: `${identity}/host-reader`, implementationId: `${identity}/host-reader/input`, owner,
  provides: [PurchaseReader.provide()], slots: [],
});
export const purchaseReadInput = input<ObservationCandidateCapabilities>()(purchaseReadDeclaration);
export const projectionConfigurationDeclaration = declareModule({
  moduleId: `${identity}/host-configuration`, implementationId: `${identity}/host-configuration/input`, owner,
  provides: [ProjectionConfiguration.provide()], slots: [],
});
export const projectionConfigurationInput = input<ObservationCandidateCapabilities>()(projectionConfigurationDeclaration);
export const projectionRendererDeclaration = declareModule({
  moduleId: `${identity}/host-renderer`, implementationId: `${identity}/host-renderer/input`, owner,
  provides: [ProjectionRenderer.provide()], slots: [],
});
export const projectionRendererInput = input<ObservationCandidateCapabilities>()(projectionRendererDeclaration);

export const purchaseProjectionDeclaration = declareModule({
  moduleId: `${identity}/projection`, implementationId: `${identity}/projection/default`, owner,
  provides: [ProjectionView.provide(), ProjectionCommands.provide()],
  slots: [PurchaseReader.slot('read', required()), ProjectionConfiguration.slot('configuration', required())],
});
/** Inert entry: the Host registers its runtime before running the projection and keeps lifetime control. */
export const purchaseProjectionModule = implement<ObservationCandidateCapabilities>()(
  purchaseProjectionDeclaration,
  async ({ read, configuration }, { resources }) => {
    const instance = createPurchaseProjection({ ...configuration, read }, { resources });
    return { instance, capabilities: { [ProjectionView.id]: instance.view, [ProjectionCommands.id]: instance.commands } };
  },
  scoped,
);

export const purchaseProjectionDisplayDeclaration = declareModule({
  moduleId: `${identity}/display-consumer`, implementationId: `${identity}/display-consumer/default`, owner,
  provides: [ProjectionDisplay.provide()],
  slots: [ProjectionView.slot('view', required()), ProjectionRenderer.slot('renderer', required())],
});
export const purchaseProjectionDisplayModule = implement<ObservationCandidateCapabilities>()(
  purchaseProjectionDisplayDeclaration,
  async ({ view, renderer }, { resources }) => {
    const snapshot = view.read(['state']);
    renderer.render(snapshot.values.state);
    view.watch(snapshot, {
      resources,
      name: 'payments-purchase/display',
      onChange: ({ values }) => { renderer.render(values.state); },
    });
    const instance: PurchaseProjectionDisplay = Object.freeze({ current: () => view.read(['state']).values.state });
    return { instance, capabilities: { [ProjectionDisplay.id]: instance } };
  },
  scoped,
);

export const observationCandidateGroup = group('payments-observation-candidate', [purchaseProjectionModule, purchaseProjectionDisplayModule]);
