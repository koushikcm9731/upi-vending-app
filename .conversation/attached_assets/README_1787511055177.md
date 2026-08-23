# UPI Snack Vending Machine — Website + Backend + ESP32

Customer flow: open a website on their phone → pick a snack → pay by UPI (via PhonePe) →
machine dispenses the exact item they paid for.

## How the pieces fit together

```
Customer's phone                Backend (server.js)              ESP32 (in the machine)
  |  opens website  ---------------->  |                                |
  |  picks item, taps Pay  ----------->|  creates PhonePe order          |
  |  <----- redirect to PhonePe checkout page ------                    |
  |  pays with GPay/PhonePe/Paytm app  |                                |
  |                                    |  <---- PhonePe webhook (paid) --|
  |                                    |  queues "dispense slot X"       |
  |                                    |     <----- polls every 3s ------|
  |                                    |  ----- "dispense slot X" ------>|
  |                                    |                                | relay fires, item drops
  |                                    |  <---- confirms dispensed ------|
  |  <----- page shows "Enjoy!" ------ |  (customer's status page keeps polling)
```

## Folder structure

```
vending-machine/
├── backend/
│   ├── server.js          <- Express server: products API, PhonePe integration, ESP32 bridge
│   ├── products.js        <- Your product catalog & slot mapping (edit this to add items)
│   ├── package.json
│   └── .env.example       <- Copy to .env and fill in real values
├── frontend/
│   ├── index.html         <- The menu page customers scan a QR code to reach
│   └── status.html         <- "Payment received / dispensing / done" page
└── esp32/
    └── esp32_vending.ino  <- Arduino firmware for the ESP32 inside the machine
```

## 1. Get PhonePe Business API access

1. Sign up at https://business.phonepe.com and complete merchant KYC.
2. Once approved, PhonePe gives you: a **Merchant ID**, **Salt Key**, and **Salt Index**.
3. While building/testing, PhonePe provides sandbox/UAT credentials so you don't need
   approval yet — the `.env.example` file already has PhonePe's public UAT test
   credentials pre-filled so you can test end-to-end before going live.
4. In the PhonePe dashboard, register your webhook URL as
   `https://your-backend-domain.com/api/phonepe-callback` (this must be a real public
   HTTPS URL — use a tool like ngrok while developing locally: `ngrok http 4000`).

   > Note: Paytm for Business works very similarly (order creation API + webhook +
   > status-check API) if you'd rather use that — the `server.js` structure stays the
   > same, only the request/signature format in the PhonePe-specific functions would
   > need to be swapped for Paytm's.

## 2. Run the backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env with your real PhonePe credentials, your backend's public URL,
# your frontend's URL, and a random ESP32_SHARED_SECRET
npm start
```

It starts on `http://localhost:4000` (or whatever `PORT` you set).

Deploy this somewhere with a permanent HTTPS URL for real use — e.g. Railway, Render,
Fly.io, or a small VPS with a domain + free Let's Encrypt certificate. A Raspberry Pi
at home works too, but you'll need port forwarding or a tunnel (ngrok/Cloudflare Tunnel)
for PhonePe's webhook to reach it.

## 3. Deploy the website

`frontend/index.html` and `frontend/status.html` are plain static files — host them
anywhere (Netlify, Vercel, GitHub Pages, or the same server as your backend).

Before deploying, edit the `API_BASE` constant near the top of the `<script>` in **both**
`index.html` and `status.html` to point at your backend's real URL.

Then stick a QR code on the physical machine that links to your deployed `index.html`
(any free QR generator works — the QR just needs to encode that URL).

## 4. Flash the ESP32

1. Install the **ArduinoJson** library (Library Manager → search "ArduinoJson" by
   Benoit Blanchon).
2. Open `esp32/esp32_vending.ino` in Arduino IDE.
3. Fill in: `WIFI_SSID`, `WIFI_PASSWORD`, `BACKEND_BASE` (your backend's public URL),
   and `ESP32_SECRET` (must exactly match `ESP32_SHARED_SECRET` in your backend's `.env`).
4. Check `relayPins[]` matches how you've wired your relay module GPIOs.
5. Upload to the board.

The ESP32 only needs WiFi with internet access — it never talks to PhonePe directly,
only to your own backend, which keeps your PhonePe API keys off a physically-accessible
device.

## 5. Adding/editing products

Edit `backend/products.js` — each entry needs a unique `id`, `name`, `price`, `slot`
(must match a relay pin index in the ESP32 firmware), and starting `stock`. The website
picks up changes automatically on next page load; no ESP32 firmware changes needed
unless you're adding a slot that doesn't exist yet.

## Notes before running this for real

- **Switch to production PhonePe credentials and `PHONEPE_BASE_URL`** once you've
  tested fully in sandbox — the `.env.example` defaults are sandbox/test only.
- **Replace the in-memory `orders` object** in `server.js` with a real database
  before deploying — right now all orders are lost if the backend restarts.
- **Add a physical drop sensor** (e.g. an IR break-beam at the chute) if you want the
  machine to detect a jam (motor ran but nothing fell) rather than always assuming
  success.
- **Rate-limit / secure `/api/create-order`** if this becomes a public production
  machine, so it can't be spammed with junk orders.
