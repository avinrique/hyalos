const db = require('../db');

module.exports = async (req, res, next) => {
  const { id: teamId } = req.params;
  const userId = req.userId;
  try {
    const { rows } = await db.query(
      'SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'Not a member' });
    if (rows[0].role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};
