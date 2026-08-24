---
name: API deployment health probes
description: Deployment healthcheck behavior for the API artifact mounted under /api.
---

The API service must return a successful lightweight response at its mounted base path (`/api`) in addition to the explicit `/api/healthz` endpoint.

**Why:** The deployment healthcheck has been observed probing `/api` during startup, even when the configured startup health path is `/api/healthz`. A missing base-path route is reported as a 500 healthcheck failure and can make publishing appear unreliable.

**How to apply:** Preserve both endpoints when changing API routing or artifact configuration; verify both return HTTP 200 after rebuilding and restarting the API workflow.