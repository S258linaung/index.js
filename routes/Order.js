const express = require("express");
const Order = require("../models/Order");
const auth = require("../middleware/auth");

const router = express.Router();

// Create order
router.post("/", auth, async (req, res) => {
  const order = new Order({
    ...req.body,
    userId: req.user.userId
  });

  await order.save();
  res.json({ message: "Order created" });
});

// Order history
router.get("/", auth, async (req, res) => {
  const orders = await Order.find({
    userId: req.user.userId
  }).sort({ createdAt: -1 });

  res.json(orders);
});

module.exports = router;
