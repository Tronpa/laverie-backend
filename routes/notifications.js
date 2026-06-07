const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authClient } = require('../middleware/auth');

// ─── GET /notifications : Toutes les notifs de l'utilisateur ───────────────
router.get('/', authClient, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    const nonLues = result.rows.filter(n => !n.lu).length;
    res.json({ notifications: result.rows, non_lues: nonLues });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── PATCH /notifications/:id/lu : Marquer comme lue ───────────────────────
router.patch('/:id/lu', authClient, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET lu = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Notification marquée comme lue.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── PATCH /notifications/tout-lire : Tout marquer comme lu ────────────────
router.patch('/tout-lire', authClient, async (req, res) => {
  try {
    await db.query(
      'UPDATE notifications SET lu = TRUE WHERE user_id = $1',
      [req.user.id]
    );
    res.json({ message: 'Toutes les notifications marquées comme lues.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── DELETE /notifications : Supprimer toutes les notifs lues ──────────────
router.delete('/', authClient, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM notifications WHERE user_id = $1 AND lu = TRUE',
      [req.user.id]
    );
    res.json({ message: 'Notifications lues supprimées.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
