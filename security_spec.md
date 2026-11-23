# Security Specification — Stage 1 (Auth, RBAC, Admin Console & Firestore)

## 1. Data Invariants
1. **No Self-Assigned Admin Role**: During `users/{userId}` creation by a non-admin user, `role` MUST equal `'subscriber'` and `status` MUST equal `'trial'`.
2. **Immutable Ownership & Timestamps**: `uid` and `createdAt` cannot be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update.
3. **Privilege & Billing Field Protection**: A subscriber updating their own document in `users/{userId}` may ONLY modify `name`, `lastLoginAt`, and `updatedAt`. They CANNOT modify `role`, `status`, `trialSecondsRemaining`, `trialSecondsUsed`, `planId`, `planName`, `subscriptionStartedAt`, or `subscriptionExpiresAt`.
4. **PII Isolation**: Only the account owner (`request.auth.uid == userId`) or a verified administrator (`isAdmin()`) may read a document in `users/{userId}`. Blanket `list` for non-admins is denied.
5. **Immutable Audit Trail**: `adminLogs/{logId}` documents can only be created by verified administrators with `actorUid == request.auth.uid` and `createdAt == request.time`. Update and delete operations are strictly forbidden.
6. **Admin Verification**: Administrative access requires either a verified email matching the bootstrapped primary administrator (`oliveira16g8@gmail.com` with `email_verified == true`) OR an explicit server-verified entry in `/admins/{request.auth.uid}` (with `email_verified == true`).

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Self-Registration as Admin**: `POST users/{uid}` with `{ role: 'admin', status: 'active', ... }` by non-admin.
2. **Privilege Escalation on Update**: `PATCH users/{uid}` by owner changing `{ role: 'admin' }`.
3. **Trial Balance Tampering**: `PATCH users/{uid}` by owner changing `{ trialSecondsRemaining: 999999 }`.
4. **Status Bypass (Unblock/Activate Self)**: `PATCH users/{uid}` by blocked/expired subscriber changing `{ status: 'active' }`.
5. **Ghost/Shadow Field Injection**: `POST users/{uid}` with extra field `{ isSuperUser: true }`.
6. **Spoofed Unverified Admin Email**: Authenticated request with `email: 'oliveira16g8@gmail.com'` and `email_verified: false`.
7. **Cross-User PII Read**: Authenticated subscriber A attempting `get` on `users/{subscriberB}`.
8. **Cross-User List Scraping**: Authenticated subscriber attempting `list` on `users`.
9. **ID Poisoning**: Creating document with 500-char invalid ID containing `/$#` characters.
10. **Immutable Audit Log Tampering**: Admin or subscriber attempting `update` or `delete` on `adminLogs/{logId}`.
11. **Fake Actor Log Injection**: Admin attempting `create` on `adminLogs/{logId}` with `actorUid` set to another UID.
12. **Client Clock Manipulation**: Creating or updating `users/{uid}` with backdated `createdAt` or `updatedAt != request.time`.
