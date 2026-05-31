# Security Specification - Metrology App

## Data Invariants
1. **User Integrity**: Users cannot modify their own `role`.
2. **Calibration Ownership**: Only the `technicianId` matching `request.auth.uid` can write a calibration.
3. **Immutability**: `id` and `createdAt` fields cannot be changed after creation.
4. **Relational Sync**: A calibration must reference an existing technician.
5. **Terminal State**: Once a calibration is `PUBLISHED`, it cannot be modified.

## The Dirty Dozen Payloads

1. **Identity Spoofing**: Try to create a calibration for another technician.
2. **Privilege Escalation**: Try to update own user record to set `role: 'admin'`.
3. **Shadow Field**: Try to add `isApproved: true` to a calibration record.
4. **Temporal Manipulation**: Try to set `createdAt` to a future date instead of server time.
5. **ID Poisoning**: Try to use a 2MB string as a document ID.
6. **Orphaned Write**: Try to create a calibration with a non-existent `workOrderId`.
7. **Bypassing Terminal State**: Try to update a calibration that has status `PUBLISHED`.
8. **Field Injection**: Try to update a work order's `clientId` (immutable).
9. **PII Leak**: Try to read another technician's private profile.
10. **Query Scraper**: Try to list all calibrations without filtering by `technicianId`.
11. **Negative Calibration**: Try to save a calibration with negative `nominalValue`.
12. **State Jumper**: Try to set a calibration directly to `PUBLISHED` without being an admin.

## Test Runner Plan
We will use `firestore.rules.test.ts` to verify these rules.
