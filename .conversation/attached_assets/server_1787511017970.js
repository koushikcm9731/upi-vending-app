/**
 * Vending machine backend (Direct UPI version)
 * ---------------------------------------------
 * Simpler flow for a personal UPI ID (no merchant/Payment Gateway approval needed):
 *  1. Serve the product list to the website.
 *  2. When the customer taps "Pay", create an order and hand back a UPI
 *     deep link ( upi://pay?pa=... ) that opens their UPI app with the
 *     amount pre-filled, payable directly to YOUR UPI ID.
 *  3. The customer pays in their own UPI app, comes back, and taps
 *     "I've Paid" - since there's no payment gateway webhook to confirm
 *     this automatically, this manual tap is what marks the order paid.
 *  4. Once marked paid, the item(s) get queued for the ESP32 to dispense.
 *  5. ESP32 polls for pending commands, dispenses, and confirms back.
 *
 * NOTE: because there's no automatic payment verification here, this trusts
 * the customer's tap. That's fine for a personal/demo/college-project setup,
 * but isn't fraud-proof - a real deployed machine should use a proper
 * payment gateway (Razorpay/Cashfree/PhonePe Business API) that verifies
 * payment server-to-server before dispensing.
 */

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const products = require("./products");

const app = express();
app.use(cors());
app.use(express.json());

const {
  UPI_ID,
  UPI_PAYEE_NAME = "Vending Machine",
  ESP32_SHARED_SECRET,
  ADMIN_KEY,
  PORT = 4000,
} = process.env;

// orderId -> { items: [{productId, slot, qty, name, price}], amount, status: 'pending'|'paid'|'dispensed',
//              machineId, totalUnits, remainingUnits }
const orders = {};

// machineId -> queue (array) of dispense commands waiting for the ESP32,
// e.g. [{ commandId, orderId, slot }, { commandId, orderId, slot }, ...]
// One entry per physical item to drop - a "2x Kurkure" order becomes 2 queue entries.
const pendingDispense = {};

// Turns an order's cart (e.g. 2x Kurkure + 1x Lays) into individual queue
// entries - one per physical item, since the machine can only drop one item
// per relay activation. commandId lets the ESP32 confirm exactly which unit
// it dispensed.
function queueDispenseForOrder(orderId, order) {
  if (!pendingDispense[order.machineId]) pendingDispense[order.machineId] = [];
  for (const item of order.items) {
    for (let i = 0; i < item.qty; i++) {
      pendingDispense[order.machineId].push({
        commandId: crypto.randomBytes(6).toString("hex"),
        orderId,
        slot: item.slot,
      });
    }
  }
}

// ---------- 1. Product list ----------
app.get("/api/products", (req, res) => {
  res.json(products.map(({ id, name, price, stock }) => ({ id, name, price, stock })));
});

// ---------- 2. Create an order + build a direct UPI payment link ----------
// Body: { items: [{ productId, qty }, ...], machineId }
app.post("/api/create-order", (req, res) => {
  const { items, machineId = "machine-01" } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  const orderItems = [];
  let amount = 0;

  for (const line of items) {
    const product = products.find((p) => p.id === line.productId);
    const qty = Number(line.qty) || 0;

    if (!product) return res.status(400).json({ error: `Unknown product: ${line.productId}` });
    if (qty <= 0) continue;
    if (qty > product.stock) {
      return res.status(400).json({ error: `Only ${product.stock} left of ${product.name}` });
    }

    orderItems.push({ productId: product.id, slot: product.slot, qty, name: product.name, price: product.price });
    amount += product.price * qty;
  }

  if (orderItems.length === 0) return res.status(400).json({ error: "Cart is empty" });
  if (!UPI_ID) return res.status(500).json({ error: "Server misconfigured: UPI_ID is not set" });

  const orderId = "TXN" + crypto.randomBytes(8).toString("hex");
  const totalUnits = orderItems.reduce((sum, it) => sum + it.qty, 0);

  orders[orderId] = {
    items: orderItems,
    amount,
    machineId,
    status: "pending",
    totalUnits,
    remainingUnits: totalUnits,
    createdAt: new Date().toISOString(),
  };

  // Standard UPI deep link. Any UPI app (PhonePe, GPay, Paytm...) understands this.
  const upiLink =
    `upi://pay?pa=${encodeURIComponent(UPI_ID)}` +
    `&pn=${encodeURIComponent(UPI_PAYEE_NAME)}` +
    `&am=${encodeURIComponent(amount)}` +
    `&cu=INR` +
    `&tn=${encodeURIComponent("Order " + orderId)}`;

  res.json({ orderId, upiLink, amount });
});

// ---------- 3. Customer taps "I've Paid" after completing payment in their UPI app ----------
app.post("/api/confirm-payment", (req, res) => {
  const { orderId } = req.body;
  const order = orders[orderId];

  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "pending") {
    order.status = "paid";
    queueDispenseForOrder(orderId, order);
    console.log(`Order ${orderId} marked paid by customer, ${order.totalUnits} item(s) queued`);
  }

  res.json({ status: order.status });
});

// ---------- 4. Customer's browser polls this to know when to show "Dispensing..." ----------
app.get("/api/order-status/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ status: order.status });
});

// ---------- 5. ESP32 polling endpoint ----------
// The ESP32 calls this every 2-3 seconds asking "anything for me to dispense?"
// Only the NEXT item in the queue is returned - if an order has 2x Kurkure,
// the ESP32 will get called twice in a row (once per unit) via commandId.
app.get("/api/esp32/poll", (req, res) => {
  const { machineId = "machine-01", secret } = req.query;
  if (secret !== ESP32_SHARED_SECRET) return res.status(401).json({ error: "Bad secret" });

  const queue = pendingDispense[machineId];
  const next = queue && queue.length > 0 ? queue[0] : null;

  if (next) {
    res.json({ dispense: true, commandId: next.commandId, slot: next.slot, orderId: next.orderId });
  } else {
    res.json({ dispense: false });
  }
});

// ---------- 6. ESP32 confirms it physically dispensed one item ----------
app.post("/api/esp32/confirm-dispense", (req, res) => {
  const { machineId = "machine-01", orderId, commandId, secret } = req.body;
  if (secret !== ESP32_SHARED_SECRET) return res.status(401).json({ error: "Bad secret" });

  const queue = pendingDispense[machineId] || [];
  const idx = queue.findIndex((c) => c.commandId === commandId);
  const dispensedCommand = idx !== -1 ? queue[idx] : null;
  if (idx !== -1) queue.splice(idx, 1); // remove just this one unit from the queue

  const order = orders[orderId];
  if (order) {
    order.remainingUnits = Math.max(0, order.remainingUnits - 1);

    // Decrement stock for whichever product this unit was (matched by slot)
    const dispensedItem = dispensedCommand
      ? order.items.find((it) => it.slot === dispensedCommand.slot)
      : order.items[0];
    const product = products.find((p) => p.id === dispensedItem?.productId);
    if (product && product.stock > 0) product.stock -= 1;

    if (order.remainingUnits === 0) order.status = "dispensed";
  }

  res.sendStatus(200);
});

// ---------- 7. Admin dashboard endpoints ----------
// Protected by a simple key so random visitors on the internet can't see your
// sales data. Pass it as ?key=... in the URL. Set ADMIN_KEY in your .env.
function checkAdminKey(req, res) {
  if (!ADMIN_KEY) {
    res.status(500).json({ error: "Server misconfigured: ADMIN_KEY is not set" });
    return false;
  }
  if (req.query.key !== ADMIN_KEY) {
    res.status(401).json({ error: "Invalid admin key" });
    return false;
  }
  return true;
}

// Full order history, most recent first.
app.get("/api/admin/orders", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const list = Object.entries(orders)
    .map(([orderId, order]) => ({ orderId, ...order }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(list);
});

// Summary stats: total revenue, items sold, per-product breakdown.
app.get("/api/admin/summary", (req, res) => {
  if (!checkAdminKey(req, res)) return;

  const allOrders = Object.values(orders);
  const paidOrders = allOrders.filter((o) => o.status === "paid" || o.status === "dispensed");
  const dispensedOrders = allOrders.filter((o) => o.status === "dispensed");

  const totalRevenue = paidOrders.reduce((sum, o) => sum + o.amount, 0);
  const totalOrders = paidOrders.length;

  const perProduct = {};
  for (const order of paidOrders) {
    for (const item of order.items) {
      if (!perProduct[item.productId]) {
        perProduct[item.productId] = { name: item.name, qtySold: 0, revenue: 0 };
      }
      perProduct[item.productId].qtySold += item.qty;
      perProduct[item.productId].revenue += item.qty * item.price;
    }
  }

  res.json({
    totalRevenue,
    totalOrders,
    pendingOrders: allOrders.filter((o) => o.status === "pending").length,
    dispensedOrders: dispensedOrders.length,
    perProduct: Object.values(perProduct),
    currentStock: products.map(({ id, name, stock }) => ({ id, name, stock })),
  });
});

app.listen(PORT, () => {
  console.log(`Vending machine backend running on port ${PORT}`);
});
