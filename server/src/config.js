require('dotenv').config();

module.exports = {
  dbUrl: process.env.DB_URL || 'postgres://localhost:5432/hyalos',
  jwtSecret: process.env.JWT_SECRET || 'change-me',
  port: parseInt(process.env.PORT, 10) || 3001,
};
