const db = require('../db');

function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.redirect('/admin/login');
}

function requireSetup(req, res, next) {
  const hasUser = db.getDb().prepare('SELECT 1 FROM users LIMIT 1').get();
  if (!hasUser) return next();
  res.redirect('/admin');
}

function requireNoSetup(req, res, next) {
  const hasUser = db.getDb().prepare('SELECT 1 FROM users LIMIT 1').get();
  if (hasUser) return next();
  res.redirect('/admin/setup');
}

module.exports = { requireLogin, requireSetup, requireNoSetup };
