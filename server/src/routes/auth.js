const { Router } = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const config = require('../config');
const { hashPassword, comparePassword } = require('../utils/hash');
const { validateEmail, validatePassword, validateName } = require('../utils/validate');
const authMiddleware = require('../middleware/auth');

const router = Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '30d' });
}

function userResponse(row) {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at };
}

router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!validatePassword(password)) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!validateName(name)) return res.status(400).json({ error: 'Name is required' });

  try {
    const hashed = await hashPassword(password);
    const { rows } = await db.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING *',
      [email.trim().toLowerCase(), hashed, name.trim()]
    );
    const user = rows[0];
    res.status(201).json({ token: signToken(user.id), user: userResponse(user) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await comparePassword(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ token: signToken(user.id), user: userResponse(user) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: userResponse(rows[0]) });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
