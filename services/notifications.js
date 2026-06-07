const db = require('../config/database');
let messaging;

try {
  const admin = require('firebase-admin');
  const serviceAccount = require(process.env.FIREBASE_CREDENTIALS_PATH);
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  messaging = admin.messaging();
} catch (e) {
  console.warn('⚠️  Firebase non configuré — notifications push désactivées.');
}

const MESSAGES_STATUT = {
  confirmee:  { titre: '✅ Commande confirmée',      message: 'Votre collecte est confirmée. On arrive bientôt !' },
  collectee:  { titre: '🧺 Linge collecté',          message: 'Votre linge a été récupéré. Le lavage commence !' },
  en_lavage:  { titre: '🫧 En cours de lavage',      message: 'Votre linge est en lavage. Encore un peu de patience.' },
  prete:      { titre: '✨ Prête à livrer',           message: 'Votre commande est prête ! Livraison très prochaine.' },
  livree:     { titre: '🏠 Livraison effectuée',     message: 'Votre linge propre est livré. Comment était notre service ?' },
  annulee:    { titre: '❌ Commande annulée',         message: 'Votre commande a été annulée.' },
};

async function envoyerNotification(userId, titre, message, commandeId = null, type = 'info') {
  // Sauvegarder en base
  await db.query(
    `INSERT INTO notifications (user_id, commande_id, titre, message, type)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, commandeId, titre, message, type]
  );

  // Envoyer push Firebase (si configuré et token disponible)
  if (!messaging) return;
  const result = await db.query(
    'SELECT push_token FROM users WHERE id = $1 AND push_token IS NOT NULL',
    [userId]
  );
  if (!result.rows.length) return;
  try {
    await messaging.send({
      token: result.rows[0].push_token,
      notification: { title: titre, body: message },
    });
  } catch (e) {
    console.warn('Push Firebase échoué :', e.message);
  }
}

async function notifierChangementStatut(commande) {
  const msg = MESSAGES_STATUT[commande.statut];
  if (!msg) return;
  await envoyerNotification(commande.user_id, msg.titre, msg.message, commande.id, 'info');
}

module.exports = { envoyerNotification, notifierChangementStatut };
