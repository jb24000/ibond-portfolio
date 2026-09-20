# I Bond Ledger

Private, mobile-first Progressive Web App for manually tracking electronic Series I Savings Bonds.

## v0.1
- BondVault-inspired original dashboard
- Light / Dark / System appearance
- IndexedDB persistence and offline PWA shell
- Add/edit individual I Bond purchases
- Portfolio principal, estimated value, redeemable value and interest
- JSON backup/export + restore/import
- Google Drive appDataFolder sync scaffold with open/manual/change/background sync paths
- No TreasuryDirect credentials

## Accuracy status
**The valuation engine is beta.** The current historical rate table is intentionally partial and the valuation/rounding implementation must be audited against TreasuryDirect before financial reliance. TreasuryDirect remains authoritative.

## Google Drive
Drive sync is intentionally disabled until a Google OAuth Web Client ID is configured in `app.js`. The intended scope is only:
`https://www.googleapis.com/auth/drive.appdata`

Never commit a Google client secret. Portfolio data is not stored in this repository.

## Review priorities
1. Treasury valuation and rounding
2. IndexedDB persistence/migrations
3. Backup integrity
4. Drive synchronization/conflict handling
5. PWA update behavior and privacy
