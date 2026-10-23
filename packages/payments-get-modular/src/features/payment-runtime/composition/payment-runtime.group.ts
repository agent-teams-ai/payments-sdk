import { group } from '@get-modular/assembly';
import { paymentsModule } from './payments.module.js';

export const paymentsGroup = group('payment-runtime', [
  paymentsModule,
]);
