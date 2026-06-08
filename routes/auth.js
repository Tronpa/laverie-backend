const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/database');
const { verifierZone } = require('../services/zone');
const { authClient }   = require('../middleware/auth');

function genToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
}
function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /auth/check-zone
router.post('/check-zone', async (req, res) => {
  try {
    const { adresse } = req.body;
    if (!adresse) return res.status(400).json({ message: 'Adresse requise.' });
    const result = await verifierZone(adresse);
    res.json(result);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// POST /auth/register
router.post('/register', async (req, res) => {
  try {
    const { prenom, nom, email, telephone, mot_de_passe, adresse } = req.body;
    if (!prenom || !nom || !email || !telephone || !mot_de_passe || !adresse) {
      return res.status(400).json({ message: 'Tous les champs sont requis.' });
    }
    const emailExiste = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailExiste.rows.length) return res.status(400).json({ message: 'Cet email est déjà utilisé.' });
    const telExiste = await db.query('SELECT id FROM users WHERE telephone = $1', [telephone]);
    if (telExiste.rows.length) return res.status(400).json({ message: 'Ce numéro est déjà utilisé.' });

    const zone = await verifierZone(adresse);
    if (!zone.dans_zone) {
      return res.status(400).json({
        message: 'Désolé, votre adresse est à ' + zone.distance + ' km. Nous ne livrons que dans un rayon de ' + process.env.RAYON_MAX_KM + ' km.',
        distance: zone.distance, dans_zone: false,
      });
    }
    const hash = await bcrypt.hash(mot_de_passe, 10);
    const result = await db.query(
      `INSERT INTO users (prenom, nom, email, telephone, mot_de_passe, adresse, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, prenom, nom, email, telephone, adresse`,
      [prenom, nom, email, telephone, hash, zone.adresse_formatee, zone.lat, zone.lng]
    );
    const user = result.rows[0];
    try { await envoyerOTP(telephone); } catch(e) {}
    const token = genToken({ id: user.id, email: user.email, role: 'client' });
    res.status(201).json({ message: 'Inscription réussie !', token, user });
  } catch (err) {
    console.error('Erreur register:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    if (!email || !mot_de_passe) return res.status(400).json({ message: 'Email et mot de passe requis.' });
    const result = await db.query('SELECT * FROM users WHERE email = $1 AND actif = TRUE', [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    const ok = await bcrypt.compare(mot_de_passe, user.mot_de_passe);
    if (!ok) return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    const token = genToken({ id: user.id, email: user.email, role: 'client' });
    const { mot_de_passe: _, ...userSafe } = user;
    res.json({ token, user: userSafe });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// GET /auth/me
router.get('/me', authClient, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, prenom, nom, email, telephone, adresse, latitude, longitude, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ message: 'Utilisateur introuvable.' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// PUT /auth/me : le client modifie son propre compte
router.put('/me', authClient, async (req, res) => {
  try {
    const { prenom, nom, telephone, adresse } = req.body;
    // Si l'adresse change, on re-géocode et on vérifie la zone
    let lat = null, lng = null, adresseFormatee = adresse;
    if (adresse) {
      try {
        const zone = await verifierZone(adresse);
        lat = zone.lat; lng = zone.lng; adresseFormatee = zone.adresse_formatee;
        if (!zone.dans_zone) {
          return res.status(400).json({ message: 'Cette adresse est hors zone (' + zone.distance + ' km). Rayon max : ' + process.env.RAYON_MAX_KM + ' km.' });
        }
      } catch (e) {
        return res.status(400).json({ message: 'Adresse introuvable. Vérifiez l\'adresse saisie.' });
      }
    }
    await db.query(
      `UPDATE users SET
         prenom = COALESCE($1, prenom),
         nom = COALESCE($2, nom),
         telephone = COALESCE($3, telephone),
         adresse = COALESCE($4, adresse),
         latitude = COALESCE($5, latitude),
         longitude = COALESCE($6, longitude)
       WHERE id = $7`,
      [prenom, nom, telephone, adresseFormatee, lat, lng, req.user.id]
    );
    const result = await db.query(
      'SELECT id, prenom, nom, email, telephone, adresse FROM users WHERE id = $1', [req.user.id]
    );
    res.json({ message: 'Compte mis à jour.', user: result.rows[0] });
  } catch (err) {
    console.error('Erreur update me:', err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// PUT /auth/profil (gardé pour compatibilité app mobile)
router.put('/profil', authClient, async (req, res) => {
  try {
    const { prenom, nom, push_token } = req.body;
    await db.query(
      'UPDATE users SET prenom = COALESCE($1, prenom), nom = COALESCE($2, nom), push_token = COALESCE($3, push_token) WHERE id = $4',
      [prenom, nom, push_token, req.user.id]
    );
    res.json({ message: 'Profil mis à jour.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

async function envoyerOTP(telephone) {
  const code = genOTP();
  const expireAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.query('INSERT INTO sms_otp (telephone, code, expire_at) VALUES ($1, $2, $3)', [telephone, code, expireAt]);
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: 'Votre code Laverie d Ozon : ' + code + '. Valable 10 minutes.',
      from: process.env.TWILIO_PHONE_NUMBER, to: telephone,
    });
  } catch (e) { console.warn('Twilio non configuré, code OTP :', code); }
}

module.exports = router;
