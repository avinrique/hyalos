const { Router } = require('express');
const db = require('../db');
const authMiddleware = require('../middleware/auth');
const teamAdmin = require('../middleware/teamAdmin');
const { generateInviteCode } = require('../utils/invite');

const router = Router();
router.use(authMiddleware);

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Team name required' });

  const inviteCode = generateInviteCode();
  try {
    const { rows } = await db.query(
      'INSERT INTO teams (name, invite_code, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), inviteCode, req.userId]
    );
    const team = rows[0];
    await db.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3)',
      [team.id, req.userId, 'admin']
    );
    res.status(201).json({ team });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/join', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Invite code required' });

  try {
    const { rows: teams } = await db.query('SELECT * FROM teams WHERE invite_code = $1', [code.trim()]);
    if (teams.length === 0) return res.status(404).json({ error: 'Invalid invite code' });

    const team = teams[0];
    await db.query(
      'INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [team.id, req.userId, 'member']
    );
    res.json({ team });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/mine', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*, tm.role FROM teams t
       JOIN team_members tm ON tm.team_id = t.id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [req.userId]
    );
    res.json({ teams: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/members', teamAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.email, u.name, tm.role, tm.joined_at,
        (SELECT row_to_json(s) FROM (
          SELECT session_pct, week_all_pct, week_sonnet_pct, extra_pct,
            session_input_tokens, session_output_tokens, messages, tool_calls,
            model, today_messages, estimated_cost_usd, last_active, recorded_at
          FROM usage_snapshots WHERE user_id = u.id ORDER BY recorded_at DESC LIMIT 1
        ) s) AS latest_snapshot
       FROM team_members tm
       JOIN users u ON u.id = tm.user_id
       WHERE tm.team_id = $1
       ORDER BY tm.role DESC, u.name ASC`,
      [req.params.id]
    );
    res.json({ members: rows });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/members/:userId', teamAdmin, async (req, res) => {
  if (req.params.userId === req.userId) {
    return res.status(400).json({ error: 'Cannot remove yourself' });
  }
  try {
    await db.query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.params.userId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

router.patch('/:id/members/:userId', teamAdmin, async (req, res) => {
  const { role } = req.body;
  if (!role || !['admin', 'member'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or member' });
  }
  try {
    await db.query(
      'UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3',
      [role, req.params.id, req.params.userId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
