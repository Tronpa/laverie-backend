const express = require('express');
const router  = express.Router();
const db      = require('../config/database');

// ─── GET /forfaits : Liste tous les forfaits actifs ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const forfaits = await db.query(
      'SELECT * FROM forfaits WHERE actif = TRUE ORDER BY ordre ASC'
    );
    // Récupérer les articles pour chaque forfait
    const result = await Promise.all(
      forfaits.rows.map(async (f) => {
        const articles = await db.query(
          'SELECT article, quantite_max FROM forfait_articles WHERE forfait_id = $1',
          [f.id]
        );
        return { ...f, articles: articles.rows };
      })
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /forfaits/:id : Détail d'un forfait ────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const forfait = await db.query('SELECT * FROM forfaits WHERE id = $1 AND actif = TRUE', [req.params.id]);
    if (!forfait.rows.length) return res.status(404).json({ message: 'Forfait introuvable.' });
    const articles = await db.query(
      'SELECT article, quantite_max FROM forfait_articles WHERE forfait_id = $1',
      [req.params.id]
    );
    res.json({ ...forfait.rows[0], articles: articles.rows });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
