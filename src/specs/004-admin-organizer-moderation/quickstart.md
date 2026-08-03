# Quickstart: Admin Organizer & Event Moderation

## Prerequisites

- Node.js and npm installed.
- PostgreSQL `DATABASE_URL` configured as used by existing server config.
- Auth/catalog/order/wallet migrations already applied.
- Admin, organizer, attendee, event, future-showtime, ticket, and wallet fixtures available.

## Apply schema

```powershell
npm run db:migrate
```

Confirm migration `0004_admin_moderation.sql` applies after existing migrations and that `audit_logs` trigger rejects both `UPDATE` and `DELETE`.

## Run server and tests

```powershell
npm run test -- server/tests/integration/admin-moderation.test.ts
npm run typecheck
```

## Validation scenarios

1. **RBAC**: call every `/api/admin/*` endpoint without a token and with attendee/organizer tokens. Expect `401` or `403`; verify no domain row or audit row changes.
2. **Organizer approval**: create `pending` organizer application; approve as admin; reload authenticated organizer state. Expect `approved`, organizer capability true, notification intent, and one audit row.
3. **Organizer rejection**: reject with reason; expect `rejected`, reason visible to applicant, re-apply allowed, and audit row.
4. **Organizer suspension**: seed approved organizer and public event; suspend; call public list/detail/showtime/seat-map immediately. Expect event hidden; admin/owner views retain event and suspension reason.
5. **Pre-publish gate**: publish event into `pending_review`; verify public catalog excludes it; approve as admin; verify it appears only when `on_sale` and organizer remains approved. Reject another with reason and verify non-public state.
6. **Report dismissal/flag**: dismiss one report and confirm content remains; flag another and confirm public content disappears while admin retains it.
7. **Removal/refund**: remove event with future sold tickets and started showtime. Expect only future tickets voided, one full-VND wallet refund per eligible buyer, inventory released, notifications queued, started showtime skipped.
8. **Idempotency/concurrency**: submit same action twice and race two admin requests. Expect one transition, no duplicate refund/audit side effects for duplicate command, and `409` for incompatible loser.
9. **Audit immutability**: perform direct SQL `UPDATE audit_logs ...` and `DELETE FROM audit_logs ...`. Expect PostgreSQL exception and unchanged row count/content.
10. **Rollback**: force audit/refund/notification failure in a transaction test. Expect organizer/event/ticket/wallet state unchanged and no audit row committed.
11. **Frontend**: sign in as admin, open `AdminPanel.tsx`, load queues, complete approve/reject/suspend/flag/remove flows, verify loading/error/empty states and Vietnamese reasons.

## Contract references

- API shapes: [contracts/admin.openapi.yaml](contracts/admin.openapi.yaml)
- Tables and invariants: [data-model.md](data-model.md)
- Feature acceptance criteria: [spec.md](spec.md)
