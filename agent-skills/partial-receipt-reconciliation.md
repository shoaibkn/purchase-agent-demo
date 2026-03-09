# Skill: Partial Receipt Reconciliation

## Purpose
Keep PO and line statuses accurate when goods are partially or fully received.

## Trigger
- Event: `GOODS_RECEIPT_CREATED`

## Inputs
- Receipt lines with accepted and rejected quantity
- Current line open quantity
- Existing delivery commitments

## Actions
1. Subtract accepted quantity from line `openQty`.
2. Mark line as `PARTIALLY_RECEIVED` if `openQty > 0`.
3. Mark line as `RECEIVED` if `openQty = 0`.
4. Update PO status based on aggregate line status.
5. If partially received past EDD, request remaining schedule update.

## Success Criteria
- Quantities reconcile correctly after every receipt.
- PO and line statuses are consistent.
- Follow-up message created when remaining quantity needs replanning.
