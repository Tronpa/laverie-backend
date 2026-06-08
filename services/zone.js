require('dotenv').config();
const LAVERIE_LAT = parseFloat(process.env.LAVERIE_LATITUDE);
const LAVERIE_LNG = parseFloat(process.env.LAVERIE_LONGITUDE);
const RAYON_KM = parseFloat(process.env.RAYON_MAX_KM) || 10;

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function verifierZone(adresse) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(adresse) + '&key=' + process.env.GOOGLE_MAPS_API_KEY + '&region=fr&language=fr';
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results.length) {
    throw new Error('Adresse introuvable. Verifiez l adresse saisie.');
  }
  const loc = data.results[0].geometry.location;
  const distance = distanceKm(LAVERIE_LAT, LAVERIE_LNG, loc.lat, loc.lng);
  return {
    lat: loc.lat,
    lng: loc.lng,
    adresse_formatee: data.results[0].formatted_address,
    distance: Math.round(distance * 10) / 10,
    dans_zone: distance <= RAYON_KM,
  };
}

module.exports = { verifierZone, distanceKm };
