# I Bond Ledger

Private, mobile-first Progressive Web App for manually tracking electronic Series I Savings Bonds.

## Features
- BondVault-inspired original dashboard
- Light / Dark / System appearance
- IndexedDB persistence plus persistent-storage request
- Offline/installable PWA
- Add, edit and soft-delete individual I Bond purchases
- Portfolio principal, accrued value, redeemable value and interest
- Per-bond current rate, redemption eligibility, penalty end and maturity timeline
- Analytics and timeline views
- JSON backup/export + atomic restore/import
- Optional Google Drive appDataFolder synchronization
- Tombstone-aware per-bond merge
- No TreasuryDirect credentials or personal portfolio data in GitHub

## Treasury calculations
Historical fixed and inflation rates are maintained in `ibond.js` from Treasury's official Series I earnings-rate chart, currently through the May 2026 rate period. The engine applies each bond's permanent fixed rate, its six-month inflation schedule, Treasury's composite-rate formula and rounding, the 12-month redemption lock, the three-month interest penalty before five years, and the 30-year maturity cap.

The app remains an independent estimator. TreasuryDirect is authoritative for redemption values.

## Google Drive setup
1. Create a Google Cloud project and enable the Google Drive API.
2. Configure the OAuth consent screen.
3. Create an OAuth **Web application** client.
4. Add the deployed GitHub Pages origin as an Authorized JavaScript origin.
5. In the app, open More → Google Drive sync and paste the OAuth client ID when prompted.

The client ID is stored only on that browser/device. It is not a client secret. The app requests only:
`https://www.googleapis.com/auth/drive.appdata`

Browser OAuth access tokens are short-lived. Google may require you to authorize again; the local IndexedDB portfolio remains the primary copy.

## Deployment
Enable GitHub Pages for the repository and deploy from the `main` branch/root after the reviewed PR is merged. Open the Pages URL in Chrome on Android and choose **Add to Home screen / Install app**.

## Tests
```
npm test
```

## Security / durability
- IndexedDB replacement is one atomic transaction.
- Deleted bonds remain as synchronized tombstones.
- Cloud records are validated before merge.
- Service worker caches only same-origin app resources.
- Backup/restore is available independently of Drive.
- TreasuryDirect credentials are never requested or stored.
