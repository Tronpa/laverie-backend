const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authClient } = require('../middleware/auth');
const { notifierChangementStatut } = require('../services/notifications');
const { verifierZone } = require('../services/zone');

// --- GET /commandes/creneaux : creneaux disponibles ---
router.get('/creneaux', authClient, async (req, res) => {
  try {
    const creneaux = [];
    const now = new Date();
    for (let jour = 0; jour < 7; jour++) {
      const date = new Date(now);
      date.setDate(now.getDate() + jour + 1);
      if (date.getDay() === 0) continue;
      const dateStr = date.toISOString().split('T')[0];
      for (const heure of ['08:00', '10:00', '14:00', '16:00']) {
        const debut = new Date(dateStr + 'T' + heure + ':00');
        const fin   = new Date(debut.getTime() + 2 * 60 * 60 * 1000);
        const count = await db.query(
          `SELECT COUNT(*) FROM commandes WHERE rdv_collecte >= $1 AND rdv_collecte < $2 AND statut NOT IN ('annulee')`,
          [debut, fin]
        );
        const nbPris = parseInt(count.rows[0].count);
        creneaux.push({
          debut: debut.toISOString(),
          fin: fin.toISOString(),
          label: heure.replace(':00','') + 'h - ' + String(fin.getHours()).padStart(2,'0') + 'h',
          disponible: nbPris < 5,
          nb_pris: nbPris,
        });
      }
    }
    res.json(creneaux);
  } catch (err) {
    console.error('Erreur creneaux:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// --- GET /commandes : commandes du client connecte ---
router.get('/', authClient, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, f.nom AS forfait_nom, f.prix AS forfait_prix
       FROM commandes c
       LEFT JOIN forfaits f ON c.forfait_id = f.id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json({ commandes: result.rows });
  } catch (err) {
    console.error('Erreur liste commandes:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// --- GET /commandes/mes-commandes : alias pratique (site web) ---
router.get('/mes-commandes', authClient, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, f.nom AS forfait_nom, f.prix AS forfait_prix
       FROM commandes c
       LEFT JOIN forfaits f ON c.forfait_id = f.id
       WHERE c.user_id = $1
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );
    res.json({ commandes: result.rows });
  } catch (err) {
    console.error('Erreur mes-commandes:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// --- GET /commandes/:id ---
router.get('/:id', authClient, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, f.nom AS forfait_nom, u.prenom, u.nom AS user_nom, u.telephone
       FROM commandes c
       LEFT JOIN forfaits f ON c.forfait_id = f.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = $1 AND c.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erreur detail commande:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// --- POST /commandes : creer une commande (geocode l'adresse + valide la zone) ---
router.post('/', authClient, async (req, res) => {
  const client = await db.connect();
  try {
    // accepte 'note' (site) ou 'note_client' (app)
    const forfait_id = req.body.forfait_id;
    const adresse_collecte = req.body.adresse_collecte;
    const rdv_collecte = req.body.rdv_collecte;
    const articles = req.body.articles;
    const note_client = req.body.note || req.body.note_client || null;

    if (!forfait_id || !adresse_collecte || !rdv_collecte) {
      return res.status(400).json({ message: 'Forfait, adresse et creneau requis.' });
    }

    const forfait = await db.query('SELECT * FROM forfaits WHERE id = $1 AND actif = TRUE', [forfait_id]);
    if (!forfait.rows.length) return res.status(404).json({ message: 'Forfait introuvable.' });

    // Geocodage + verification de zone (10 km)
    let lat = null, lng = null;
    try {
      const zone = await verifierZone(adresse_collecte);
      lat = zone.lat; lng = zone.lng;
      if (!zone.dans_zone) {
        return res.status(400).json({ message: 'Adresse hors zone : nous collectons dans un rayon de 10 km autour de la laverie (distance ' + zone.distance + ' km).' });
      }
    } catch (geoErr) {
      return res.status(400).json({ message: 'Adresse introuvable. Verifiez l adresse saisie.' });
    }

    await client.query('BEGIN');

    const cmd = await client.query(
      `INSERT INTO commandes (user_id, forfait_id, adresse_collecte, lat_collecte, lng_collecte, rdv_collecte, montant_total, note_client)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, forfait_id, adresse_collecte, lat, lng, rdv_collecte, forfait.rows[0].prix, note_client]
    );
    const commande = cmd.rows[0];

    if (articles && articles.length) {
      for (const art of articles) {
        await client.query(
          'INSERT INTO commande_articles (commande_id, article, quantite) VALUES ($1, $2, $3)',
          [commande.id, art.article, art.quantite || 1]
        );
      }
    }

    await client.query('COMMIT');

    try { await notifierChangementStatut({ ...commande, statut: 'en_attente', user_id: req.user.id }); } catch(e) {}

    res.status(201).json({ message: 'Commande creee avec succes !', commande });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur creation commande:', err);
    res.status(500).json({ message: 'Erreur serveur: ' + err.message });
  } finally {
    client.release();
  }
});

// --- PATCH /commandes/:id/annuler ---
router.patch('/:id/annuler', authClient, async (req, res) => {
  try {
    const commande = await db.query('SELECT * FROM commandes WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!commande.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    if (!['en_attente', 'confirmee'].includes(commande.rows[0].statut)) {
      return res.status(400).json({ message: 'Cette commande ne peut plus etre annulee.' });
    }
    await db.query('UPDATE commandes SET statut = $1, updated_at = NOW() WHERE id = $2', ['annulee', req.params.id]);
    try { await notifierChangementStatut({ ...commande.rows[0], statut: 'annulee' }); } catch(e) {}
    res.json({ message: 'Commande annulee.' });
  } catch (err) {
    console.error('Erreur annulation:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
