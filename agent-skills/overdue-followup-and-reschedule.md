# Skill: Overdue Follow-up and Reschedule

## Purpose
Follow up when line-level EDD is missed and manage revised delivery commitments.

## Trigger
- Scheduled job where `latestEdd` is in the past and `openQty > 0`

## Inputs
- Line-level EDD
- Open quantity
- Existing commitment schedule
- Supplier communication history

## Actions
1. Mark line status as `OVERDUE`.
2. Send delay follow-up requesting updated date and available quantity.
3. Parse supplier reply for revised dates and staggered deliveries.
4. Create or update delivery commitments by date and quantity.
5. Set line status to `RESCHEDULED` after valid revised commitment.

## Success Criteria
- Overdue lines are flagged.
- Revised commitments saved with versioning.
- Thread reflects follow-up and confirmed reschedule.
