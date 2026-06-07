-- ============================================================
--  LAVERIE DU PARC — Schéma base de données PostgreSQL
--  Créer la base : createdb laverie_db
--  Exécuter : psql -d laverie_db -f database.sql
-- ============================================================

-- Extension pour les UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE : USERS (clients)
-- ============================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prenom        VARCHAR(100) NOT NULL,
  nom           VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  telephone     VARCHAR(20) UNIQUE NOT NULL,
  mot_de_passe  VARCHAR(255) NOT NULL,
  adresse       TEXT NOT NULL,
  latitude      DECIMAL(10, 8) NOT NULL,
  longitude     DECIMAL(11, 8) NOT NULL,
  email_verifie BOOLEAN DEFAULT FALSE,
  tel_verifie   BOOLEAN DEFAULT FALSE,
  actif         BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : ADMINS
-- ============================================================
CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  prenom        VARCHAR(100) NOT NULL,
  nom           VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  mot_de_passe  VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : FORFAITS
-- ============================================================
CREATE TABLE forfaits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nom         VARCHAR(200) NOT NULL,
  description TEXT,
  prix        DECIMAL(8, 2) NOT NULL,
  actif       BOOLEAN DEFAULT TRUE,
  ordre       INTEGER DEFAULT 0,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : FORFAIT_ARTICLES (articles inclus dans chaque forfait)
-- ============================================================
CREATE TABLE forfait_articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  forfait_id   UUID REFERENCES forfaits(id) ON DELETE CASCADE,
  article      VARCHAR(200) NOT NULL,
  quantite_max INTEGER DEFAULT 1
);

-- ============================================================
-- TABLE : COMMANDES
-- ============================================================
CREATE TABLE commandes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
  forfait_id       UUID REFERENCES forfaits(id) ON DELETE SET NULL,
  statut           VARCHAR(50) DEFAULT 'en_attente'
                   CHECK (statut IN ('en_attente','confirmee','collectee','en_lavage','prete','livree','annulee')),
  adresse_collecte TEXT NOT NULL,
  lat_collecte     DECIMAL(10, 8) NOT NULL,
  lng_collecte     DECIMAL(11, 8) NOT NULL,
  rdv_collecte     TIMESTAMP NOT NULL,
  rdv_livraison    TIMESTAMP,
  montant_total    DECIMAL(8, 2) NOT NULL,
  note_client      TEXT,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : COMMANDE_ARTICLES (détail des articles de la commande)
-- ============================================================
CREATE TABLE commande_articles (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  commande_id  UUID REFERENCES commandes(id) ON DELETE CASCADE,
  article      VARCHAR(200) NOT NULL,
  quantite     INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- TABLE : NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE CASCADE,
  commande_id  UUID REFERENCES commandes(id) ON DELETE SET NULL,
  titre        VARCHAR(255) NOT NULL,
  message      TEXT NOT NULL,
  type         VARCHAR(50) DEFAULT 'info'
               CHECK (type IN ('info','succes','alerte','rappel')),
  lu           BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : AVIS
-- ============================================================
CREATE TABLE avis (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  commande_id  UUID UNIQUE REFERENCES commandes(id) ON DELETE CASCADE,
  note         INTEGER CHECK (note BETWEEN 1 AND 5),
  commentaire  TEXT,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- TABLE : SMS_OTP (vérification téléphone)
-- ============================================================
CREATE TABLE sms_otp (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  telephone   VARCHAR(20) NOT NULL,
  code        VARCHAR(6) NOT NULL,
  expire_at   TIMESTAMP NOT NULL,
  utilise     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEX pour les performances
-- ============================================================
CREATE INDEX idx_commandes_user_id    ON commandes(user_id);
CREATE INDEX idx_commandes_statut     ON commandes(statut);
CREATE INDEX idx_commandes_rdv        ON commandes(rdv_collecte);
CREATE INDEX idx_notifications_user   ON notifications(user_id);
CREATE INDEX idx_notifications_lu     ON notifications(lu);
CREATE INDEX idx_sms_otp_telephone    ON sms_otp(telephone);

-- ============================================================
-- DONNÉES DE DÉPART : Forfaits
-- ============================================================
INSERT INTO forfaits (nom, description, prix, ordre) VALUES
('Couette seule',     'Nettoyage d''une couette toutes tailles', 18.00, 1),
('Literie complète',  'Couette + 2 draps + 2 taies d''oreiller',  28.00, 2),
('Maxi maison',       'Couette, draps, housses de couette, coussins', 42.00, 3),
('Sur mesure',        'Choisissez vos articles au tarif unitaire',  0.00, 4);

INSERT INTO forfait_articles (forfait_id, article, quantite_max)
SELECT id, 'Couette', 1 FROM forfaits WHERE nom = 'Couette seule';

INSERT INTO forfait_articles (forfait_id, article, quantite_max)
SELECT id, unnest(ARRAY['Couette','Drap','Taie d''oreiller']),
           unnest(ARRAY[1, 2, 2])
FROM forfaits WHERE nom = 'Literie complète';

INSERT INTO forfait_articles (forfait_id, article, quantite_max)
SELECT id, unnest(ARRAY['Couette','Drap','Housse de couette','Coussin']),
           unnest(ARRAY[2, 4, 2, 4])
FROM forfaits WHERE nom = 'Maxi maison';

-- ============================================================
-- ADMIN PAR DÉFAUT : changer le mot de passe après installation !
-- mot de passe : Admin1234! (haché ci-dessous avec bcrypt)
-- ============================================================
INSERT INTO admins (prenom, nom, email, mot_de_passe) VALUES
('Admin', 'Laverie', 'admin@laverie.fr',
 '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi');
