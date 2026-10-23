import { implement } from '@get-modular/assembly';
import { scoped } from '@get-modular/resources';
import { purchaseProjectionDisplayDeclaration } from './purchase-projection-display.declaration.js';
import { ProjectionDisplay, type PurchaseObservationCapabilities, type PurchaseProjectionDisplay } from './purchase-observation.contracts.js';
export const purchaseProjectionDisplayModule = implement<PurchaseObservationCapabilities>()(
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
