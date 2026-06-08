require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.use('/auth',          require('./routes/auth'));
app.use('/forfaits',      require('./routes/forfaits'));
app.use('/commandes',     require('./routes/commandes'));
app.use('/notifications', require('./routes/notifications'));
app.use('/admin',         require('./routes/admin'));
app.use('/parametres',    require('./routes/parametres'));

app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Laverie du Parc API', timestamp: new Date() });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route introuvable.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Erreur interne du serveur.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('Serveur Laverie demarre sur http://localhost:' + PORT);
});
