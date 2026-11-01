# Disposable review fixture

This document is an isolated arithmetic example for a single authorized ReviewRouter check.
It does not describe Payments SDK behavior and must never be merged.

## Example quota calculation

A test account starts with 120 credits. It makes three operations costing 15 credits each.
After all three operations, its remaining balance is 85 credits.

No real payment, account, credential, or provider mutation is involved in this example.
