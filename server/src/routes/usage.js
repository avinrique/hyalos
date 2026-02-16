const { Router } = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

router.post('/sync', async (req, res) => {
  const s = req.body;
  try {
    await db.query(
      `INSERT INTO usage_snapshots (
        user_id, session_pct, week_all_pct, week_sonnet_pct, extra_pct,
        session_input_tokens, session_output_tokens, session_cache_read_tokens, session_cache_write_tokens,
        messages, tool_calls, model, total_sessions, total_messages, today_messages,
        estimated_cost_usd, last_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        req.userId,
        s.sessionPct ?? null, s.weekAllPct ?? null, s.weekSonnetPct ?? null, s.extraPct ?? null,
        s.sessionInputTokens ?? 0, s.sessionOutputTokens ?? 0,
        s.sessionCacheReadTokens ?? 0, s.sessionCacheWriteTokens ?? 0,
        s.messages ?? 0, s.toolCalls ?? 0, s.model ?? null,
        s.totalSessions ?? 0, s.totalMessages ?? 0, s.todayMessages ?? 0,
        s.estimatedCostUsd ?? 0, s.lastActive ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/history', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  try {
    const { rows } = await db.query(
      'SELECT * FROM usage_snapshots WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT $2',
      [req.userId, limit]
    );
    res.json({ snapshots: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
