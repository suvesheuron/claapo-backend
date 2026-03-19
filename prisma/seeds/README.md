# Claapo Data Seeds

## How to Run

```bash
# From crewcall-backend directory:

# Option 1 — Direct
npx ts-node prisma/seeds/seed.ts

# Option 2 — npm script
npm run seed

# Option 3 — Prisma CLI
npx prisma db seed
```

> **Warning:** Running the seed will DELETE all existing data before inserting fresh records.

## Login Credentials

**Password for ALL seeded accounts:** `Test@1234`

### Freelancers (60 accounts)
| Email Pattern | Example |
|---|---|
| `freelancerNN@claapo.test` | `freelancer01@claapo.test` |
| Range: 01 → 60 | |

### Production Companies (60 accounts)
| Email Pattern | Example |
|---|---|
| `companyNN@claapo.test` | `company01@claapo.test` |
| Range: 01 → 60 | |
| Sub-users (first 5 companies): `companyNN-sub1@claapo.test`, `companyNN-sub2@claapo.test` | |

### Vendors (60 accounts)
| Email Pattern | Example |
|---|---|
| `vendorNN@claapo.test` | `vendor01@claapo.test` |
| Range: 01 → 60 | |

## What Gets Seeded

| Entity | Count | Notes |
|---|---|---|
| Freelancers | 60 | With profiles, skills, rates, PAN/bank info |
| Companies | 60 | With profiles, GST, addresses |
| Vendors | 60 | With profiles, types |
| Vendor Equipment | ~150 | 2-3 items per vendor |
| Projects | 20 | Various statuses (active/open/draft/completed/cancelled) |
| Project Roles | ~60 | 2-4 roles per project |
| Bookings | ~65 | Crew + vendor bookings, mixed statuses |
| Conversations | ~40 | With 2-5 messages each |
| Invoices | ~25 | With line items, draft/sent/paid/overdue |
| Notifications | ~180 | For first 20 users per role |
| Availability Slots | ~1500 | For 30 freelancers + 20 vendors |
| Sub-Users | 10 | 2 per first 5 companies, assigned to projects |

## Testing Flows

### Company Flow (login as `company01@claapo.test`)
1. Dashboard → See active projects, calendar, stats
2. Ongoing Projects → See project cards with statuses
3. Manage Schedule → Calendar with project dates
4. Search → Find crew and vendors
5. Bookings → See incoming/outgoing bookings
6. Chat → Conversations with crew and vendors
7. Invoices → Received invoices
8. Team → Sub-users (company01-sub1, company01-sub2)
9. Cancel Requests → Any cancel_requested bookings
10. Profile → Edit company info

### Freelancer Flow (login as `freelancer01@claapo.test`)
1. Dashboard → See availability calendar
2. Manage Schedule → Available/blocked dates
3. Bookings → Pending/accepted requests
4. Chat → Conversations with companies
5. Invoices → Sent invoices
6. Profile → Edit profile, skills, rates

### Vendor Flow (login as `vendor01@claapo.test`)
1. Dashboard → Equipment calendar
2. Equipment → Manage equipment items
3. Bookings → Equipment booking requests
4. Chat → Conversations with companies
5. Invoices → Sent invoices
6. Profile → Edit vendor info
