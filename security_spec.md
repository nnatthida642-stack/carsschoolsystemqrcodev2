# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants (Shared Multi-Device Terminal Mode — No Google Sign-In Required)
1. **Immediate Shared Access Without Google Login**: Devices connect directly to Cloud Firestore without requiring Google Account sign-in, allowing all scanner terminals to immediately view scans, students, cars, users, and settings synced from other devices in real time.
2. **Strict Schema & No Shadow Fields**: Every collection (`students`, `cars`, `scans`, `users`, `settings`, `devices`) enforces an `isValid[Entity](data)` blueprint helper with `keys().hasAll(...)` and `keys().hasOnly(...)`, strict field types, and `.size()` bounds on every string.
3. **Path Variable Hardening (`isValidId`) & Deterministic Scan IDs**: All document IDs (`studentId`, `carId`, `scanId`, `userId`, `settingKey`, `deviceId`), payload IDs (`scan_id`, etc.), and `ownerId` fields must match `^[a-zA-Z0-9_\-]+$` with length 1–128 characters. `scans/{scanId}` uses deterministic document IDs (`setDoc(doc(db, 'scans', scanId), payload)`) enforcing `incoming().scan_id == scanId` on create and `student_id.size() >= 1`.
4. **Temporal Integrity (`createdAt`, `updatedAt`)**: Server timestamps (`request.time`) are strictly enforced on `create` (`createdAt == request.time && updatedAt == request.time`) and `update` (`createdAt == existing().createdAt && updatedAt == request.time`).
5. **Immutable Identity Fields**: `student_id`, `car_id`, `scan_id`, `user_id`, `key`, `device_id`, `ownerId`, and `createdAt` cannot be modified on update (`incoming().field == existing().field`).
6. **Bounded Queries (`request.query.limit`)**: All `allow list` rules enforce bounded `request.query.limit` checks (supporting `orderBy('timestamp', 'desc')` + `limit(...)` on `scans`) with zero `get()` or `exists()` calls inside `allow list`.
7. **Admin Registry Lockdown**: `/admins/{userId}` denies all client reads and writes (`allow read, write: if false;`). `/devices/{deviceId}` denies client deletion (`allow delete: if false;`).

## 2. Adversarial Payloads Covered
1. **Default-Deny Catch-All**: Unmatched path `/unknown/doc1` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection ("Ghost Field")**: Payload with valid student fields plus `isAdmin: true` -> `PERMISSION_DENIED` (`hasOnly`).
3. **Client-Forged Timestamp**: Payload with `createdAt: Timestamp.fromMillis(0)` instead of `serverTimestamp()` -> `PERMISSION_DENIED`.
4. **Immutable Field Mutation**: Update changing `ownerId`, `createdAt`, or `student_id` -> `PERMISSION_DENIED`.
5. **ID Poisoning / Path Traversal**: Document ID > 128 chars or containing `/` or spaces -> `PERMISSION_DENIED` (`isValidId`).
6. **String Size Exhaustion (Denial of Wallet)**: Writing a 10,000-character `note` in `/scans/SCN-1` (max 500) -> `PERMISSION_DENIED`.
7. **Unbounded List Query**: Querying `/students` or `/scans` without `limit(...)` -> `PERMISSION_DENIED`.
8. **Invalid Scan Type Enum**: Writing `/scans/SCN-9` with `scan_type: "hacked"` instead of `"ขึ้นรถ"` or `"ลงรถ"` -> `PERMISSION_DENIED`.
9. **Invalid Scan Source Enum**: Writing `/scans/SCN-9` with `scan_source: "unknown"` -> `PERMISSION_DENIED`.
10. **Invalid AppUser Role Enum**: Writing `/users/U999` with `role: "SuperRoot"` -> `PERMISSION_DENIED`.
11. **Invalid Car Capacity**: Writing `/cars/CAR99` with `capacity: 9999` or `capacity: 0` -> `PERMISSION_DENIED`.
12. **Privilege Escalation on `/admins`**: Attempting to read or write `/admins/{uid}` -> `PERMISSION_DENIED`.
