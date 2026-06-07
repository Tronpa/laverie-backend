const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../config/database');
const { verifierZone } = require('../services/zone');
const { authClient }   = require('../middleware/auth');

// â”€â”€â”€ GÃ©nÃ©rer un token JWT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function genToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
}

// â”€â”€â”€ GÃ©nÃ©rer un code OTP Ã  6 chiffres â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function genOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// â”€â”€â”€ POST /auth/check-zone : VÃ©rifier si une adresse est dans le rayon â”€â”€â”€â”€â”€
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

// â”€â”€â”€ POST /auth/register : Inscription â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/register', async (req, res) => {
  try {
    const { prenom, nom, email, telephone, mot_de_passe, adresse } = req.body;

    // Champs requis
    if (!prenom || !nom || !email || !telephone || !mot_de_passe || !adresse) {
      return res.status(400).json({ message: 'Tous les champs sont requis.' });
    }

    // Email dÃ©jÃ  utilisÃ©
    const emailExiste = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (emailExiste.rows.length) {
      return res.status(400).json({ message: 'Cet email est dÃ©jÃ  utilisÃ©.' });
    }

    // TÃ©lÃ©phone dÃ©jÃ  utilisÃ©
    const telExiste = await db.query('SELECT id FROM users WHERE telephone = $1', [telephone]);
    if (telExiste.rows.length) {
      return res.status(400).json({ message: 'Ce numÃ©ro est dÃ©jÃ  utilisÃ©.' });
    }

    // VÃ©rifier la zone de livraison
    const zone = await verifierZone(adresse);
    if (!zone.dans_zone) {
      return res.status(400).json({
        message: `DÃ©solÃ©, votre adresse est Ã  ${zone.distance} km. Nous ne livrons que dans un rayon de ${process.env.RAYON_MAX_KM} km.`,
        distance: zone.distance,
        dans_zone: false,
      });
    }

    // Hachage du mot de passe
    const hash = await bcrypt.hash(mot_de_passe, 10);

    // CrÃ©ation de l'utilisateur
    const result = await db.query(
      `INSERT INTO users (prenom, nom, email, telephone, mot_de_passe, adresse, latitude, longitude)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, prenom, nom, email, telephone`,
      [prenom, nom, email, telephone, hash, zone.adresse_formatee, zone.lat, zone.lng]
    );
    const user = result.rows[0];

    // Envoyer OTP par SMS pour vÃ©rifier le tÃ©lÃ©phone
    await envoyerOTP(telephone);

    const token = genToken({ id: user.id, email: user.email, role: 'client' });
    res.status(201).json({ message: 'Inscription rÃ©ussie ! VÃ©rifiez votre SMS.', token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// â”€â”€â”€ POST /auth/login : Connexion email + mot de passe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login', async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;
    if (!email || !mot_de_passe) {
      return res.status(400).json({ message: 'Email et mot de passe requis.' });
    }
    const result = await db.query(
      'SELECT * FROM users WHERE email = $1 AND actif = TRUE', [email]
    );
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

// â”€â”€â”€ POST /auth/login-sms : Demander un OTP par SMS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/login-sms', async (req, res) => {
  try {
    const { telephone } = req.body;
    if (!telephone) return res.status(400).json({ message: 'NumÃ©ro requis.' });
    const user = await db.query('SELECT id FROM users WHERE telephone = $1', [telephone]);
    if (!user.rows.length) return res.status(404).json({ message: 'NumÃ©ro non trouvÃ©.' });
    await envoyerOTP(telephone);
    res.json({ message: 'Code SMS envoyÃ©.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// â”€â”€â”€ POST /auth/verify-sms : VÃ©rifier le code OTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/verify-sms', async (req, res) => {
  try {
    const { telephone, code } = req.body;
    if (!telephone || !code) return res.status(400).json({ message: 'TÃ©lÃ©phone et code requis.' });

    const otp = await db.query(
      `SELECT * FROM sms_otp
       WHERE telephone = $1 AND code = $2 AND utilise = FALSE AND expire_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [telephone, code]
    );
    if (!otp.rows.length) return res.status(400).json({ message: 'Code invalide ou expirÃ©.' });

    await db.query('UPDATE sms_otp SET utilise = TRUE WHERE id = $1', [otp.rows[0].id]);
    await db.query('UPDATE users SET tel_verifie = TRUE WHERE telephone = $1', [telephone]);

    const user = await db.query(
      'SELECT id, prenom, nom, email, telephone FROM users WHERE telephone = $1', [telephone]
    );
    const token = genToken({ id: user.rows[0].id, email: user.rows[0].email, role: 'client' });
    res.json({ message: 'TÃ©lÃ©phone vÃ©rifiÃ©.', token, user: user.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// â”€â”€â”€ POST /auth/reset-password : RÃ©initialisation mot de passe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/reset-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    // On rÃ©pond toujours OK pour ne pas rÃ©vÃ©ler si l'email existe
    res.json({ message: 'Si cet email existe, un lien de rÃ©initialisation a Ã©tÃ© envoyÃ©.' });
    // TODO: Envoyer l'email avec un token de reset (intÃ©grer SendGrid ou Nodemailer)
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// â”€â”€â”€ GET /auth/me : Profil de l'utilisateur connectÃ© â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ PUT /auth/profil : Modifier le profil â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.put('/profil', authClient, async (req, res) => {
  try {
    const { prenom, nom, push_token } = req.body;
    await db.query(
      'UPDATE users SET prenom = COALESCE($1, prenom), nom = COALESCE($2, nom), push_token = COALESCE($3, push_token) WHERE id = $4',
      [prenom, nom, push_token, req.user.id]
    );
    res.json({ message: 'Profil mis Ã  jour.' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur.' });
  }
});

// â”€â”€â”€ Helper : Envoyer OTP via Twilio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function envoyerOTP(telephone) {
  const code = genOTP();
  const expireAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await db.query(
    'INSERT INTO sms_otp (telephone, code, expire_at) VALUES ($1, $2, $3)',
    [telephone, code, expireAt]
  );

  // Twilio
  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: `Votre code Laverie du Parc : ${code}. Valable 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: telephone,
    });
  } catch (e) {
    console.warn('Twilio non configurÃ©, code OTP :', code);
  }
}

module.exports = router;



