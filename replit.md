# UPI Snack Vending Machine

A shareable snack-vending website with UPI checkout, order status tracking, admin sales views, and an ESP32 dispense bridge.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the customer website and API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Optional env: `UPI_ID`, `UPI_PAYEE_NAME`, `ADMIN_KEY`, and `ESP32_SHARED_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server/public/index.html` — customer snack menu
- `artifacts/api-server/public/status.html` — payment and dispense status
- `artifacts/api-server/public/admin.html` — admin dashboard
- `artifacts/api-server/src/app.ts` — web server, vending API, and ESP32 bridge

## Architecture decisions

- The customer pages use same-origin API calls so one published URL serves the entire flow.
- Orders and stock are kept in memory for this demo; use a database before production use.
- Direct UPI confirmation is intentionally manual and is not fraud-proof without a payment gateway.

## Product

- Customers choose snacks, open a UPI deep link, confirm payment, and track dispensing.
- Admins can view revenue, stock, product sales, and recent orders at `/admin`.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
