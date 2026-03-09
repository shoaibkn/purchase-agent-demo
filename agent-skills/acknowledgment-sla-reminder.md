# Skill: Acknowledgment SLA Reminder

## Purpose
Enforce 24-hour supplier acknowledgment SLA for newly sent POs.

## Trigger
- Scheduled job checks PO threads where no supplier acknowledgment exists after 24 hours.

## Inputs
- PO creation timestamp
- Last outbound and inbound message timestamps
- Current PO status

## Actions
1. Identify `ACK_PENDING` POs older than 24 hours without acknowledgment.
2. Send reminder message in the same thread.
3. Increment reminder attempt counter.
4. Log reminder task execution.

## Success Criteria
- Reminder message created and linked to PO thread.
- Reminder task marked executed.
- PO remains `ACK_PENDING` until supplier acknowledges.
