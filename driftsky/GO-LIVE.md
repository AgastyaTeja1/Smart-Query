# Going live with Driftsky on Mac

Everything below is what only you can provide or decide (accounts, money, legal, brand). The code,
tests and release pipeline are ready for each step.

## 1. Decide the brand

- **Name and domain.** "Driftsky" and `driftsky.app` are placeholders. Pick the final name, check
  that it's free to use (a trademark search plus the App Store and domain), and buy the domain.
- If you change it, update `productName` and `appId` in `apps/desktop/electron-builder.yml`, the
  default site in `apps/desktop/src/main/main.ts` (`https://driftsky.app`), `SUPPORT_EMAIL` in
  `apps/web/src/content.ts`, and the defaults in `apps/web/server/config.ts`.
- **Support mailbox**, e.g. `support@yourdomain`. Customers write here for refunds and lost keys.

## 2. Apple Developer Program (needed so the app opens without warnings)

1. Enrol at developer.apple.com ($99 a year). The legal entity on the account is what people see as
   the developer.
2. In Certificates, create a **Developer ID Application** certificate. Export it from Keychain Access
   as a `.p12` file with a password.
3. Create an **app-specific password** for your Apple ID at appleid.apple.com.
4. In GitHub (Settings → Secrets and variables → Actions), add:

| Secret | Value |
| --- | --- |
| `CSC_LINK` | the `.p12` file, base64-encoded (`base64 -i cert.p12 \| pbcopy`) |
| `CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID email |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character Team ID |

The `Driftsky macOS` workflow then builds a **signed and notarized** universal DMG automatically.
Its package check reports whether Gatekeeper accepts it.

## 3. Stripe (payments)

1. Activate your Stripe account (business details, bank account).
2. Settings → Checkout: turn on **Adaptive Pricing** (local currencies) if you want prices by country,
   and **promotional emails consent** for the abandoned-checkout offer.
3. Decide on tax: turn on Stripe Tax if you need to collect VAT/sales tax. The checkout code works with
   or without it.
4. Developers → API keys: copy the **live secret key**.
5. Developers → Webhooks: add `https://yourdomain/api/stripe/webhook` with the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
   `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Copy the **signing secret**.

## 4. Email (license keys)

1. Create a Resend account and add your domain. Add the DNS records it shows (SPF, DKIM) so key
   emails don't land in spam.
2. Create an API key.

## 5. Hosting (website + license server)

Any host that runs Node 22 with a persistent disk and HTTPS works (Fly.io, Render, Railway, a small
VPS). Set:

```
NODE_ENV=production
PUBLIC_URL=https://yourdomain
DEVICE_SALT=<64 random characters; never change it>
DATABASE_PATH=/data/driftsky.db
RELEASES_PATH=/data/releases.json
TRUST_PROXY=1
PAYMENTS=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
MAIL=resend
RESEND_API_KEY=re_...
MAIL_FROM=YourName <keys@yourdomain>
SUPPORT_EMAIL=support@yourdomain
```

Build and start: `npm ci && npm run build -w @driftsky/web && npm start -w @driftsky/web`. The server
refuses to start with an unsafe production config (test payments, no real email, the default salt).

**Back up `/data/driftsky.db` daily.** It holds every customer's key.

## 6. Ship the first release

1. Push to `main` (or run the workflow). Download the signed DMG from the workflow run's artifacts.
2. Upload the DMG somewhere fast and permanent (Cloudflare R2, S3 + CloudFront, or your host).
3. `shasum -a 256 Driftsky-1.0.0-universal.dmg`, then write `/data/releases.json`:

```json
{ "mac": { "latest": "1.0.0", "minimum": "1.0.0", "url": "https://dl.yourdomain/Driftsky-1.0.0-universal.dmg", "sha256": "<hash>" } }
```

The site's Download button and the app's update checks pick it up without a restart. For later
versions, bump `version` in `apps/desktop/package.json`, release, and update the file. Raising
`minimum` makes older apps show "Update required".

## 7. Before you announce it

- **Legal:** add your company name and address to Terms and Privacy (`apps/web/src/pages/Legal.tsx`)
  and have them reviewed for where you sell (EU consumer law and VAT in particular).
- **Real hardware:** spend ten minutes on your own Mac with the signed build. CI already covers
  CoreGraphics windows, snow, full screen, wallpaper, Low Power Mode and Intel. Check what CI can't:
  two displays with different scaling, several Spaces, Stage Manager, a full-screen video, Open at
  login after a restart, and the first-launch experience from the downloaded DMG.
- **Analytics (optional):** build the site with `VITE_POSTHOG_KEY=...`. It loads only after cookie
  consent.
- **Test purchase:** buy a key on the live site with a real card, activate it, and refund it from
  Stripe. Check that the key turns off in the app.
