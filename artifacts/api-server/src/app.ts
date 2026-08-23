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
  { id: "lays-magic-masala", name: "Lay's Magic Masala", price: 20, slot: 1, stock: 12 },
  { id: "kurkure-masala", name: "Kurkure Masala Munch", price: 20, slot: 2, stock: 10 },
  { id: "bingo-mad-angles", name: "Bingo! Mad Angles", price: 20, slot: 3, stock: 8 },
  { id: " parle-g", name: "Parle-G", price: 10, slot: 4, stock: 15 },
  { id: "coke", name: "Coca-Cola", price: 40, slot: 5, stock: 8 },
  { id: "water", name: "Water", price: 20, slot: 6, stock: 20 },
];
const orders: Record<string, any> = {};
const pendingDispense: Record<string, any[]> = {};
const upiId = process.env["UPI_ID"] || "demo-vending@upi";
const payeeName = process.env["UPI_PAYEE_NAME"] || "SIT Vending Machine";
const adminKey = process.env["ADMIN_KEY"] || "demo-admin-key";
const espSecret = process.env["ESP32_SHARED_SECRET"] || "demo-esp32-secret";
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/products", (_req, res) => {
  res.json(products.map(({ id, name, price, stock }) => ({ id, name, price, stock })));
});

app.post("/api/create-order", (req, res) => {
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
  orders[orderId] = { items: orderItems, amount, machineId, status: "pending", totalUnits, remainingUnits: totalUnits, createdAt: new Date().toISOString() };
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR&tn=${encodeURIComponent(`Order ${orderId}`)}`;
  res.json({ orderId, upiLink, amount });
});

app.post("/api/confirm-payment", (req, res) => {
  const order = orders[req.body?.orderId];
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (order.status === "pending") {
    order.status = "paid";
    pendingDispense[order.machineId] ||= [];
    for (const item of order.items) for (let index = 0; index < item.qty; index += 1) {
      pendingDispense[order.machineId].push({ commandId: crypto.randomBytes(6).toString("hex"), orderId: req.body.orderId, slot: item.slot });
    }
  }
  res.json({ status: order.status });
});

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
