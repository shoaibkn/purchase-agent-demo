# Skill: Line EDD Negotiation

## Purpose
Negotiate and update closest estimated delivery dates at line level.

## Triggers
- Event: `PO_CREATED` with missing `requestedDate` on one or more lines
- Event: supplier rejects requested date

## Inputs
- PO line quantity and material lead time
- Supplier response text
- Existing thread history

## Actions
1. Ask supplier for closest feasible date per affected line.
2. Parse supplier response to extract date proposals.
3. Validate proposed dates by line.
4. Update `latestEdd` and delivery commitment records.
5. Confirm revised dates back to supplier in thread.

## Success Criteria
- Every affected line has a saved `latestEdd`.
- Delivery commitment entry created for each revised line.
- Thread contains confirmation message.
