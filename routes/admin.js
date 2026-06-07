const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/database');
const { authAdmin } = require('../middleware/auth');
const { notifierChangementStatut } = require('../services/notifications');

// POST /admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    const result = await db.query('SELECT * FROM admins WHERE email = $1', [email]);
    const admin  = result.rows[0];
    if (!admin) return res.status(401).json({ message: 'Identifiants invalides.' });
    const ok = await bcrypt.compare(mot_de_passe, admin.mot_de_passe);
    if (!ok) return res.status(401).json({ message: 'Identifiants invalides.' });
    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, admin: { id: admin.id, prenom: admin.prenom, nom: admin.nom, email: admin.email } });
  } catch (err) {
    console.error('Erreur login admin:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// GET /admin/stats
router.get('/stats', authAdmin, async (req, res) => {
  try {
    const aujourd_hui = new Date().toISOString().split('T')[0];
    const nouvelles    = await db.query(`SELECT COUNT(*) FROM commandes WHERE DATE(created_at) = $1 AND statut != 'annulee'`, [aujourd_hui]);
    const en_cours     = await db.query(`SELECT COUNT(*) FROM commandes WHERE statut IN ('confirmee','collectee','en_lavage','prete')`);
    const livrees_jour = await db.query(`SELECT COUNT(*) FROM commandes WHERE DATE(updated_at) = $1 AND statut = 'livree'`, [aujourd_hui]);
    const revenus_jour = await db.query(`SELECT COALESCE(SUM(montant_total),0) AS total FROM commandes WHERE DATE(created_at) = $1 AND statut != 'annulee'`, [aujourd_hui]);
    const total_clients = await db.query(`SELECT COUNT(*) FROM users WHERE actif = TRUE`);
    res.json({
      nouvelles:     parseInt(nouvelles.rows[0].count),
      en_cours:      parseInt(en_cours.rows[0].count),
      livrees_jour:  parseInt(livrees_jour.rows[0].count),
      revenus_jour:  parseFloat(revenus_jour.rows[0].total),
      total_clients: parseInt(total_clients.rows[0].count),
    });
  } catch (err) {
    console.error('Erreur stats admin:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// GET /admin/commandes
router.get('/commandes', authAdmin, async (req, res) => {
  try {
    const { statut, limit = 100, offset = 0 } = req.query;
    let whereClause = '1=1';
    const params = [];
    if (statut) {
      params.push(statut);
      whereClause += ` AND c.statut = $${params.length}`;
    }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    const result = await db.query(
      `SELECT c.id, c.statut, c.montant_total, c.rdv_collecte, c.rdv_livraison, c.adresse_collecte, c.created_at,
              f.nom AS forfait_nom,
              u.prenom, u.nom AS user_nom, u.telephone, u.email
       FROM commandes c
       LEFT JOIN forfaits f ON c.forfait_id = f.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE ${whereClause}
       ORDER BY c.rdv_collecte ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ commandes: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Erreur commandes admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// PATCH /admin/commandes/:id/statut
router.patch('/commandes/:id/statut', authAdmin, async (req, res) => {
  try {
    const { statut } = req.body;
    const statuts_valides = ['confirmee','collectee','en_lavage','prete','livree','annulee'];
    if (!statuts_valides.includes(statut)) {
      return res.status(400).json({ message: 'Statut invalide.' });
    }
    const result = await db.query(
      `UPDATE commandes SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [statut, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    try { await notifierChangementStatut(result.rows[0]); } catch(e) {}
    res.json({ message: 'Statut mis a jour: ' + statut, commande: result.rows[0] });
  } catch (err) {
    console.error('Erreur statut admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// GET /admin/tournees
router.get('/tournees', authAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    const jour = date || new Date().toISOString().split('T')[0];
    const result = await db.query(
      `SELECT c.id, c.statut, c.adresse_collecte, c.rdv_collecte, c.montant_total,
              u.prenom, u.nom AS user_nom, u.telephone,
              f.nom AS forfait_nom
       FROM commandes c
       JOIN users u ON c.user_id = u.id
       JOIN forfaits f ON c.forfait_id = f.id
       WHERE DATE(c.rdv_collecte) = $1 AND c.statut NOT IN ('annulee','livree')
       ORDER BY c.rdv_collecte ASC`,
      [jour]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur tournees admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// GET /admin/clients
router.get('/clients', authAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.prenom, u.nom, u.email, u.telephone, u.adresse, u.created_at,
              COUNT(c.id) AS nb_commandes,
              COALESCE(SUM(c.montant_total), 0) AS total_depense
       FROM users u
       LEFT JOIN commandes c ON u.id = c.user_id AND c.statut != 'annulee'
       WHERE u.actif = TRUE
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT 100`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur clients admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// GET /admin/forfaits
router.get('/forfaits', authAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM forfaits ORDER BY ordre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// PUT /admin/forfaits/:id
router.put('/forfaits/:id', authAdmin, async (req, res) => {
  try {
    const { nom, description, prix, actif, ordre } = req.body;
    const result = await db.query(
      `UPDATE forfaits SET nom=$1, description=$2, prix=$3, actif=$4, ordre=$5 WHERE id=$6 RETURNING *`,
      [nom, description, prix, actif, ordre, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;

