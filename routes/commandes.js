const express = require('express');
const router  = express.Router();
const db      = require('../config/database');
const { authClient } = require('../middleware/auth');
const { notifierChangementStatut } = require('../services/notifications');

// ─── GET /commandes/creneaux : Créneaux disponibles ─────────────────────────
// Retourne les créneaux libres pour les 7 prochains jours
router.get('/creneaux', authClient, async (req, res) => {
  try {
    const creneaux = [];
    const now = new Date();

    for (let jour = 0; jour < 7; jour++) {
      const date = new Date(now);
      date.setDate(now.getDate() + jour + 1);
      // Pas de collecte le dimanche (0)
      if (date.getDay() === 0) continue;

      const dateStr = date.toISOString().split('T')[0];

      for (const heure of ['08:00', '10:00', '14:00', '16:00']) {
        const debut = new Date(`${dateStr}T${heure}:00`);
        const fin   = new Date(debut.getTime() + 2 * 60 * 60 * 1000);

        // Vérifier le nombre de commandes déjà prises sur ce créneau (max 5)
        const count = await db.query(
          `SELECT COUNT(*) FROM commandes
           WHERE rdv_collecte >= $1 AND rdv_collecte < $2
           AND statut NOT IN ('annulee')`,
          [debut, fin]
        );
        const nbPris = parseInt(count.rows[0].count);

        creneaux.push({
          debut: debut.toISOString(),
          fin:   fin.toISOString(),
          label: `${heure.replace(':00','')}h – ${String(fin.getHours()).padStart(2,'0')}h`,
          disponible: nbPris < 5,
          nb_pris: nbPris,
        });
      }
    }
    res.json(creneaux);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /commandes : Toutes les commandes du client connecté ───────────────
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
    // Ajouter les articles de chaque commande
    const commandes = await Promise.all(
      result.rows.map(async (cmd) => {
        const articles = await db.query(
          'SELECT article, quantite FROM commande_articles WHERE commande_id = $1',
          [cmd.id]
        );
        return { ...cmd, articles: articles.rows };
      })
    );
    res.json(commandes);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── GET /commandes/:id : Détail d'une commande ─────────────────────────────
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

    const articles = await db.query(
      'SELECT article, quantite FROM commande_articles WHERE commande_id = $1',
      [req.params.id]
    );
    res.json({ ...result.rows[0], articles: articles.rows });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── POST /commandes : Créer une nouvelle commande ──────────────────────────
router.post('/', authClient, async (req, res) => {
  const client = await db.connect();
  try {
    const { forfait_id, adresse_collecte, lat_collecte, lng_collecte, rdv_collecte, articles, note_client } = req.body;

    if (!forfait_id || !adresse_collecte || !rdv_collecte) {
      return res.status(400).json({ message: 'Forfait, adresse et créneau requis.' });
    }

    const forfait = await db.query('SELECT * FROM forfaits WHERE id = $1 AND actif = TRUE', [forfait_id]);
    if (!forfait.rows.length) return res.status(404).json({ message: 'Forfait introuvable.' });

    await client.query('BEGIN');

    const cmd = await client.query(
      `INSERT INTO commandes (user_id, forfait_id, adresse_collecte, lat_collecte, lng_collecte, rdv_collecte, montant_total, note_client)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.user.id, forfait_id, adresse_collecte, lat_collecte, lng_collecte, rdv_collecte, forfait.rows[0].prix, note_client || null]
    );
    const commande = cmd.rows[0];

    // Insérer les articles si fournis
    if (articles && articles.length) {
      for (const art of articles) {
        await client.query(
          'INSERT INTO commande_articles (commande_id, article, quantite) VALUES ($1, $2, $3)',
          [commande.id, art.article, art.quantite || 1]
        );
      }
    }

    await client.query('COMMIT');

    // Notification de confirmation
    await notifierChangementStatut({ ...commande, statut: 'en_attente', user_id: req.user.id });

    res.status(201).json({ message: 'Commande créée avec succès !', commande });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// ─── PATCH /commandes/:id/annuler : Annuler une commande ────────────────────
router.patch('/:id/annuler', authClient, async (req, res) => {
  try {
    const commande = await db.query(
      'SELECT * FROM commandes WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (!commande.rows.length) return res.status(404).json({ message: 'Commande introuvable.' });
    if (!['en_attente', 'confirmee'].includes(commande.rows[0].statut)) {
      return res.status(400).json({ message: 'Cette commande ne peut plus être annulée.' });
    }
    await db.query(
      'UPDATE commandes SET statut = $1, updated_at = NOW() WHERE id = $2',
      ['annulee', req.params.id]
    );
    await notifierChangementStatut({ ...commande.rows[0], statut: 'annulee' });
    res.json({ message: 'Commande annulée.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// ─── POST /commandes/:id/avis : Laisser un avis ─────────────────────────────
router.post('/:id/avis', authClient, async (req, res) => {
  try {
    const { note, commentaire } = req.body;
    if (!note || note < 1 || note > 5) return res.status(400).json({ message: 'Note entre 1 et 5 requise.' });

    const commande = await db.query(
      'SELECT * FROM commandes WHERE id = $1 AND user_id = $2 AND statut = $3',
      [req.params.id, req.user.id, 'livree']
    );
    if (!commande.rows.length) return res.status(404).json({ message: 'Commande introuvable ou non livrée.' });

    await db.query(
      'INSERT INTO avis (user_id, commande_id, note, commentaire) VALUES ($1, $2, $3, $4)',
      [req.user.id, req.params.id, note, commentaire || null]
    );
    res.status(201).json({ message: 'Merci pour votre avis !' });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ message: 'Vous avez déjà laissé un avis pour cette commande.' });
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

module.exports = router;
