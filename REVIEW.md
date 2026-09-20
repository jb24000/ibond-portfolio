# Independent review checklist

Review financial calculation accuracy, IndexedDB durability, backup/restore, Google Drive synchronization, PWA/offline behavior, and privacy.

## Treasury calculation invariants
- Issue fixed rate remains for the life of the bond.
- Inflation component changes every six months on the bond's issue-month schedule.
- Composite annual rate = fixed + 2×inflation + fixed×inflation, rounded to the nearest 0.01 percentage point, never below zero.
- Six-month value factor is 1 + composite/2.
- Under 12 months: not redeemable.
- 12–59 months: redeemable value reflects the prior three months' interest forfeiture.
- 60+ months: no early-redemption penalty.
- 360 months: stop accruing.
- Historical rates cover issues from September 1998 through the current published May 2026 rate period.

## Data invariants
- Portfolio replacement is atomic.
- Deletes are tombstones and synchronize.
- Invalid cloud data blocks sync rather than being silently discarded.
- No TreasuryDirect credentials are collected.
- Drive scope is appDataFolder only.
