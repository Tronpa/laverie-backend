const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authAdmin } = require('../middleware/auth');

// Stockage simple des paramètres dans une table clé/valeur.
// Crée la table au besoin (idempotent).
async function ensureTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS parametres (
    cle TEXT PRIMARY KEY,
    valeur JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
}

const DEFAUT_CRENEAUX = { jours: [1,2,3,4,5,6], heures: ['08:00','10:00','14:00','16:00','18:00'] };

// GET /parametres/creneaux : public (utilisé par le site client)
router.get('/creneaux', async (req, res) => {
  try {
    await ensureTable();
    const r = await db.query("SELECT valeur FROM parametres WHERE cle = 'creneaux'");
    if (!r.rows.length) return res.json(DEFAUT_CRENEAUX);
    res.json(r.rows[0].valeur);
  } catch (err) {
    console.error('Erreur get creneaux:', err);
    res.json(DEFAUT_CRENEAUX);
  }
});

// PUT /parametres/creneaux : admin seulement
router.put('/creneaux', authAdmin, async (req, res) => {
  try {
    await ensureTable();
    const { jours, heures } = req.body;
    const valeur = {
      jours: Array.isArray(jours) ? jours : DEFAUT_CRENEAUX.jours,
      heures: Array.isArray(heures) ? heures : DEFAUT_CRENEAUX.heures,
    };
    await db.query(
      `INSERT INTO parametres (cle, valeur, updated_at) VALUES ('creneaux', $1, NOW())
       ON CONFLICT (cle) DO UPDATE SET valeur = $1, updated_at = NOW()`,
      [JSON.stringify(valeur)]
    );
    res.json({ message: 'Créneaux mis à jour.', creneaux: valeur });
  } catch (err) {
    console.error('Erreur put creneaux:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
