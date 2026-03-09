# Skill: PO Created Notification

## Purpose
Send a purchase order notification to the supplier immediately after PO creation.

## Trigger
- Event: `PO_CREATED`

## Inputs
- Supplier contact details
- PO header data
- PO line data
- Requested line-level dates (if present)

## Actions
1. Create or reuse communication thread for the PO.
2. Generate outbound message with PO summary and line items.
3. Request explicit acknowledgment from supplier.
4. If requested dates are present, ask for approval on each line.
5. Persist outbound message and set PO status to `ACK_PENDING`.

## Success Criteria
- Outbound message exists in thread.
- PO status moves to `ACK_PENDING`.
- Agent run logged with model and decision summary.
