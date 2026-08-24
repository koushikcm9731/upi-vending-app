---
name: UPI handoff behavior
description: Constraints around PhonePe and Google Pay handoffs from the web app.
---

Generic `upi://pay` links can launch PhonePe or Google Pay and return the customer to the existing browser page, but they do not universally provide a trusted web callback confirming payment.

**Why:** Treating a deep-link return as proof of payment could dispense without verification, and callback behavior varies by device, browser, and UPI app.

**How to apply:** Keep the order-status page loaded in the same tab, refresh status when the page becomes visible again, and retain an explicit server-side payment confirmation or verified provider webhook before dispensing.