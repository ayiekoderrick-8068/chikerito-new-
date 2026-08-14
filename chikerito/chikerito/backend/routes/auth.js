const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuid } = require("uuid");
const db = require("../db");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: "firstName, lastName, email, and password are required" });
  }
  const users = db.table("users");
  if (users.where((u) => u.email.toLowerCase() === email.toLowerCase()).length) {
    return res.status(409).json({ error: "An account with this email already exists" });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = users.insert({
    id: uuid(),
    first_name: firstName,
    last_name: lastName,
    email,
    password_hash: passwordHash,
    created_at: new Date().toISOString(),
  });
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const users = db.table("users");
  const user = users.where((u) => u.email.toLowerCase() === (email || "").toLowerCase())[0];
  if (!user) return res.status(401).json({ error: "Invalid email or password" });
  const ok = await bcrypt.compare(password || "", user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

router.get("/me", requireAuth, (req, res) => {
  const user = db.table("users").find(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: publicUser(user) });
});

function publicUser(u) {
  return { id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email };
}

module.exports = router;
