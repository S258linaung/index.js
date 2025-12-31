const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const router = express.Router();

// Register
router.post("/register", async (req, res) => {
  const { identifier, password } = req.body;

  if (!identifier || !password) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const exists = await User.findOne({ identifier });
  if (exists) {
    return res.status(409).json({ error: "Identifier already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await User.create({ identifier, passwordHash });

  res.json({ message: "Registered successfully" });
});

// Login
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  const user = await User.findOne({ identifier });
  if (!user) return res.status(401).json({ error: "User not found" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: "Wrong password" });

  const token = jwt.sign(
    { userId: user._id },
    process.env.SECRET_KEY,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

module.exports = router;
