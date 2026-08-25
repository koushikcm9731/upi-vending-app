import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
const products = [
  { id: "lays-classic", name: "Lays Classic", price: 20, slot: 1, stock: 12 },
  { id: "kurkure-masala", name: "Kurkure Masala", price: 20, slot: 2, stock: 10 },
  { id: "oreo-biscuit", name: "Oreo Biscuit", price: 30, slot: 3, stock: 8 },
  { id: "coca-cola-250ml", name: "Coca-Cola 250ml", price: 40, slot: 4, stock: 8 },
];
const orders: Record<string, any> = {};
const pendingDispense: Record<string, any[]> = {};
const upiId = process.env["UPI_ID"]?.trim();
const payeeName = process.env["UPI_PAYEE_NAME"]?.trim();
const adminKey = process.env["ADMIN_KEY"]?.trim();
const espSecret = process.env["ESP32_SHARED_SECRET"] || "demo-esp32-secret";
const razorpayKeyId = process.env["RAZORPAY_KEY_ID"]?.trim();
const razorpayKeySecret = process.env["RAZORPAY_KEY_SECRET"]?.trim();
const razorpayWebhookSecret = process.env["RAZORPAY_WEBHOOK_SECRET"]?.trim();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.post("/api/webhooks/razorpay", express.raw({ type: "application/json" }), (req, res) => {
  if (!razorpayWebhookSecret) {
    res.status(503).json({ error: "Razorpay webhook is not configured" });
    return;
  }
  const signature = req.header("x-razorpay-signature");
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
  const expected = crypto.createHmac("sha256", razorpayWebhookSecret).update(rawBody).digest("hex");
  if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }
  try {
    const event = JSON.parse(rawBody.toString("utf8")) as {
      event?: string;
      payload?: { payment?: { entity?: { order_id?: string; status?: string; amount?: number } } };
    };
    if (event.event === "payment.captured" || event.event === "order.paid") {
      const payment = event.payload?.payment?.entity;
      const orderEntry = Object.entries(orders).find(([, candidate]: [string, any]) => candidate.razorpayOrderId === payment?.order_id);
      const order = orderEntry?.[1];
      if (order && (payment?.status === "captured" || event.event === "order.paid") && payment?.amount === order.amount * 100) {
        markOrderPaid(orderEntry[0], order);
      }
    }
    res.sendStatus(200);
  } catch {
    res.status(400).json({ error: "Invalid webhook payload" });
  }
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// The artifact deployment healthcheck probes the service base path (/api).
// Keep this lightweight endpoint alongside /api/healthz so both deployment
// and explicit health checks receive a successful response.
app.get("/api", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/products", (_req, res) => {
  res.json(products.map(({ id, name, price, stock }) => ({ id, name, price, stock })));
});

app.post("/api/create-order", async (req, res) => {
  if (!razorpayKeyId || !razorpayKeySecret) {
    res.status(503).json({ error: "Razorpay payment configuration is unavailable" });
    return;
  }
  const { items, machineId = "machine-01" } = req.body as { items?: Array<{ productId: string; qty: number }>; machineId?: string };
  if (!Array.isArray(items) || items.length === 0) { res.status(400).json({ error: "Cart is empty" }); return; }
  const orderItems: any[] = [];
  let amount = 0;
  for (const line of items) {
    const product = products.find((item) => item.id === line.productId);
    const qty = Math.floor(Number(line.qty));
    if (!product) { res.status(400).json({ error: `Unknown product: ${line.productId}` }); return; }
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (qty > product.stock) { res.status(400).json({ error: `Only ${product.stock} left of ${product.name}` }); return; }
    orderItems.push({ productId: product.id, slot: product.slot, qty, name: product.name, price: product.price });
    amount += product.price * qty;
  }
  if (!orderItems.length) { res.status(400).json({ error: "Cart is empty" }); return; }
  const orderId = `TXN${crypto.randomBytes(8).toString("hex")}`;
  const totalUnits = orderItems.reduce((sum, item) => sum + item.qty, 0);
  try {
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amount * 100, currency: "INR", receipt: orderId, notes: { machineId } }),
    });
    if (!razorpayResponse.ok) {
      res.status(502).json({ error: "Razorpay could not create the payment order" });
      return;
    }
    const razorpayOrder = await razorpayResponse.json() as { id?: string; amount?: number; currency?: string };
    if (!razorpayOrder.id || razorpayOrder.amount !== amount * 100 || razorpayOrder.currency !== "INR") {
      res.status(502).json({ error: "Razorpay returned an invalid payment order" });
      return;
    }
    orders[orderId] = { items: orderItems, amount, machineId, status: "pending", totalUnits, remainingUnits: totalUnits, razorpayOrderId: razorpayOrder.id, createdAt: new Date().toISOString() };
   const upiLink = `upi://pay?pa=${encodeURIComponent(upiId || "")}&pn=${encodeURIComponent(payeeName || "Snack Machine")}&am=${amount}&tr=${orderId}&cu=INR`; res.json({ orderId, razorpayOrderId: razorpayOrder.id, razorpayKeyId, amount, upiLink });
  } catch {
    res.status(502).json({ error: "Razorpay could not be reached" });
  }
});

function markOrderPaid(orderId: string, order: any) {
  if (order.status !== "pending") return;
  order.status = "paid";
  pendingDispense[order.machineId] ||= [];
  for (const item of order.items) for (let index = 0; index < item.qty; index += 1) {
    pendingDispense[order.machineId].push({ commandId: crypto.randomBytes(6).toString("hex"), orderId, slot: item.slot });
  }
}

app.get("/api/order-status/:orderId", (req, res) => {
  const order = orders[req.params.orderId];
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json({ status: order.status });
});

app.get("/api/esp32/poll", (req, res) => {
  if (req.query.secret !== espSecret) { res.status(401).json({ error: "Bad secret" }); return; }
  const queue = pendingDispense[String(req.query.machineId || "machine-01")] || [];
  const next = queue[0];
  res.json(next ? { dispense: true, ...next } : { dispense: false });
});

app.post("/api/esp32/confirm-dispense", (req, res) => {
  if (req.body?.secret !== espSecret) { res.status(401).json({ error: "Bad secret" }); return; }
  const machineId = String(req.body.machineId || "machine-01");
  const queue = pendingDispense[machineId] || [];
  const index = queue.findIndex((command) => command.commandId === req.body.commandId);
  if (index < 0) { res.status(404).json({ error: "Command not found" }); return; }
  const command = queue.splice(index, 1)[0];
  const order = orders[command.orderId];
  if (order) {
    order.remainingUnits = Math.max(0, order.remainingUnits - 1);
    const item = order.items.find((entry: any) => entry.slot === command.slot);
    const product = products.find((entry) => entry.id === item?.productId);
    if (product) product.stock = Math.max(0, product.stock - 1);
    if (order.remainingUnits === 0) order.status = "dispensed";
  }
  res.sendStatus(200);
});

function validAdmin(req: Request, res: Response) {
  if (!adminKey) {
    res.status(503).json({ error: "Admin access is not configured" });
    return false;
  }
  if (req.query.key !== adminKey) {
    res.status(401).json({ error: "Invalid admin key" });
    return false;
  }
  return true;
}

app.get("/api/admin/orders", (req, res) => {
  if (!validAdmin(req, res)) return;
  res.json(Object.entries(orders).map(([orderId, order]) => ({ orderId, ...order })).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)));
});

app.get("/api/admin/summary", (req, res) => {
  if (!validAdmin(req, res)) return;
  const allOrders = Object.values(orders);
  const paidOrders = allOrders.filter((order) => order.status === "paid" || order.status === "dispensed");
  const perProduct: Record<string, any> = {};
  paidOrders.forEach((order) => order.items.forEach((item: any) => {
    perProduct[item.productId] ||= { name: item.name, qtySold: 0, revenue: 0 };
    perProduct[item.productId].qtySold += item.qty;
    perProduct[item.productId].revenue += item.qty * item.price;
  }));
  res.json({
    totalRevenue: paidOrders.reduce((sum, order) => sum + order.amount, 0),
    totalOrders: paidOrders.length,
    pendingOrders: allOrders.filter((order) => order.status === "pending").length,
    dispensedOrders: allOrders.filter((order) => order.status === "dispensed").length,
    perProduct: Object.values(perProduct),
    currentStock: products.map(({ id, name, stock }) => ({ id, name, stock })),
  });
});

app.use("/api", router);
app.use(express.static(publicDir));
app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));
app.get("/admin", (_req, res) => res.sendFile(path.join(publicDir, "admin.html")));
app.get("/status", (_req, res) => res.sendFile(path.join(publicDir, "status.html")));
app.get("/favicon.ico", (_req, res) => res.sendStatus(204));

export default app;
