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
    const token = jwt.sign({ id: admin.id, email: admin.email, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
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
    res.json({
      nouvelles: parseInt(nouvelles.rows[0].count),
      en_cours: parseInt(en_cours.rows[0].count),
      livrees_jour: parseInt(livrees_jour.rows[0].count),
      revenus_jour: parseFloat(revenus_jour.rows[0].total),
    });
  } catch (err) {
    console.error('Erreur stats admin:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// GET /admin/commandes
router.get('/commandes', authAdmin, async (req, res) => {
  try {
    const { statut } = req.query;
    let where = '1=1'; const params = [];
    if (statut) { params.push(statut); where += ` AND c.statut = $${params.length}`; }
    const result = await db.query(
      `SELECT c.id, c.statut, c.montant_total, c.rdv_collecte, c.adresse_collecte, c.note_client, c.created_at,
              c.forfait_id, c.user_id,
              f.nom AS forfait_nom,
              u.prenom, u.nom AS user_nom, u.telephone, u.email
       FROM commandes c
       LEFT JOIN forfaits f ON c.forfait_id = f.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE ${where}
       ORDER BY c.rdv_collecte ASC`,
      params
    );
    res.json({ commandes: result.rows });
  } catch (err) {
    console.error('Erreur commandes admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// PATCH /admin/commandes/:id/statut
router.patch('/commandes/:id/statut', authAdmin, async (req, res) => {
  try {
    const { statut } = req.body;
    const valides = ['en_attente','confirmee','collectee','en_lavage','prete','livree','annulee'];
    if (!valides.includes(statut)) return res.status(400).json({ message: 'Statut invalide.' });
    const result = await db.query('UPDATE commandes SET statut = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [statut, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    try { await notifierChangementStatut(result.rows[0]); } catch(e) {}
    res.json({ message: 'Statut mis à jour.', commande: result.rows[0] });
  } catch (err) {
    console.error('Erreur statut admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// PUT /admin/commandes/:id : modifier une commande (date, adresse, forfait, note)
router.put('/commandes/:id', authAdmin, async (req, res) => {
  try {
    const { rdv_collecte, adresse_collecte, forfait_id, note_client } = req.body;
    let montant = null;
    if (forfait_id) {
      const f = await db.query('SELECT prix FROM forfaits WHERE id = $1', [forfait_id]);
      if (f.rows.length) montant = f.rows[0].prix;
    }
    const result = await db.query(
      `UPDATE commandes SET
         rdv_collecte = COALESCE($1, rdv_collecte),
         adresse_collecte = COALESCE($2, adresse_collecte),
         forfait_id = COALESCE($3, forfait_id),
         note_client = COALESCE($4, note_client),
         montant_total = COALESCE($5, montant_total),
         updated_at = NOW()
       WHERE id = $6 RETURNING *`,
      [rdv_collecte, adresse_collecte, forfait_id, note_client, montant, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    res.json({ message: 'Commande modifiée.', commande: result.rows[0] });
  } catch (err) {
    console.error('Erreur modif commande:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// DELETE /admin/commandes/:id : supprimer définitivement
router.delete('/commandes/:id', authAdmin, async (req, res) => {
  try {
    await db.query('DELETE FROM commande_articles WHERE commande_id = $1', [req.params.id]);
    const result = await db.query('DELETE FROM commandes WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    res.json({ message: 'Commande supprimée.' });
  } catch (err) {
    console.error('Erreur suppr commande:', err);
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
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur clients admin:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// PUT /admin/clients/:id : modifier un client
router.put('/clients/:id', authAdmin, async (req, res) => {
  try {
    const { prenom, nom, email, telephone, adresse } = req.body;
    const result = await db.query(
      `UPDATE users SET
         prenom = COALESCE($1, prenom),
         nom = COALESCE($2, nom),
         email = COALESCE($3, email),
         telephone = COALESCE($4, telephone),
         adresse = COALESCE($5, adresse)
       WHERE id = $6 RETURNING id, prenom, nom, email, telephone, adresse`,
      [prenom, nom, email, telephone, adresse, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Client introuvable.' });
    res.json({ message: 'Client modifié.', client: result.rows[0] });
  } catch (err) {
    console.error('Erreur modif client:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// DELETE /admin/clients/:id : désactiver un client (soft delete)
router.delete('/clients/:id', authAdmin, async (req, res) => {
  try {
    const result = await db.query('UPDATE users SET actif = FALSE WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Client introuvable.' });
    res.json({ message: 'Client désactivé.' });
  } catch (err) {
    console.error('Erreur suppr client:', err);
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

// POST /admin/forfaits : créer un forfait
router.post('/forfaits', authAdmin, async (req, res) => {
  try {
    const { nom, description, prix, ordre } = req.body;
    if (!nom) return res.status(400).json({ message: 'Nom requis.' });
    const result = await db.query(
      `INSERT INTO forfaits (nom, description, prix, actif, ordre)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
      [nom, description || '', prix || 0, ordre || 99]
    );
    res.status(201).json({ message: 'Forfait créé.', forfait: result.rows[0] });
  } catch (err) {
    console.error('Erreur create forfait:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// PUT /admin/forfaits/:id : modifier un forfait
router.put('/forfaits/:id', authAdmin, async (req, res) => {
  try {
    const { nom, description, prix, actif, ordre } = req.body;
    const result = await db.query(
      `UPDATE forfaits SET
         nom = COALESCE($1, nom),
         description = COALESCE($2, description),
         prix = COALESCE($3, prix),
         actif = COALESCE($4, actif),
         ordre = COALESCE($5, ordre)
       WHERE id = $6 RETURNING *`,
      [nom, description, prix, actif, ordre, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Forfait introuvable.' });
    res.json({ message: 'Forfait modifié.', forfait: result.rows[0] });
  } catch (err) {
    console.error('Erreur modif forfait:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

// DELETE /admin/forfaits/:id : supprimer un forfait
router.delete('/forfaits/:id', authAdmin, async (req, res) => {
  try {
    const result = await db.query('DELETE FROM forfaits WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ message: 'Forfait introuvable.' });
    res.json({ message: 'Forfait supprimé.' });
  } catch (err) {
    // Si le forfait est utilisé par des commandes, on le désactive au lieu de le supprimer
    try {
      await db.query('UPDATE forfaits SET actif = FALSE WHERE id = $1', [req.params.id]);
      return res.json({ message: 'Forfait désactivé (utilisé par des commandes existantes).' });
    } catch(e2) {
      res.status(500).json({ message: 'Erreur serveur: ' + err.message });
    }
  }
});

// GET /admin/tournees
router.get('/tournees', authAdmin, async (req, res) => {
  try {
    const { date } = req.query;
    const jour = date || new Date().toISOString().split('T')[0];
    const result = await db.query(
      `SELECT c.id, c.statut, c.adresse_collecte, c.rdv_collecte, c.montant_total,
              u.prenom, u.nom AS user_nom, u.telephone, f.nom AS forfait_nom
       FROM commandes c
       JOIN users u ON c.user_id = u.id
       JOIN forfaits f ON c.forfait_id = f.id
       WHERE DATE(c.rdv_collecte) = $1 AND c.statut NOT IN ('annulee','livree')
       ORDER BY c.rdv_collecte ASC`,
      [jour]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  }
});

module.exports = router;
