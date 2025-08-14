/* server/places-proxy.cjs
 * Express 後端：Google Places 代理 + 自家圖資 CRUD（Firestore 可選；預設用本機 JSON）
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fsp = require('node:fs/promises');
const fss = require('node:fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PORT = process.env.PORT || 8787;
const MAPS_KEY = process.env.MAPS_KEY || '';
const USE_FIRESTORE = process.env.USE_FIRESTORE === '1';
const FEATURES_COLLECTION = process.env.FEATURES_COLLECTION || 'features';
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON || '';

// ===== Firestore（單一初始化區塊）=====
let admin, db;
if (USE_FIRESTORE) {
  try {
    admin = require('firebase-admin');
    if (SERVICE_ACCOUNT_JSON) {
      const key = JSON.parse(SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(key) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    } else {
      throw new Error('No service account provided (SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS)');
    }
    db = admin.firestore();
    console.log('🔥 Firestore backend enabled');
  } catch (e) {
    console.error('⚠️ Firestore init failed, fallback to local JSON:', e.message);
    db = null;
  }
}
const useFirestore = () => USE_FIRESTORE && !!db;

// ===== 本機 JSON 儲存（fallback）=====
const dataDir = path.join(__dirname, 'data');
const dataFile = path.join(dataDir, 'features.json');
async function ensureDataFile() {
  if (!fss.existsSync(dataDir)) fss.mkdirSync(dataDir, { recursive: true });
  if (!fss.existsSync(dataFile)) await fsp.writeFile(dataFile, '[]', 'utf8');
}
async function readLocal() { await ensureDataFile(); try { return JSON.parse(await fsp.readFile(dataFile, 'utf8')); } catch { return []; } }
async function writeLocal(arr) { await ensureDataFile(); await fsp.writeFile(dataFile, JSON.stringify(arr, null, 2), 'utf8'); }
const genId = () => 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

// ===== 自家圖資 CRUD =====
async function listFeatures() {
  if (useFirestore()) {
    const snap = await db.collection(FEATURES_COLLECTION).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } else {
    return await readLocal();
  }
}
async function upsertMany(items) {
  if (useFirestore()) {
    const batch = db.batch();
    const ids = [];
    for (const it of items) {
      const id = it.id || genId();
      const ref = db.collection(FEATURES_COLLECTION).doc(id);
      batch.set(ref, { id, type: it.type, geometry: it.geometry, properties: it.properties || {} }, { merge: true });
      ids.push(id);
    }
    await batch.commit();
    return ids;
  } else {
    const arr = await readLocal();
    const ids = [];
    for (const it of items) {
      const id = it.id || genId();
      const obj = { id, type: it.type, geometry: it.geometry, properties: it.properties || {} };
      const i = arr.findIndex(x => x.id === id);
      if (i >= 0) arr[i] = obj; else arr.push(obj);
      await writeLocal(arr);
      ids.push(id);
    }
    return ids;
  }
}
async function updateOne(id, it) {
  if (useFirestore()) {
    await db.collection(FEATURES_COLLECTION).doc(id)
      .set({ id, type: it.type, geometry: it.geometry, properties: it.properties || {} }, { merge: true });
  } else {
    const arr = await readLocal();
    const i = arr.findIndex(x => x.id === id);
    const obj = { id, type: it.type, geometry: it.geometry, properties: it.properties || {} };
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    await writeLocal(arr);
  }
  return { id };
}
async function deleteOne(id) {
  if (useFirestore()) {
    await db.collection(FEATURES_COLLECTION).doc(id).delete();
  } else {
    const arr = await readLocal();
    const i = arr.findIndex(x => x.id === id);
    if (i >= 0) { arr.splice(i, 1); await writeLocal(arr); }
  }
  return { id, deleted: true };
}

// ===== 健康檢查 =====
app.get('/health', (req, res) => {
  res.json({ ok: true, backend: useFirestore() ? 'firestore' : 'local-json', hasKey: !!MAPS_KEY, base: 'https://places.googleapis.com/v1' });
});

// ===== 自家圖資 API =====
app.get('/api/features', async (req, res) => {
  try { res.json(await listFeatures()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/features', async (req, res) => {
  try {
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    const ids = await upsertMany(payload);
    res.json(Array.isArray(req.body) ? { saved: ids, count: ids.length } : { id: ids[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/features/:id', async (req, res) => {
  try { res.json(await updateOne(req.params.id, req.body || {})); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/features/:id', async (req, res) => {
  try { res.json(await deleteOne(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Google Places 代理（v1）=====
async function gplaces(endpoint, body) {
  if (!MAPS_KEY) return { status: 500, data: { error: 'Server missing MAPS_KEY' } };
  const r = await fetch(`https://places.googleapis.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': MAPS_KEY,
      'X-Goog-FieldMask': 'places.id,places.location,places.displayName'
    },
    body: JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}
const clampRadius = (m) => Math.max(1, Math.min(50000, Number(m) || 0));

app.get('/placesNearby', async (req, res) => {
  const { lat, lng, radius = 2000, type } = req.query;
  const body = {
    maxResultCount: 20,
    locationRestriction: { circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: clampRadius(radius) } }
  };
  if (type) body.includedTypes = [String(type)];
  const { status, data } = await gplaces('places:searchNearby', body);
  res.status(status).json(data);
});

app.get('/placesSearchText', async (req, res) => {
  const { query = '', lat, lng, radius = 30000 } = req.query;
  const body = {
    textQuery: String(query),
    maxResultCount: 20,
    locationBias: { circle: { center: { latitude: Number(lat), longitude: Number(lng) }, radius: clampRadius(radius) } }
  };
  const { status, data } = await gplaces('places:searchText', body);
  res.status(status).json(data);
});

// ===== 啟動 =====
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy + Backend listening on http://localhost:${PORT}`);
  console.log(`[DEBUG] MAPS_KEY: ${MAPS_KEY ? '****' : '(missing)'} | Backend: ${useFirestore() ? 'Firestore' : 'Local JSON'}`);
});
