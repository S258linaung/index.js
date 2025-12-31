// server.js - FULL MERGED VERSION
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const mongoose = require("mongoose");
const axios = require("axios");
const http = require("http");
const { Server } = require("socket.io");
const validasi = require("./lib/validasi");
const countryList = require("./utils/data.json");
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || "change_this_secret";

/* ===================== MIDDLEWARE ===================== */
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

/* ===================== MONGODB ===================== */
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    console.error("❌ MONGO_URI not defined");
    process.exit(1);
}

mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });

/* ===================== SCHEMAS ===================== */
const Admin = mongoose.model("Admin", new mongoose.Schema({
    username: String,
    passwordHash: String
}, { collection: "admins" }));

const Order = mongoose.model("Order", new mongoose.Schema({
    userEmail: String,
    gameId: String,
    username: String,
    serverId: String,
    packageName: String,
    price: Number,
    paymentMethod: String,
    transactionId: String,
    orderNote: String,
    paymentScreenshot: String,
    status: { type: String, default: "pending" },
    receiver: { type: String, default: "N/A" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date
}, { collection: "orders" }));



// --- Ensure uploads folder exists ---
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- Multer setup ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.\-_]/g, "");
        cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + "-" + safeName);
    }
});


const upload = multer({ storage });

/* ===================== SOCKET.IO ===================== */

// --- Socket.IO Setup ---
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", socket => {
    console.log("User connected:", socket.id);

    socket.on("register", userId => {
        socket.join(userId);
        console.log("User joined room:", userId);
    });
});

// --- Auth Middleware ---
function auth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: "No token" });
    const token = (authHeader.split(" ")[1] || "").trim();
    if (!token) return res.status(401).json({ error: "No token" });

    jwt.verify(token, SECRET_KEY, (err, payload) => {
        if (err) return res.status(401).json({ error: "Invalid token" });
        req.user = payload;
        next();
    });
}

/* ===================== ROUTES ===================== */

// --- Admin login ---
app.post("/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Missing username or password" });

    try {
        let admin = await Admin.findOne({ username });
        if (!admin) return res.status(401).json({ error: "Invalid username or password" });

        const match = await bcrypt.compare(password, admin.passwordHash);
        if (!match) return res.status(401).json({ error: "Invalid username or password" });

        const token = jwt.sign({ username: admin.username }, SECRET_KEY, { expiresIn: "12h" });
        res.json({ message: "Login successful", token });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Get all orders ---
app.get("/admin/orders", auth, async (req, res) => {
    try {
        const orders = await Order.find();
        res.json(orders);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Update order status ---
app.post("/admin/orders/:id/status", auth, async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "Missing status" });

    try {
        const order = await Order.findById(id);
        if (!order) return res.status(404).json({ error: "Order not found" });

        order.status = status;
        order.updatedAt = new Date();
        await order.save();

        io.to(order._id.toString()).emit("order_status", {
            status,
            message: `Your order is now ${status.toUpperCase()}`
        });

        await sendTelegramNotification(order, status);

        res.json({ message: "Status updated", order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});

// --- Create new order ---
app.post("/order", upload.single("paymentScreenshot"), async (req, res) => {
    console.log("Uploaded file info:", req.file);  // ဒီကိုစစ်ရန်
    try {
        let screenshotUrl = "";
        if (req.file && req.file.filename) {
            screenshotUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
        }

        const order = new Order({ ...req.body,userEmail: req.body.email, paymentScreenshot: screenshotUrl });
        await order.save();

        io.to(order._id.toString()).emit("order_status", {
            status: "pending",
            message: "Your order was submitted successfully!"
        });

        await sendTelegramNotification(order, "pending");

        res.json({ message: "ဝယ်ယူခြင်းအောင်မြင်ပါသည်။", order });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server error" });
    }
});



// Validasi API
app.get("/api/validasi", async (req, res) => {
    const { id, serverid } = req.query;
    if (!id || !serverid) return res.sendStatus(400);

    const data = await validasi(id, serverid);
    res.json({
        nickname: data["in-game-nickname"],
        country: countryList.find(c => c.countryShortCode === data.country)?.countryName || "Unknown"
    });
});



// --- Telegram helper ---
async function sendTelegramNotification(order, status) {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    if (!BOT_TOKEN || !CHAT_ID) return;

    const text = `
    📣 Order Update
    Order ID: ${order._id}
    User: ${order.username}
    Package: ${order.packageName}
    Game ID: ${order.gameId}
    Server: ${order.serverId}
    Payment: ${order.paymentMethod}
    TX: ${order.transactionId}
    Status: ${status}
    Time: ${new Date().toLocaleString()}
    `;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, { chat_id: CHAT_ID, text });
    } catch (err) {
        console.error("Telegram error:", err);
    }
}
// Health
app.get("/health", (_, res) => res.json({ ok: true }));

// 🔹 Order history (by email)
app.get("/orders", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.json([]);

    const orders = await Order.find({ userEmail: email }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    console.error("Order history error:", err);
    res.status(500).json([]);
  }
});

/* ===================== START ===================== */
server.listen(PORT, () =>
    console.log(`🚀 Server running on port ${PORT}`)
);
