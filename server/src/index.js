const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const authRoutes = require('./routes/auth');
const usageRoutes = require('./routes/usage');
const teamsRoutes = require('./routes/teams');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/usage', usageRoutes);
app.use('/teams', teamsRoutes);

app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`Hyalos API running on port ${config.port}`);
});
