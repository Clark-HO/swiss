// server/places-proxy.cjs
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// -------------------- App --------------------
const app = express();
app.use(cors());
app.use(express.json());

// -------------------- Config --------------------
const PORT = process.env.PORT || 8787;
const MAPS_KEY = process.env.MAPS_KEY || '';
const FIELD_MASK = 'places.id,places.displayName,places.location,places.primaryType,places.primaryTypeDisplayName';

const USE_FIRESTORE = String(process.env.USE_FIRESTORE || '0') === '1';
const FEATURES_COLLECTION = process.env.FEATURES_COLLECTION || 'features';

function maskKey(k){ if(!k) return '(empty)'; return k.length<=10 ? k : (k.slice(0,6)+'...'+k.slice(-4)); }
function clampRadius(m){ return Math.max(100, Math.min(50000, Number(m||30000))); }

// -------------------- Health --------------------
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    hasKey: !!MAPS_KEY,
    keyPreview: maskKey(MAPS_KEY),
    backend: USE_FIRESTORE ? 'firestore' : 'local-json',
    base: 'https://places.googleapis.com/v1'
  });
});

// -------------------- Google Places Proxy --------------------
app.get('/placesSearchText', async (req, res) => {
  try{
    if (!MAPS_KEY) return res.status(500).json({ error:'MAPS_KEY missing' });
    const query = String(req.query.query || 'tourist attractions in Switzerland');
    const lat = Number(req.query.lat || 46.8182);
    const lng = Number(req.query.lng || 8.2275);
    const radius = clampRadius(req.query.radius);

    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method:'POST',
      headers: {
        'X-Goog-Api-Key': MAPS_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        textQuery: query,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } }
      })
    });
    const text = await r.text();
    if (!r.ok) console.error('[UPSTREAM ERROR searchText]', r.status, text);
    res.status(r.status).type('application/json').send(text);
  }catch(e){ res.status(500).json({ proxyError: String(e?.message||e) }); }
});

app.get('/placesNearby', async (req, res) => {
  try{
    if (!MAPS_KEY) return res.status(500).json({ error:'MAPS_KEY missing' });
    const lat = Number(req.query.lat || 46.8182);
    const lng = Number(req.query.lng || 8.2275);
    const radius = clampRadius(req.query.radius);
    const allow = new Set(['restaurant','lodging','tourist_attraction']);
    const rawType = String(req.query.type || 'tourist_attraction');
    const type = allow.has(rawType) ? rawType : 'tourist_attraction';

    const r = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
      method:'POST',
      headers: {
        'X-Goog-Api-Key': MAPS_KEY,
        'X-Goog-FieldMask': FIELD_MASK,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        includedTypes: [type],
        maxResultCount: 50,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } }
      })
    });
    const text = await r.text();
    if (!r.ok) console.error('[UPSTREAM ERROR nearby]', r.status, text);
    res.status(r.status).type('application/json').send(text);
  }catch(e){ res.status(500).json({ proxyError: String(e?.message||e) }); }
});

// -------------------- Backend: Local JSON (dev) --------------------
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'features.json');

function ensureStore(){
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');
}
function readAllLocal() {
  ensureStore();
  try {
    const txt = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(txt || '[]');
  } catch { return []; }
}
function writeAllLocal(arr) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}
function newId() { return `${Date.now()}_${Math.floor(Math.random()*1e6)}`; }

// -------------------- Backend: Firestore (prod) --------------------
let admin = null, db = null;
// -------------------- Backend: Firestore (prod) --------------------
let admin = null, db = null;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON || ""; // 新增：可直接貼 JSON 內容到環境變數

// -------------------- Backend: Firestore (prod) --------------------
let admin = null, db = null;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON || ""; // 新增：可直接貼 JSON 內容到環境變數

// -------------------- Backend: Firestore (prod) --------------------
let admin = null, db = null;
const SERVICE_ACCOUNT_JSON = process.env.SERVICE_ACCOUNT_JSON || ""; // 新增：可直接貼 JSON 內容到環境變數

if (USE_FIRESTORE) {
  try {
    admin = require('firebase-admin');

    if (SERVICE_ACCOUNT_JSON) {
      const key = JSON.parse(SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(key) });
    } else {
      // 若你在雲端提供 GOOGLE_APPLICATION_CREDENTIALS 路徑，也可走預設
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }

    db = admin.firestore();
    console.log('🔥 Firestore backend enabled');
  } catch (e) {
    console.error('Failed to init Firestore. Fallback to local JSON.', e);
  }
}
const useFirestore = () => USE_FIRESTORE && db;


// -------------------- CRUD Routes（兩用，同一路由） --------------------
app.get('/api/features', async (req, res) => {
  try{
    if (useFirestore()){
      const snap = await db.collection(FEATURES_COLLECTION).get();
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.json(rows);
    } else {
      return res.json(readAllLocal());
    }
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.post('/api/features', async (req, res) => {
  try{
    const now = Date.now();
    const payload = Array.isArray(req.body) ? req.body : [req.body];
    if (useFirestore()){
      const saved = [];
      for (const f of payload){
        const doc = { ...f, createdAt: f.createdAt || now, updatedAt: now };
        const ref = await db.collection(FEATURES_COLLECTION).add(doc);
        saved.push({ id: ref.id, ...doc });
      }
      return res.status(201).json(saved.length === 1 ? saved[0] : saved);
    } else {
      const arr = readAllLocal();
      const saved = payload.map(f => {
        const id = f.id || newId();
        const doc = { id, ...f, createdAt: f.createdAt || now, updatedAt: now };
        arr.push(doc);
        return doc;
      });
      writeAllLocal(arr);
      return res.status(201).json(saved.length === 1 ? saved[0] : saved);
    }
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.put('/api/features/:id', async (req, res) => {
  try{
    const id = req.params.id;
    if (useFirestore()){
      const ref = db.collection(FEATURES_COLLECTION).doc(id);
      await ref.set({ ...req.body, updatedAt: Date.now() }, { merge: true });
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error:'not found' });
      return res.json({ id, ...snap.data() });
    } else {
      const arr = readAllLocal();
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return res.status(404).json({ error: 'not found' });
      arr[idx] = { ...arr[idx], ...req.body, id, updatedAt: Date.now() };
      writeAllLocal(arr);
      return res.json(arr[idx]);
    }
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

app.delete('/api/features/:id', async (req, res) => {
  try{
    const id = req.params.id;
    if (useFirestore()){
      await db.collection(FEATURES_COLLECTION).doc(id).delete();
      return res.json({ ok:true, id });
    } else {
      const arr = readAllLocal();
      const idx = arr.findIndex(x => x.id === id);
      if (idx < 0) return res.status(404).json({ error: 'not found' });
      const [gone] = arr.splice(idx, 1);
      writeAllLocal(arr);
      return res.json({ ok: true, id: gone.id });
    }
  }catch(e){ res.status(500).json({ error: String(e?.message||e) }); }
});

// -------------------- Start --------------------
app.listen(PORT, () => {
  console.log(`✅ Proxy + Backend listening on http://localhost:${PORT}`);
  console.log(`[DEBUG] MAPS_KEY: ${maskKey(MAPS_KEY)} | Backend: ${USE_FIRESTORE ? 'Firestore' : 'Local JSON'}`);
});
