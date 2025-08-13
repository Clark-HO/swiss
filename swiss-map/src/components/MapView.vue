<template>
  <div class="map-wrap">
    <!-- 上方搜尋列（只顯示結果，不自動加入清單） -->
    <div class="searchbar">
      <input
        v-model="placeQuery"
        type="text"
        placeholder="搜尋景點、餐廳、步道（例如：best coffee in Zermatt）"
        @keyup.enter="searchPlacesText"
      />
      <button class="search-btn" :disabled="loading" @click="searchPlacesText">
        {{ loading ? '搜尋中…' : '搜尋' }}
      </button>
      <button v-if="searchLayerCount>0" class="clear-btn" @click="clearSearchLayer">清除搜尋結果</button>
    </div>

    <!-- 左側精簡工具列 -->
    <div class="toolbar">
      <button class="tool" :class="{active: ui.showBasemap}" title="底圖" @click="togglePanel('showBasemap')">
        <img :src="icons.basemap" alt="底圖" />
      </button>
      <button class="tool" :class="{active: ui.showLayers}" title="圖層" @click="togglePanel('showLayers')">
        <img :src="icons.layers" alt="圖層" />
      </button>
      <button class="tool" :class="{active: ui.showDraw}" title="繪製" @click="togglePanel('showDraw')">
        <img :src="icons.draw" alt="繪製" />
      </button>
      <button class="tool" :class="{active: ui.showIO}" title="匯入 / 匯出" @click="togglePanel('showIO')">
        <img :src="icons.io" alt="匯入匯出" />
      </button>
      <button class="tool" :class="{active: editing}" title="編輯 / 刪除" @click="toggleEdit">
        <img :src="icons.edit" alt="編輯" />
      </button>
    </div>

    <!-- 底圖面板 -->
    <div class="panel tiny" v-if="ui.showBasemap">
      <h4>底圖</h4>
      <label><input type="radio" value="osm" v-model="basemap" @change="switchBasemap"> 一般地圖</label>
      <label><input type="radio" value="sat" v-model="basemap" @change="switchBasemap"> 衛星影像</label>
    </div>

    <!-- 自家圖層（v-model 真正可開可關） -->
    <div class="panel small" v-if="ui.showLayers">
      <h4>圖層</h4>
      <div class="list">
        <label><input type="checkbox" v-model="vis.restaurant" @change="setOverlay('必吃餐廳', vis.restaurant)"> 必吃餐廳</label>
        <label><input type="checkbox" v-model="vis.trail"      @change="setOverlay('推薦步道', vis.trail)"> 推薦步道</label>
        <label><input type="checkbox" v-model="vis.spot"       @change="setOverlay('景點', vis.spot)"> 景點</label>
        <label><input type="checkbox" v-model="vis.lines"      @change="setRouteVisible(vis.lines)"> 路線（線）</label>
        <label><input type="checkbox" v-model="vis.polygons"   @change="setAreaVisible(vis.polygons)"> 區域（面）</label>
      </div>

      <!-- 一鍵處理不同步：強制關閉 / 開啟 -->
      <div class="io" style="margin-top:8px;">
        <button class="io-btn danger" @click="forceCloseAll">強制全部關閉</button>
        <button class="io-btn" @click="forceOpenAll">全部開啟</button>
      </div>

      <div class="divider"></div>
      <div class="muted">提示：搜尋結果與自動店家顯示為暫存圖層，不會影響你的自家圖層。</div>
    </div>

    <!-- 繪製面板 -->
    <div class="panel" v-if="ui.showDraw">
      <h4>繪製工具</h4>
      <div class="row">
        <span>模式</span>
        <div class="modes">
          <label><input type="radio" value="point" v-model="drawMode"> 點</label>
          <label><input type="radio" value="line" v-model="drawMode"> 線</label>
          <label><input type="radio" value="polygon" v-model="drawMode"> 面</label>
        </div>
      </div>

      <template v-if="drawMode==='point'">
        <label class="row"><span>描述</span><input v-model="form.description" type="text" placeholder="例如：策馬特餐廳" /></label>
        <label class="row"><span>分類</span>
          <select v-model="form.category">
            <option v-for="c in categories" :key="c.value" :value="c.value">{{ c.value }}</option>
          </select>
        </label>
        <label class="row"><span>日期</span><input v-model="form.date" type="date" /></label>
        <label class="row"><span>照片</span><input type="file" accept="image/*" @change="onPickPhoto" /></label>
        <div v-if="photoPreview" class="preview"><img :src="photoPreview" alt="預覽" /></div>
        <button class="primary wide" :class="{ active: addMode }" @click="toggleAddMode">
          {{ addMode ? '點地圖以新增（再次點我取消）' : '開始在地圖上新增' }}
        </button>
      </template>

      <template v-else>
        <div class="hint-box">在地圖上連續點選節點建立 {{ drawMode==='line' ? '路線' : '區域' }}。</div>
        <label class="row"><span>描述</span><input v-model="pathForm.description" type="text" placeholder="例如：健行路線 / 計畫範圍" /></label>
        <label class="row"><span>顏色</span><input v-model="pathForm.color" type="color" /></label>
        <label class="row"><span>粗細</span><input v-model.number="pathForm.weight" type="number" min="1" max="10" /></label>
        <div class="path-actions">
          <button class="primary" @click="finishPath" :disabled="tempVertices.length < (drawMode==='line'?2:3)">完成</button>
          <button class="danger" @click="cancelPath" :disabled="tempVertices.length===0">取消</button>
        </div>
        <button class="primary wide" :class="{ active: addMode }" @click="toggleAddMode">
          {{ addMode ? '地圖點選節點中（再次點我取消）' : '開始在地圖上選節點' }}
        </button>
      </template>
    </div>

    <!-- 匯入/匯出 + 雲端同步 + 後端 -->
    <div class="panel small" v-if="ui.showIO">
      <h4>匯出</h4>
      <div class="io">
        <button class="io-btn" @click="exportGeoJSON">GeoJSON</button>
        <button class="io-btn" @click="exportKML">KML</button>
        <button class="io-btn" @click="exportGPX">GPX</button>
        <button class="io-btn" @click="exportSHP">SHP</button>
      </div>

      <h4 style="margin-top:10px;">匯入</h4>
      <div class="io">
        <label class="io-btn">GeoJSON<input type="file" accept=".json,.geojson,application/geo+json,application/json" @change="importGeoJSON" hidden /></label>
        <label class="io-btn">KML<input type="file" accept=".kml,application/vnd.google-earth.kml+xml" @change="importKML" hidden /></label>
        <label class="io-btn">GPX<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" @change="importGPX" hidden /></label>
        <label class="io-btn">SHP(.zip)<input type="file" accept=".zip,application/zip" @change="importSHP" hidden /></label>
      </div>

      <h4 style="margin-top:10px;">雲端同步（Firebase）</h4>
      <div class="io">
        <button class="io-btn" @click="saveAllToCloud">上傳到雲端</button>
        <button class="io-btn" @click="loadAllFromCloud">從雲端載入</button>
      </div>

      <h4 style="margin-top:10px;">後端（同一組 API，現在走 Firestore）</h4>
      <div class="io">
        <button class="io-btn" @click="saveAllToBackend">存到後端</button>
        <button class="io-btn" @click="loadAllFromBackend">從後端載入</button>
      </div>
    </div>

    <div id="map"></div>
  </div>
</template>

<script setup>
/* ---------- Proxy base URL ---------- */
const functionsBase = import.meta.env.VITE_FUNCTIONS_BASE || '';

import { ref, reactive, onMounted, onBeforeUnmount } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet-draw";

import * as togeojson from "@tmcw/togeojson";
import shp from "shpjs";
import shpwrite from "@mapbox/shp-write";
import { saveAs } from "file-saver";

/* Firebase（相對路徑） */
import { db, storage, ensureAuth } from "../firebase";
import { collection, addDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { ref as sRef, uploadString, getDownloadURL } from "firebase/storage";

/* UI 狀態 */
const ui = ref({ showBasemap: false, showLayers: false, showDraw: false, showIO: false });
function togglePanel(key){ for(const k of Object.keys(ui.value)) ui.value[k]=false; ui.value[key]=!ui.value[key]; }
const loading  = ref(false);

/* 地圖狀態 */
const basemap = ref("osm");
const drawMode = ref("point");
const addMode  = ref(false);

/* 自家分類設定 */
const categories = [ { value: "必吃餐廳", color: "red" }, { value: "推薦步道", color: "green" }, { value: "景點", color: "blue" } ];
const colorByCategory = Object.fromEntries(categories.map(c => [c.value, c.color]));

/* 表單狀態 */
const form = ref({ description: "", category: categories[0].value, date: "", photoDataUrl: "", photoUrl: "" });
const photoPreview = ref("");
const pathForm = ref({ description: "", color: "#2563eb", weight: 4 });
const tempVertices = ref([]); let tempLayer = null;

/* Leaflet 實例 */
let map, baseOSM, baseSatellite;
const layersByCategory = { "必吃餐廳": L.layerGroup(), "推薦步道": L.layerGroup(), "景點": L.layerGroup() };
let routeLayer = L.layerGroup(), areaLayer = L.layerGroup();
let searchLayer = L.layerGroup();   // 搜尋結果（暫存）
let placesLayer = L.layerGroup();   // 自動店家/景點（暫存）
const searchLayerCount = ref(0);

let editGroup = null; const objects = [];
const editing = ref(false); let drawControl = null;

/* v-model 圖層可視狀態（關鍵） */
const vis = reactive({
  restaurant: false, // 必吃餐廳
  trail: false,      // 推薦步道
  spot: false,       // 景點
  lines: false,      // 線
  polygons: false,   // 面
});

/* Icons */
const icons = {
  basemap:'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="10" width="24" height="44" rx="4" fill="#60a5fa"/><rect x="34" y="10" width="24" height="44" rx="4" fill="#a3a3a3"/><path d="M36 24h16v4H36zM36 32h16v4H36z" fill="#fff" opacity=".7"/></svg>`),
  layers: 'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><polygon points="32,6 6,18 32,30 58,18" fill="#60a5fa" /><polygon points="32,26 10,36 32,46 54,36" fill="#34d399" /><polygon points="32,44 14,52 32,60 50,52" fill="#f59e0b" /></svg>`),
  draw:   'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="44" width="48" height="8" rx="2" fill="#f59e0b"/><path d="M12,36 L38,10 L54,26 L28,52 L12,52 Z" fill="#60a5fa" /></svg>`),
  io:     'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M20 34 L32 46 L44 34" fill="none" stroke="#10b981" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 30 L32 18 L44 30" fill="none" stroke="#3b82f6" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
  edit:   'data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="10" y="46" width="44" height="8" rx="2" fill="#a78bfa"/><path d="M14 40 L42 12 L52 22 L24 50 L14 50 Z" fill="#8b5cf6"/></svg>`),
};
const poiIcon = (hex) => new L.DivIcon({
  className: 'poi-icon',
  html: `<div style="width:22px;height:22px;border-radius:6px;background:${hex};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.3)">★</div>`,
  iconSize: [22,22], iconAnchor: [11,11],
});
const srchIcon = new L.DivIcon({
  className: 'srch-icon',
  html:`<div style="width:22px;height:22px;border-radius:11px;border:2px solid #2563eb;background:#fff;display:flex;align-items:center;justify-content:center;color:#2563eb;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,.3)">S</div>`,
  iconSize:[22,22], iconAnchor:[11,11],
});

/* 搜尋欄位 */
const placeQuery = ref('');

/* 初始化地圖 */
onMounted(() => {
  map = L.map("map").setView([46.8182, 8.2275], 8);
  baseOSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors" }).addTo(map);
  baseSatellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { attribution: "Tiles © Esri" });

  editGroup = L.featureGroup().addTo(map);

  // 暫存層（預設顯示）
  placesLayer.addTo(map);
  searchLayer.addTo(map);

  // 事件
  map.on("click", onMapClick);
  map.on('moveend', debounce(() => { autoloadNearbyPOIs(); }, 350));

  // 同步 v-model（UI <-> Leaflet）
  map.on('layeradd', syncVisibilityFromMap);
  map.on('layerremove', syncVisibilityFromMap);
  syncVisibilityFromMap();

  // 首次載入附近店家
  autoloadNearbyPOIs();
});

onBeforeUnmount(() => { if (!map) return; map.off("click", onMapClick); map.remove(); });

/* —— 底圖切換 —— */
function switchBasemap(){ if (basemap.value==='osm'){ map.removeLayer(baseSatellite); baseOSM.addTo(map);} else { map.removeLayer(baseOSM); baseSatellite.addTo(map);} }

/* —— 用 v-model 控制各圖層可視 —— */
function setOverlay(cat, on) {
  const layer = layersByCategory[cat];
  if (!layer) return;
  if (on && !map.hasLayer(layer)) layer.addTo(map);
  if (!on && map.hasLayer(layer)) map.removeLayer(layer);
}
function setRouteVisible(on) {
  if (on && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
  if (!on && map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
}
function setAreaVisible(on) {
  if (on && !map.hasLayer(areaLayer)) areaLayer.addTo(map);
  if (!on && map.hasLayer(areaLayer)) map.removeLayer(areaLayer);
}
function syncVisibilityFromMap(){
  vis.restaurant = map.hasLayer(layersByCategory["必吃餐廳"]);
  vis.trail      = map.hasLayer(layersByCategory["推薦步道"]);
  vis.spot       = map.hasLayer(layersByCategory["景點"]);
  vis.lines      = map.hasLayer(routeLayer);
  vis.polygons   = map.hasLayer(areaLayer);
}

/* —— 強制全部關閉 / 全部開啟 —— */
function forceCloseAll(){
  Object.values(layersByCategory).forEach(layer => { if (map.hasLayer(layer)) map.removeLayer(layer); });
  if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer);
  if (map.hasLayer(areaLayer))  map.removeLayer(areaLayer);
  syncVisibilityFromMap();
}
function forceOpenAll(){
  Object.values(layersByCategory).forEach(layer => { if (!map.hasLayer(layer)) layer.addTo(map); });
  if (!map.hasLayer(routeLayer)) routeLayer.addTo(map);
  if (!map.hasLayer(areaLayer))  areaLayer.addTo(map);
  syncVisibilityFromMap();
}

/* —— 點選地圖新增 —— */
function onMapClick(e){
  if (!addMode.value) return;
  if (drawMode.value === 'point'){
    const desc = (form.value.description||'').trim(); if(!desc) return alert('請先輸入描述');
    const cat = form.value.category; if(!colorByCategory[cat]) return alert('請選擇分類');
    addPoint(e.latlng, { description: desc, category: cat, date: form.value.date||'', photoDataUrl: form.value.photoDataUrl||'', photoUrl: form.value.photoUrl||'' });
    const target = layersByCategory[cat];
    if (!map.hasLayer(target)) target.addTo(map); // UI 會被 layeradd 事件同步
  } else {
    tempVertices.value.push(e.latlng); updateTempShape();
    if (drawMode.value==='line'    && !map.hasLayer(routeLayer)) routeLayer.addTo(map);
    if (drawMode.value==='polygon' && !map.hasLayer(areaLayer))  areaLayer.addTo(map);
  }
}

/* —— 新增自家圖徵 —— */
function addPoint(latlng, props){
  const icon = new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-${colorByCategory[props.category]}.png`,
    shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
    iconSize: [25,41], iconAnchor:[12,41], popupAnchor:[1,-34], shadowSize:[41,41],
  });
  const layer = layersByCategory[props.category];
  const id = makeId();
  const marker = L.marker(latlng, { icon }).addTo(layer);
  editGroup.addLayer(marker);
  marker.bindPopup(buildPointPopupHtml(id, props));
  marker.on("popupopen", () => {
    const btn = document.getElementById(`del_${id}`);
    if (btn) btn.onclick = () => { layer.removeLayer(marker); editGroup.removeLayer(marker); removeObject(id); map.closePopup(); };
  });
  objects.push({ kind:'point', id, latlng, props, layerKey: props.category, marker });
}
function addLine(latlngs, props){
  const shape = L.polyline(latlngs, { color: props.color, weight: props.weight }).addTo(routeLayer);
  editGroup.addLayer(shape);
  const id = makeId(); bindPathPopup(shape, id, '路線（線）', props.description||'');
  objects.push({ kind:'line', id, latlngs, props, layer: routeLayer, shape });
}
function addPolygon(latlngs, props){
  const shape = L.polygon(latlngs, { color: props.color, weight: props.weight }).addTo(areaLayer);
  editGroup.addLayer(shape);
  const id = makeId(); bindPathPopup(shape, id, '區域（面）', props.description||'');
  objects.push({ kind:'polygon', id, latlngs, props, layer: areaLayer, shape });
}

/* —— 線/面暫存 —— */
function updateTempShape(){
  const opt = { color: pathForm.value.color, weight: Number(pathForm.value.weight)||4 };
  if (tempLayer) tempLayer.setLatLngs(tempVertices.value);
  else tempLayer = (drawMode.value==='line') ? L.polyline(tempVertices.value, opt).addTo(map) : L.polygon(tempVertices.value, opt).addTo(map);
}
function finishPath(){
  if (drawMode.value==='line' && tempVertices.value.length<2) return;
  if (drawMode.value==='polygon' && tempVertices.value.length<3) return;
  const latlngs = [...tempVertices.value];
  const opt = { color: pathForm.value.color, weight: Number(pathForm.value.weight)||4 };
  const layer = (drawMode.value==='line') ? routeLayer : areaLayer;
  const id = makeId();
  const shape = (drawMode.value==='line') ? L.polyline(latlngs, opt).addTo(layer) : L.polygon(latlngs, opt).addTo(layer);
  editGroup.addLayer(shape);
  bindPathPopup(shape, id, drawMode.value==='line' ? '路線（線）' : '區域（面）', pathForm.value.description||'');
  objects.push({ kind: drawMode.value==='line' ? 'line' : 'polygon', id, latlngs, props: { description: pathForm.value.description||'', ...opt }, layer, shape });
  cancelPath();
}
function cancelPath(){ tempVertices.value = []; if (tempLayer){ map.removeLayer(tempLayer); tempLayer=null; }}

/* —— 編輯 / 刪除 —— */
function toggleEdit(){
  if (!editing.value){
    drawControl = new L.Control.Draw({ draw: false, edit: { featureGroup: editGroup, remove: true }});
    map.addControl(drawControl);
    map.on('draw:edited', onEdited);
    map.on('draw:deleted', onDeleted);
    editing.value = true;
  } else {
    if (drawControl) map.removeControl(drawControl);
    map.off('draw:edited', onEdited);
    map.off('draw:deleted', onDeleted);
    editing.value = false;
  }
}
function onEdited(e){ e.layers.eachLayer(layer => updateObjectGeometryFromLayer(layer)); alert('已更新幾何'); }
function onDeleted(e){ e.layers.eachLayer(layer => { const id = findObjectIdByLayer(layer); if (id) removeObject(id); }); alert('已刪除'); }
function findObjectIdByLayer(layer){ const found = objects.find(o => o.marker===layer || o.shape===layer); return found?.id || null; }
function updateObjectGeometryFromLayer(layer){
  const obj = objects.find(o => o.marker===layer || o.shape===layer); if (!obj) return;
  if (obj.kind==='point'){ const ll = layer.getLatLng(); obj.latlng = { lat: ll.lat, lng: ll.lng }; }
  else if (obj.kind==='line'){ const latlngs = layer.getLatLngs(); obj.latlngs = latlngs.map(p=>({lat:p.lat,lng:p.lng})); }
  else { const latlngs = layer.getLatLngs()[0]; obj.latlngs = latlngs.map(p=>({lat:p.lat,lng:p.lng})); }
}

/* —— 匯出 —— */
function asGeoJSON(){
  return {
    type:"FeatureCollection",
    features: objects.map(o=>{
      if (o.kind==='point') return { type:"Feature", geometry:{ type:"Point", coordinates:[o.latlng.lng,o.latlng.lat] }, properties:{ ...o.props, kind:'point' } }
      if (o.kind==='line')  return { type:"Feature", geometry:{ type:"LineString", coordinates:o.latlngs.map(p=>[p.lng,p.lat]) }, properties:{ ...o.props, kind:'line' } }
      return { type:"Feature", geometry:{ type:"Polygon", coordinates:[o.latlngs.map(p=>[p.lng,p.lat])] }, properties:{ ...o.props, kind:'polygon' } }
    })
  }
}
function exportGeoJSON(){ downloadBlob(JSON.stringify(asGeoJSON(), null, 2), "application/geo+json", `map-${today()}.geojson`); }
function exportKML(){
  const gj = asGeoJSON();
  import("https://cdn.jsdelivr.net/npm/@tmcw/tokml@0.4.0/+esm").then(mod=>{
    const kml = mod.default(gj);
    downloadBlob(kml, "application/vnd.google-earth.kml+xml", `map-${today()}.kml`);
  }).catch(e=>alert("載入 tokml 失敗：" + e.message));
}
function exportGPX(){
  const gj = asGeoJSON();
  import("https://cdn.jsdelivr.net/npm/@tmcw/togpx@0.5.6/+esm").then(mod=>{
    const gpx = mod.default(gj);
    downloadBlob(gpx, "application/gpx+xml", `map-${today()}.gpx`);
  }).catch(e=>alert("載入 togpx 失敗：" + e.message));
}
function exportSHP(){
  const gj = asGeoJSON();
  shpwrite.download(gj, { file:`map-${today()}` });
}

/* —— 匯入 —— */
function importGeoJSON(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ()=>{ try{ loadGeoJSON(JSON.parse(String(r.result))); } catch(e){ alert("解析 GeoJSON 失敗："+e.message);} finally{ ev.target.value=""; } };
  r.readAsText(file);
}
function importKML(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ()=>{
    try{ const xml = new DOMParser().parseFromString(String(r.result),"text/xml"); const gj = togeojson.kml(xml); loadGeoJSON(gj); }
    catch(e){ alert("解析 KML 失敗："+e.message);} finally{ ev.target.value=""; }
  };
  r.readAsText(file);
}
function importGPX(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const r = new FileReader();
  r.onload = ()=>{
    try{ const xml = new DOMParser().parseFromString(String(r.result),"text/xml"); const gj = togeojson.gpx(xml); loadGeoJSON(gj); }
    catch(e){ alert("解析 GPX 失敗："+e.message);} finally{ ev.target.value=""; }
  };
  r.readAsText(file);
}
function importSHP(ev){
  const file = ev.target.files?.[0]; if (!file) return;
  const r = new FileReader();
  r.onload = async ()=>{
    try{ const gj = await shp(r.result); loadGeoJSON(gj); }
    catch(e){ alert("解析 SHP 失敗："+e.message);} finally{ ev.target.value=""; }
  };
  r.readAsArrayBuffer(file);
}
function loadGeoJSON(gj){
  const fc = (gj.type==="FeatureCollection") ? gj : { type:"FeatureCollection", features: gj.features ? gj.features : [gj] };
  let cnt=0;
  for (const f of fc.features || []){
    const g = f.geometry || {}; const p = f.properties || {};
    if (g.type==="Point"){
      const [lng,lat] = g.coordinates||[];
      addPoint({lat,lng},{ description:String(p.description||p.name||""), category: normalizeCategory(p.category)||"景點", date:String(p.date||""), photoDataUrl:String(p.photoDataUrl||""), photoUrl:String(p.photoUrl||"") }); cnt++;
    } else if (g.type==="LineString"){
      const latlngs = (g.coordinates||[]).map(([lng,lat])=>({lat,lng}));
      addLine(latlngs,{ description:String(p.description||p.name||""), color:p.color||"#2563eb", weight:Number(p.weight)||4 }); cnt++;
    } else if (g.type==="Polygon"){
      const ring = (g.coordinates?.[0]||[]).map(([lng,lat])=>({lat,lng}));
      addPolygon(ring,{ description:String(p.description||p.name||""), color:p.color||"#2563eb", weight:Number(p.weight)||4 }); cnt++;
    }
  }
  alert(`已載入 ${cnt} 筆圖徵`);
}

/* —— Firebase（保留） —— */
async function saveAllToCloud(){
  try{
    await ensureAuth();
    const col = collection(db,"features"); let ok=0;
    for (const o of objects){
      let photoUrl = o.props.photoUrl || "";
      if (o.kind==='point' && o.props.photoDataUrl && !photoUrl){
        const path = `photos/${o.id}.jpg`; const r = sRef(storage, path);
        await uploadString(r, o.props.photoDataUrl, 'data_url');
        photoUrl = await getDownloadURL(r); o.props.photoUrl = photoUrl;
      }
      const geometry = (o.kind==='point') ? { type:'Point', coordinates:[o.latlng.lng,o.latlng.lat] }
                     : (o.kind==='line')  ? { type:'LineString', coordinates:o.latlngs.map(p=>[p.lng,p.lat]) }
                                          : { type:'Polygon', coordinates:[o.latlngs.map(p=>[p.lng,p.lat])] };
      await addDoc(col, { type: geometry.type, geometry, properties: { ...o.props, photoDataUrl: undefined }, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      ok++;
    }
    alert(`已上傳 ${ok} 筆到雲端`);
  }catch(e){ console.error(e); alert("上傳失敗："+(e?.message||e)); }
}
async function loadAllFromCloud(){
  try{
    await ensureAuth();
    const snap = await getDocs(collection(db,"features")); let count=0;
    snap.forEach(doc=>{
      const f = doc.data();
      if (f.type==='Point'){ const [lng,lat]=f.geometry.coordinates;
        addPoint({lat,lng},{ description:f.properties?.description||'', category: normalizeCategory(f.properties?.category)||'景點', date:f.properties?.date||'', photoDataUrl:'', photoUrl:f.properties?.photoUrl||'' });
      } else if (f.type==='LineString'){ const latlngs=(f.geometry.coordinates||[]).map(([lng,lat])=>({lat,lng}));
        addLine(latlngs,{ description:f.properties?.description||'', color:f.properties?.color||'#2563eb', weight:Number(f.properties?.weight)||4 });
      } else if (f.type==='Polygon'){ const ring=(f.geometry.coordinates?.[0]||[]).map(([lng,lat])=>({lat,lng}));
        addPolygon(ring,{ description:f.properties?.description||'', color:f.properties?.color||'#2563eb', weight:Number(f.properties?.weight)||4 });
      }
      count++;
    });
    alert(`從雲端載入 ${count} 筆`);
  }catch(e){ console.error(e); alert("載入失敗："+(e?.message||e)); }
}

/* —— 後端（透過 proxy，同一路由，現為 Firestore） —— */
async function saveAllToBackend(){
  try{
    const fc = asGeoJSON();
    const payload = fc.features.map(f => ({
      id: makeId(),
      type: f.geometry.type,
      geometry: f.geometry,
      properties: f.properties || {},
    }));
    const r = await fetch(`${functionsBase}/api/features`, {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    alert('已存到後端（Firestore / 或本機 JSON）');
  }catch(e){ alert('存到後端失敗：'+(e?.message||e)); }
}
async function loadAllFromBackend(){
  try{
    const r = await fetch(`${functionsBase}/api/features`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const arr = await r.json();
    let count = 0;
    for (const f of arr){
      if (f.type==='Point'){ const [lng,lat]=f.geometry.coordinates;
        addPoint({lat,lng},{ description:f.properties?.description||'', category: normalizeCategory(f.properties?.category)||'景點', date:f.properties?.date||'', photoDataUrl:'', photoUrl:f.properties?.photoUrl||'' });
      } else if (f.type==='LineString'){ const latlngs=(f.geometry.coordinates||[]).map(([lng,lat])=>({lat,lng}));
        addLine(latlngs,{ description:f.properties?.description||'', color:f.properties?.color||'#2563eb', weight:Number(f.properties?.weight)||4 });
      } else if (f.type==='Polygon'){ const ring=(f.geometry.coordinates?.[0]||[]).map(([lng,lat])=>({lat,lng}));
        addPolygon(ring,{ description:f.properties?.description||'', color:f.properties?.color||'#2563eb', weight:Number(f.properties?.weight)||4 });
      }
      count++;
    }
    alert(`從後端載入 ${count} 筆`);
  }catch(e){ alert('從後端載入失敗：'+(e?.message||e)); }
}

/* —— Google Places：搜尋（暫存層） —— */
async function searchPlacesText(){
  try{
    if (!functionsBase) return alert('未設定 VITE_FUNCTIONS_BASE');
    loading.value = true;
    const center = map.getCenter();
    const url = `${functionsBase}/placesSearchText?query=${encodeURIComponent(placeQuery.value||'')}&lat=${center.lat}&lng=${center.lng}&radius=${getRadiusMeters()}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    searchLayer.clearLayers(); searchLayerCount.value = 0;
    for (const p of data.places || []){
      if (!p.location) continue;
      const lat = p.location.latitude, lng = p.location.longitude;
      const name = p.displayName?.text || 'POI';
      const typeName = p.primaryTypeDisplayName?.text || '';
      const m = L.marker([lat,lng], { icon: srchIcon })
        .bindPopup(poiPopupHtml(name, typeName, lat, lng, true));
      searchLayer.addLayer(m);
      searchLayerCount.value++;
      m.on('popupopen', ()=>wirePopupButtons(name, lat, lng));
    }
    if (searchLayerCount.value===0) alert('找不到結果，換個關鍵字試試');
  } catch (e) {
    console.error(e); alert('搜尋失敗：' + (e?.message || e));
  } finally {
    loading.value = false;
  }
}
function clearSearchLayer(){ searchLayer.clearLayers(); searchLayerCount.value = 0; }

/* —— 自動載入附近店家/景點（暫存層） —— */
async function autoloadNearbyPOIs(){
  if (!functionsBase) return;
  try{
    const center = map.getCenter();
    const radius = getRadiusMeters();
    const qs = (type) => `${functionsBase}/placesNearby?type=${type}&lat=${center.lat}&lng=${center.lng}&radius=${radius}`;
    const [attractions, restaurants, lodgings] = await Promise.all([
      fetch(qs('tourist_attraction')).then(r=>r.ok?r.json():Promise.resolve({})).catch(()=>({})),
      fetch(qs('restaurant')).then(r=>r.ok?r.json():Promise.resolve({})).catch(()=>({})),
      fetch(qs('lodging')).then(r=>r.ok?r.json():Promise.resolve({})).catch(()=>({})),
    ]);

    placesLayer.clearLayers();
    const add = (arr, color) => {
      for (const p of arr?.places || []){
        if (!p.location) continue;
        const lat = p.location.latitude, lng = p.location.longitude;
        const name = p.displayName?.text || 'POI';
        const typeName = p.primaryTypeDisplayName?.text || '';
        const m = L.marker([lat,lng], { icon: poiIcon(color) })
          .bindPopup(poiPopupHtml(name, typeName, lat, lng, false));
        placesLayer.addLayer(m);
        m.on('popupopen', ()=>wirePopupButtons(name, lat, lng));
      }
    };
    add(attractions, '#10b981'); // 綠：景點
    add(restaurants, '#ef4444'); // 紅：餐廳
    add(lodgings,   '#6366f1'); // 藍紫：飯店
  } catch(e){
    console.error('[autoloadNearbyPOIs]', e);
  }
}

/* —— Popup HTML / Button 行為 —— */
function poiPopupHtml(name, typeName, lat, lng, isSearch){
  const hint = isSearch ? '<div class="muted" style="margin-top:4px">這是搜尋結果，尚未加入你的清單</div>' : '';
  return `<div style="min-width:220px">
    <div style="font-weight:700">${escapeHTML(name)}</div>
    <div style="color:#64748b;font-size:12px">${escapeHTML(typeName||'')}</div>
    ${hint}
    <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
      <button class="popup-btn" id="add_${lat}_${lng}">加入到我的清單</button>
      <button class="popup-btn secondary" id="nav_${lat}_${lng}">在 Google 地圖開啟路線</button>
    </div>
  </div>`;
}
function wirePopupButtons(name, lat, lng){
  const addBtn = document.getElementById(`add_${lat}_${lng}`);
  const navBtn = document.getElementById(`nav_${lat}_${lng}`);
  if (addBtn){
    addBtn.onclick = ()=> {
      addPoint({lat,lng},{ description: name, category:'景點', date:'', photoDataUrl:'', photoUrl:'' });
      const layer = layersByCategory['景點']; if (!map.hasLayer(layer)) layer.addTo(map);
      map.closePopup();
      alert('已加入到你的「景點」圖層');
    };
  }
  if (navBtn){
    navBtn.onclick = ()=> {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      window.open(url, '_blank');
    };
  }
}

/* —— 半徑估算 —— */
function getRadiusMeters(){
  const b = map.getBounds();
  const latDiff = Math.abs(b.getNorth() - b.getSouth());
  const approx = Math.floor((latDiff * 111000) / 2);
  return Math.max(100, Math.min(50000, approx));
}

/* —— 小工具 —— */
function toggleAddMode(){ addMode.value = !addMode.value; }
function onPickPhoto(ev){ const f = ev.target.files?.[0]; if(!f){ form.value.photoDataUrl=""; photoPreview.value=""; return; }
  const r = new FileReader(); r.onload = e=>{ form.value.photoDataUrl = String(e.target.result||""); photoPreview.value = form.value.photoDataUrl; }; r.readAsDataURL(f);
}
function bindPathPopup(shape, id, label, desc){
  const html = `<div style="min-width:220px">
    <div><b>類型：</b>${label}</div>
    <div><b>描述：</b>${escapeHTML(desc)}</div>
    <div style="margin-top:8px;text-align:right;">
      <button id="del_${id}" style="background:#e11d48;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">刪除</button>
    </div></div>`;
  shape.bindPopup(html);
  shape.on("popupopen", ()=>{ const btn = document.getElementById(`del_${id}`); if (btn) btn.onclick = ()=>{ shape.remove(); editGroup.removeLayer(shape); removeObject(id); map.closePopup(); }; });
}
function buildPointPopupHtml(id, props){
  const imgSrc = props.photoDataUrl || props.photoUrl || "";
  const imgHTML = imgSrc ? `<div style="margin-top:6px;"><img src="${imgSrc}" style="max-width:220px;border:1px solid #ddd;border-radius:4px"/></div>` : "";
  const dateHTML = props.date ? `<div><b>日期：</b>${props.date}</div>` : "";
  return `<div style="min-width:220px">
      <div><b>分類：</b>${props.category}</div>
      <div><b>描述：</b>${escapeHTML(props.description)}</div>
      ${dateHTML}${imgHTML}
      <div style="margin-top:8px;text-align:right;">
        <button id="del_${id}" style="background:#e11d48;color:#fff;border:none;padding:6px 10px;border-radius:4px;cursor:pointer;">刪除</button>
      </div></div>`;
}
function normalizeCategory(raw){ if(!raw) return null; const s = String(raw).trim().toLowerCase();
  if (s==="必吃餐廳") return "必吃餐廳"; if (s==="推薦步道") return "推薦步道"; if (s==="景點") return "景點";
  const alias = { "餐廳":"必吃餐廳","必吃":"必吃餐廳","步道":"推薦步道","hike":"推薦步道","trail":"推薦步道","spot":"景點","poi":"景點" };
  return alias[s] || null;
}
function removeObject(id){ const i = objects.findIndex(x=>x.id===id); if (i>=0) objects.splice(i,1); }
function downloadBlob(textOrData, mime, filename){ const blob = (textOrData instanceof Blob)? textOrData : new Blob([textOrData],{type:mime}); saveAs(blob, filename); }
function makeId(){ return `${Date.now()}_${Math.floor(Math.random()*1e6)}`; }
function escapeHTML(str){ return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function today(){ return new Date().toISOString().slice(0,10); }
function debounce(fn, wait){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
.map-wrap { position: relative; height: 100dvh; width: 100%; }
#map { position: absolute; inset: 0; }

/* 上方搜尋列 */
.searchbar{
  position:absolute; z-index:1000; left:50%; top:14px; transform:translateX(-50%);
  display:flex; gap:8px; align-items:center;
  background:rgba(255,255,255,.96); border:1px solid #e5e7eb; border-radius:999px;
  padding:6px 8px; box-shadow:0 6px 20px rgba(0,0,0,.12); backdrop-filter: blur(6px);
}
.searchbar input{
  width: min(52vw, 640px); max-width: 90vw; border:none; outline:none; background:transparent; padding:6px 8px; font-size:14px; color:#0f172a;
}
.search-btn, .clear-btn{
  padding:8px 14px; border-radius:999px; border:none; background:#2563eb; color:#fff; font-weight:600; cursor:pointer;
}
.clear-btn{ background:#111; }
@media (prefers-color-scheme: dark){
  .searchbar{ background:rgba(24,24,28,.92); border-color:#2f2f36; }
  .searchbar input{ color:#e5e7eb; }
}

/* 左側工具列（桌機置左、手機置底） */
.toolbar{ position:absolute; z-index:1000; display:flex; gap:10px; }
.tool{ width:44px; height:44px; border-radius:12px; border:1px solid #e5e7eb; background:rgba(255,255,255,.94);
  display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 8px 20px rgba(0,0,0,.12); backdrop-filter: blur(6px); }
.tool img{ width:22px; height:22px; object-fit:contain; }
.tool.active{ outline:2px solid #2563eb; }
@media (prefers-color-scheme: dark){
  .tool{ background:rgba(24,24,28,.92); border-color:#2f2f36; }
}

/* 桌機（>=900px） */
@media (min-width: 900px){
  .toolbar{ top:50%; left:12px; transform:translateY(-50%); flex-direction:column; }
  .panel{ top:68px; left:68px; right:auto; bottom:auto; width:300px; }
  .panel.small{ width:260px; }
  .panel.tiny{ width:200px; }
}

/* 手機（<900px） */
@media (max-width: 899px){
  .toolbar{ bottom:74px; left:50%; transform:translateX(-50%); flex-direction:row; }
  .panel, .panel.small, .panel.tiny{ left:10px; right:10px; width:auto; top:auto; bottom:122px; max-height:52dvh; }
}

/* 面板樣式 */
.panel{
  position:absolute; z-index:1000; max-height:60dvh; overflow:auto;
  background:rgba(255,255,255,.96); color:#0f172a; border:1px solid #e5e7eb; border-radius:14px; box-shadow:0 10px 28px rgba(0,0,0,.14); padding:10px 12px; backdrop-filter: blur(6px);
}
.panel h4{ margin:4px 0 8px; font-size:14px; }
.list label{ display:block; margin:6px 0; }
.row{ display:grid; grid-template-columns: 72px 1fr; gap:8px; align-items:center; margin-bottom:8px; }
.row input[type="text"], .row input[type="date"], .row select{ padding:8px 10px; border:1px solid #e5e7eb; border-radius:8px; font-size:13px; width:100%; color:#0f172a; background:transparent; }
.hint-box{ background:rgba(148,163,184,.15); border:1px solid #e5e7eb; padding:8px; border-radius:10px; margin-bottom:8px; }
.primary{ padding:10px 12px; border:none; border-radius:10px; background:#2563eb; color:#fff; font-weight:600; cursor:pointer; }
.primary.wide{ width:100%; }
.danger{ padding:10px 12px; border:none; border-radius:10px; background:#e11d48; color:#fff; cursor:pointer; }
.io{ display:flex; gap:10px; flex-wrap:wrap; }
.io-btn{ padding:9px 12px; border-radius:10px; border:1px solid #111; background:#111; color:#fff; cursor:pointer; font-size:13px; font-weight:600; }

.muted{ color:#64748b; font-size:12px; }
.divider{ height:1px; background:#e5e7eb; margin:8px 0; }

/* POI icon hover */
.poi-icon div, .srch-icon div { transition: transform .08s ease; }
.poi-icon div:hover, .srch-icon div:hover { transform: scale(1.08); }
</style>
