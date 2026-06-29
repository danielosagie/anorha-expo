# anorha-expo (Anorha mobile)

The **Anorha** mobile app — an Expo / React Native app for resellers. Point your camera at an item; Anorha identifies it, drafts the listing, prices it, and publishes it across your sales channels. It's built for a tired, impatient seller: calm, fast, default-to-simple.

> The git repo is `anorha-expo`; on disk this folder is `sssync_mobile_test` and the Expo slug is `sssync` (Anorha was formerly "sssync"). App display name: **Anorha** · bundle id `anorha.alpha`.

---

## Highlights

- **Scan → match → publish** — capture a photo; the backend streams an agentic match over SSE, then generates title/description/category/price.
- **Listing editor** — clickable field rows that open bottom sheets; per-platform pricing and inventory; shared photo strip.
- **Sprout** — a conversational agent for liquidation/clearout campaigns and quick actions, with plan/approve cards.
- **Multi-channel connections** — eBay, Shopify, Square, Clover, Facebook, and more (OAuth + sync status).
- **Live activity** — iOS widget showing bulk-job progress.

---

## Tech stack

| Area | Choice |
|------|--------|
| Framework | Expo SDK 55 · React Native 0.83 · React 19 · TypeScript (strict) |
| Navigation | React Navigation (native stack + bottom tabs) |
| State / sync | LegendState (`@legendapp/state`) synced to Supabase; Convex for conversations |
| Auth | Clerk (`@clerk/expo`) → Supabase via JWT bridge |
| API | REST + SSE to anorha-bknd; tRPC client for typed endpoints |
| UI | React Native Paper, Reanimated 4, FlashList, Lucide icons, Expo Blur/Linear Gradient |
| Device | Expo Camera, Image Picker/Manipulator, Secure Store, Local Authentication, Widgets |
| Observability | Sentry, PostHog |

---

## Project structure

```
App.tsx                      # Entry: Sentry init, Clerk + Supabase, providers, error boundary
app.json / app.config.js     # Expo config (config-driven version & build number)
eas.json                     # EAS build profiles + update channels
fastlane/                    # iOS TestFlight / App Store submission lanes
src/
├── navigation/AppNavigator.tsx   # Auth / main / modal stacks (40+ screens)
├── screens/                 # AddProduct, GenerateDetails, ProductDetail, SproutHome,
│                            #   Connections, CampaignThread, Inventory, Settings, onboarding…
├── components/              # Reusable UI (FieldRow/FieldSheet, cards, bottom sheets, nav)
├── context/ & providers/    # Auth session, Org, Jobs, Theme, Convex, PostHog
├── hooks/                   # job progress, platform connect, push, process state…
├── lib/                     # supabase client, apiClient, collaboration socket, analytics
├── config/                  # env.ts (resolved config), features.ts (flags), platforms.ts
├── design/                  # tokens (colors, spacing, type) — see design.md
├── utils/                   # SupaLegend (LegendState⇄Supabase), persistence, helpers
└── types/database.types.ts  # generated from the Supabase schema
```

The full design language lives in [`design.md`](design.md).

---

## Getting started

### Prerequisites
- Node 20+, the Expo tooling, and Xcode / Android Studio for native builds
- A `.env.local` with the public config below
- A running [anorha-bknd](https://github.com/danielosagie/anorha-bknd) (local or the hosted API)

### Install & run

```bash
npm install            # runs patch-package on postinstall
npm start              # Expo dev server
npm run ios            # build + run on iOS (dev client)
npm run android        # build + run on Android (dev client)
```

This app uses a **dev client** (not Expo Go), so the first run builds the native app; afterward JS changes hot-reload.

### Scripts

```bash
npm start              # expo start
npm run ios|android|web
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
npm run db:types       # regenerate src/types/database.types.ts from Supabase
npm run db:types:check # fail if types drifted from the schema
```

---

## Environment

Mobile-safe config is exposed through `EXPO_PUBLIC_*` vars (read and resolved in [`src/config/env.ts`](src/config/env.ts)). Put them in `.env.local` (gitignored). **Names only:**

**Backend**
`EXPO_PUBLIC_SSSYNC_API_BASE_URL` (falls back to `EXPO_PUBLIC_API_BASE_URL`, then the production default), `EXPO_PUBLIC_AI_SERVER_URL`, `EXPO_PUBLIC_CONVEX_URL`

**Supabase**
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SUPABASE_PROJECT_ID`

**Auth (Clerk)**
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CLERK_JWT_TEMPLATE`, `EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE`

**Channels / misc**
`EXPO_PUBLIC_ENABLED_PLATFORMS`, `EXPO_PUBLIC_CLOVER_APP_ID` (+ Clover OAuth URLs)

**Observability & env**
`EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_ENV`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`

> The socket base URL is derived from the API base by stripping the `/api` suffix. In dev, if no API base is set the app fails fast; in production it falls back to the hosted API.

---

## Build & release

Builds run through **EAS** (`eas.json`):

| Profile | Distribution | Use |
|---------|--------------|-----|
| `development` | internal | dev client |
| `preview` | internal | internal test builds |
| `production` | store | App Store + Play submission (injects Sentry env) |

- **iOS** — built with EAS (local EAS build supported) and submitted to **TestFlight / App Store** via Fastlane (`fastlane/`). The app and the iOS widget read the **same** build number (config-driven via `app.config.js`).
- **Android** — built on **EAS Cloud** and submitted to the **Play internal** track.
- **OTA updates** — JS-only fixes ship via `eas update --channel production` (Expo Updates).
- **Runtime version policy is `appVersion`** (pegged to the marketing version, e.g. `1.0.x`), *not* `fingerprint` — the fingerprint policy breaks `eas build --local`. Bump `version` before shipping native changes over OTA.

There are project skills for shipping: see `/anorha-testflight-submit` (end-to-end build → monitor/auto-fix → submit → manage on App Store Connect) and the iOS/Android release notes in the team docs.

---

## How it fits together

- **[anorha-bknd](https://github.com/danielosagie/anorha-bknd)** — the NestJS API this app talks to (scan/match/publish, Sprout agent, channel sync) over REST + SSE.
- **[anorha-web](https://github.com/danielosagie/anorha-web)** — marketing site + internal admin/ops dashboard.
- **anorha-tray** — desktop execution agent for browser-driven channels.
