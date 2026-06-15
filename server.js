const express = require("express");
const path = require("path");
const fs = require("fs");
const mqtt = require("mqtt");
const multer = require("multer");
const axios = require("axios");
const { initDB, run: dbRun, get: dbGet, all: dbAll, getNowString } = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "nordic_secret_key";

const upload = multer({ dest: path.join(__dirname, "firmware/") });

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const devices = Object.create(null);
const gateways = Object.create(null);


const DEVICE_NAME_BY_MAC = Object.create(null);
const DEVICE_WHITELIST_BY_MAC = Object.create(null);
const DEVICE_STATE_FILE = path.join(__dirname, "device-state.json");

async function logActivity(username, msg) {
  try { await dbRun("INSERT INTO audit_logs (username, action, timestamp, message) VALUES (?, 'USER', ?, ?)", [username, getNowString(), msg]); } catch (e) { }
}

async function loadDeviceConfigs() {
  const configs = await dbAll("SELECT * FROM devices_config");
  for (const r of configs) {
    if (r.name) DEVICE_NAME_BY_MAC[r.mac_address] = r.name;
    if (r.is_whitelisted === 1) DEVICE_WHITELIST_BY_MAC[r.mac_address] = true;
  }
}

const ALPHA = Number(process.env.RSSI_EMA_ALPHA ?? "0.3"); // 0..1
const SWITCH_MARGIN_DB = Number(process.env.SWITCH_MARGIN_DB ?? "2");
const HOLD_MS = Number(process.env.SWITCH_HOLD_MS ?? "1000");
const STALE_ROOM_TTL_MS = Number(process.env.STALE_ROOM_TTL_MS ?? "20000");
const BROADCAST_GW = "*";

const APPSHEET_SYNC_ENABLED = String(process.env.APPSHEET_SYNC_ENABLED || "true").toLowerCase() === "true";
const APPSHEET_APP_ID = process.env.APPSHEET_APP_ID || "8b4f86b5-8ec7-4cdb-8ee4-442dc933693b";
const APPSHEET_ACCESS_KEY = process.env.APPSHEET_ACCESS_KEY || "V2-0tejF-zDB0g-j6FbK-k3NbO-M8yeK-re8GC-SdUhT-zhLrc";
const APPSHEET_TABLE_NAME = process.env.APPSHEET_TABLE_NAME || "Danh_sach_thiet_bi";
const APPSHEET_LOOKUP_COLUMN = process.env.APPSHEET_LOOKUP_COLUMN || "MAC";
const APPSHEET_KEY_COLUMN = process.env.APPSHEET_KEY_COLUMN || "Row ID";
const APPSHEET_LOCATION_COLUMN = process.env.APPSHEET_LOCATION_COLUMN || "Vị trí";
const APPSHEET_STATUS_COLUMN = process.env.APPSHEET_STATUS_COLUMN || "Trạng thái";
const APPSHEET_NAME_COLUMN = process.env.APPSHEET_NAME_COLUMN || "Tên thiết bị";
const APPSHEET_SYNC_DEBOUNCE_MS = Number(process.env.APPSHEET_SYNC_DEBOUNCE_MS || "300");
const APPSHEET_SYNC_TIMEOUT_MS = Number(process.env.APPSHEET_SYNC_TIMEOUT_MS || "15000");

const appsheetSyncTimers = new Map();
const appsheetSyncedSignature = new Map();

function isAppSheetConfigured() {
  return APPSHEET_SYNC_ENABLED && !!APPSHEET_APP_ID && !!APPSHEET_ACCESS_KEY && !!APPSHEET_TABLE_NAME;
}

function getAppSheetUrl() {
  const encodedTable = encodeURIComponent(APPSHEET_TABLE_NAME);
  return `https://api.appsheet.com/api/v2/apps/${APPSHEET_APP_ID}/tables/${encodedTable}/Action`;
}

function normalizeDeviceStatus(dev) {
  const raw = dev?.meta?.status;
  if (typeof raw === "number") return raw === 1 ? "Online" : "Offline";
  return dev?.currentRoom ? "Online" : "Offline";
}

function normalizeHeaderName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function resolveColumnName(allKeys, preferred, candidates = []) {
  const byNormalized = new Map();
  for (const key of allKeys) {
    byNormalized.set(normalizeHeaderName(key), key);
  }

  const probe = [preferred, ...candidates];
  for (const name of probe) {
    const matched = byNormalized.get(normalizeHeaderName(name));
    if (matched) return matched;
  }

  return preferred;
}

function resolveAppSheetColumns(rows) {
  const keys = new Set(["Row ID"]);
  for (const row of rows) {
    for (const k of Object.keys(row || {})) keys.add(k);
  }

  const allKeys = Array.from(keys);
  return {
    key: resolveColumnName(allKeys, APPSHEET_KEY_COLUMN, ["Row ID", "row id"]),
    lookup: resolveColumnName(allKeys, APPSHEET_LOOKUP_COLUMN, ["MAC", "mac", "device id", "deviceid"]),
    status: resolveColumnName(allKeys, APPSHEET_STATUS_COLUMN, ["Trạng thái", "Trang thai", "status"]),
    location: resolveColumnName(allKeys, APPSHEET_LOCATION_COLUMN, ["Vị trí", "Vi tri", "location", "room"]),
    name: resolveColumnName(allKeys, APPSHEET_NAME_COLUMN, ["Tên thiết bị", "Ten thiet bi", "name"]),
  };
}

function buildAppSheetDeviceRow(deviceId, dev, columns) {
  const col = columns || {
    lookup: APPSHEET_LOOKUP_COLUMN,
    location: APPSHEET_LOCATION_COLUMN,
    status: APPSHEET_STATUS_COLUMN,
    name: APPSHEET_NAME_COLUMN,
  };

  const row = {
    [col.lookup]: deviceId,
    [col.location]: dev?.currentRoom || "",
    [col.status]: normalizeDeviceStatus(dev),
  };
  const devName = dev?.meta?.name;
  if (typeof devName === "string" && devName.trim()) {
    row[col.name] = devName.trim();
  }
  return row;
}

function getAppSheetSyncSignature(dev) {
  return JSON.stringify({
    room: dev?.currentRoom || "",
    status: normalizeDeviceStatus(dev),
  });
}

async function callAppSheetAction(action, rows) {
  const url = getAppSheetUrl();
  return axios.post(
    url,
    {
      Action: action,
      Properties: {
        Locale: "vi-VN",
        Timezone: "Asia/Ho_Chi_Minh",
      },
      Rows: rows,
    },
    {
      headers: {
        ApplicationAccessKey: APPSHEET_ACCESS_KEY,
        "Content-Type": "application/json",
      },
      timeout: APPSHEET_SYNC_TIMEOUT_MS,
    }
  );
}

function extractRowsFromAppSheetPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.Rows)) return payload.Rows;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.Result)) return payload.Result;
  return [];
}

async function syncDeviceToAppSheet(deviceId, dev) {
  if (!isAppSheetConfigured()) return { skipped: true, reason: "not_configured" };

  // Find existing row by key, then edit by Row ID to avoid silent no-op edits.
  const findResponse = await callAppSheetAction("Find", []);
  const allRows = extractRowsFromAppSheetPayload(findResponse?.data);
  const columns = resolveAppSheetColumns(allRows);
  const row = buildAppSheetDeviceRow(deviceId, dev, columns);
  const wantedId = String(deviceId || "").trim().toUpperCase();
  const foundRows = allRows.filter((r) => {
    const lookupValue = String(r?.[columns.lookup] || "").trim().toUpperCase();
    return lookupValue === wantedId;
  });

  if (foundRows.length > 0) {
    const existingRow = foundRows[0] || {};
    const keyValue = existingRow[columns.key];
    if (keyValue == null || keyValue === "") {
      throw new Error(`Không tìm thấy key '${columns.key}' trong row AppSheet`);
    }
    const editRow = { ...row, [columns.key]: keyValue };
    await callAppSheetAction("Edit", [editRow]);
    return { ok: true, mode: "edit", matched: foundRows.length };
  }

  await callAppSheetAction("Add", [row]);
  return { ok: true, mode: "add", matched: 0 };
}

function queueAppSheetDeviceSync(deviceId) {
  if (!isAppSheetConfigured()) return;
  if (!devices[deviceId]) return;

  const dev = devices[deviceId];
  const nextSig = getAppSheetSyncSignature(dev);
  const prevSig = appsheetSyncedSignature.get(deviceId);
  if (prevSig === nextSig) return;

  if (appsheetSyncTimers.has(deviceId)) {
    clearTimeout(appsheetSyncTimers.get(deviceId));
  }

  const timer = setTimeout(async () => {
    appsheetSyncTimers.delete(deviceId);
    const snapshot = devices[deviceId];
    if (!snapshot) return;
    try {
      await syncDeviceToAppSheet(deviceId, snapshot);
      appsheetSyncedSignature.set(deviceId, getAppSheetSyncSignature(snapshot));
    } catch (error) {
      const msg =
        error?.response?.data?.error ||
        error?.response?.data?.message ||
        error?.message ||
        "Unknown AppSheet sync error";
      console.error(`AppSheet sync failed for ${deviceId}:`, msg);
    }
  }, APPSHEET_SYNC_DEBOUNCE_MS);

  appsheetSyncTimers.set(deviceId, timer);
}


const sseClients = new Set();
function broadcast(obj) {
  const data = "data: " + JSON.stringify(obj) + "\n\n";
  for (const res of sseClients) res.write(data);
}

// Heartbeat every 25s to keep SSE connections alive through proxies/firewalls
setInterval(() => {
  const ping = ": ping\n\n";
  for (const res of sseClients) res.write(ping);
}, 25000);

function ensureDevice(deviceId) {
  if (!devices[deviceId]) {
    devices[deviceId] = {
      rooms: Object.create(null),
      currentRoom: null,
      lastSwitch: 0,
      updatedAt: Date.now(),
      meta: {},
    };
  }
  return devices[deviceId];
}

function updateEma(prev, next) {
  if (prev == null) return next;
  return ALPHA * next + (1 - ALPHA) * prev;
}

function pickRoom(dev, now = Date.now()) {
  let bestRoom = null;
  let bestEma = -Infinity;
  for (const [room, s] of Object.entries(dev.rooms)) {
    const lastSeen = s?.lastSeen ?? 0;
    if (now - lastSeen >= STALE_ROOM_TTL_MS) continue;
    if (typeof s.ema === "number" && s.ema > bestEma) {
      bestEma = s.ema;
      bestRoom = room;
    }
  }
  return { bestRoom, bestEma };
}

function maybeSwitchRoom(dev, now) {

  for (const [room, s] of Object.entries(dev.rooms)) {
    const lastSeen = s?.lastSeen ?? 0;
    if (now - lastSeen >= STALE_ROOM_TTL_MS) {
      delete dev.rooms[room];
    }
  }

  const { bestRoom, bestEma } = pickRoom(dev, now);
  if (!bestRoom) return;

  const current = dev.currentRoom;
  if (!current) {
    dev.currentRoom = bestRoom;
    dev.lastSwitch = now;
    return;
  }
  if (current === bestRoom) return;

  const currentEma = dev.rooms[current]?.ema ?? -Infinity;
  const currentLastSeen = dev.rooms[current]?.lastSeen ?? 0;
  const isStale = now - currentLastSeen >= STALE_ROOM_TTL_MS;

  if (isStale) {
    dev.currentRoom = bestRoom;
    dev.lastSwitch = now;
    return;
  }
  const diff = bestEma - currentEma;

  const canSwitchByTime = now - dev.lastSwitch >= HOLD_MS;
  const canSwitchByMargin = diff >= SWITCH_MARGIN_DB;

  if (canSwitchByTime && canSwitchByMargin) {
    dev.currentRoom = bestRoom;
    dev.lastSwitch = now;
  }
}

function parseGatewayTimeToMs(s) {

  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const [_, yy, mo, dd, hh, mi, ss] = m;

  const d = new Date(
    Number(yy),
    Number(mo) - 1,
    Number(dd),
    Number(hh),
    Number(mi),
    Number(ss)
  );
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function normalizeMac(value) {
  if (typeof value !== "string") return "";
  return value.trim().toUpperCase();
}



let saveStateTimer = null;
function loadDeviceState() {
  if (!fs.existsSync(DEVICE_STATE_FILE)) return;
  try {
    const raw = fs.readFileSync(DEVICE_STATE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") {
      for (const [deviceId, dev] of Object.entries(data)) {
        if (!dev || typeof dev !== "object") continue;
        devices[deviceId] = {
          rooms: dev.rooms && typeof dev.rooms === "object" ? dev.rooms : Object.create(null),
          currentRoom: dev.currentRoom ?? null,
          lastSwitch: typeof dev.lastSwitch === "number" ? dev.lastSwitch : 0,
          updatedAt: typeof dev.updatedAt === "number" ? dev.updatedAt : Date.now(),
          meta: dev.meta && typeof dev.meta === "object" ? dev.meta : {},
        };
      }
    }
  } catch (err) {
    console.error("Failed to load device state:", err);
  }
}

function saveDeviceState() {
  try {
    fs.writeFileSync(DEVICE_STATE_FILE, JSON.stringify(devices, null, 2));
  } catch (err) {
    console.error("Failed to save device state:", err);
  }
}

function scheduleDeviceStateSave() {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  saveStateTimer = setTimeout(saveDeviceState, 500);
}

function publishWhitelist() {
  const macs = Object.keys(DEVICE_WHITELIST_BY_MAC);
  const payload = {
    data: {
      macs,
      ts: new Date().toISOString(),
    },
  };
  mqttClient.publish(MQTT_WHITELIST_TOPIC, JSON.stringify(payload), { retain: true });
}

loadDeviceState();

function ingestReading({ deviceId, room, rssi, tsMs, meta }) {
  const now = Date.now();
  const dev = ensureDevice(deviceId);
  dev.updatedAt = now;
  if (meta && typeof meta === "object") dev.meta = { ...dev.meta, ...meta };

  const rs = dev.rooms[room] || { ema: null, lastSeen: 0, lastRssi: null };
  rs.ema = updateEma(rs.ema, rssi);
  rs.lastRssi = rssi;
  rs.lastSeen = now;
  dev.rooms[room] = rs;

  maybeSwitchRoom(dev, now);
  queueAppSheetDeviceSync(deviceId);

  const payload = {
    type: "update",
    deviceId,
    currentRoom: dev.currentRoom,
    rooms: dev.rooms,
    updatedAt: dev.updatedAt,
    meta: dev.meta,
  };
  broadcast(payload);
  scheduleDeviceStateSave();
  return payload;
}


const MQTT_HOST = process.env.MQTT_HOST || "broker.emqx.io";
const MQTT_PORT = Number(process.env.MQTT_PORT || "1883");
const MQTT_USER = process.env.MQTT_USER || "test";
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "123";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "ble/raw";
const MQTT_WHITELIST_TOPIC = "ble/whitelist";

const mqttClient = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  clientId: `web_nordic_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
  clean: true,
  keepalive: 30,
  reconnectPeriod: 1000,
});

mqttClient.on("connect", () => {
  console.log(`MQTT connected: ${MQTT_HOST}:${MQTT_PORT}`);
  mqttClient.subscribe("ble/raw");
  mqttClient.subscribe("ble/add/response");
  mqttClient.subscribe("ble/remove/response");
});

mqttClient.on("error", (err) => {
  console.error("MQTT error:", err);
});

mqttClient.on("message", (topic, buf) => {
  let payload;
  try {
    payload = JSON.parse(buf.toString("utf8"));
  } catch {
    return;
  }

  if (!payload || typeof payload !== "object" || !payload.data) return;
  const data = payload.data;

  if (topic === "ble/add/response" || topic === "ble/remove/response") {
    broadcast({
      type: "mgmt_response",
      action: topic.includes("add") ? "THÊM" : "XOÁ",
      data: data
    });
    return;
  }


  const gwValue = Array.isArray(data.gw) ? data.gw[0] : data.gw;
  if (!gwValue) return;
  if (!Array.isArray(data.tag)) return;

  const room = String(gwValue);
  const tsMs = parseGatewayTimeToMs(data.time);

  // Update Gateway info
  const noiseCount = data.tag ? data.tag.filter(t => t.mac && !DEVICE_WHITELIST_BY_MAC[normalizeMac(t.mac)]).length : 0;
  gateways[room] = {
    id: room,
    lastSeen: Date.now(),
    totalDevices: data.total_device || 0,
    seq: data.seq,
    time: data.time,
    noise: noiseCount
  };
  broadcast({ type: "gateway_update", gateway: gateways[room] });

  for (const tag of data.tag) {
    if (typeof tag.id !== "number" && typeof tag.id !== "string") continue;
    if (typeof tag.rssi !== "number") continue;

    const macKey = typeof tag.mac === "string" && tag.mac.trim() !== "" ? normalizeMac(tag.mac) : "";
    // if (macKey && !DEVICE_WHITELIST_BY_MAC[macKey]) continue;    //cơ chế chọn thiết bị từ whitelist 

    const deviceId = macKey ? macKey : `id-${tag.id}`;
    const name = DEVICE_NAME_BY_MAC[deviceId] || null;

    ingestReading({
      deviceId,
      room,
      rssi: tag.rssi,
      tsMs,
      meta: {
        id: tag.id,
        name: name || undefined,
        power: typeof tag.power === "number" ? tag.power : undefined,
        status: typeof tag.status === "number" ? tag.status : undefined,
        alert: typeof tag.alert === "number" ? tag.alert : undefined,
      },
    });
  }
});

app.post("/rssi", (req, res) => {
  const { deviceId, room, rssi, ts } = req.body || {};
  if (!deviceId || !room || typeof rssi !== "number") {
    return res.status(400).json({ ok: false, error: "deviceId, room, rssi(number) required" });
  }
  const payload = ingestReading({
    deviceId: String(deviceId),
    room: String(room),
    rssi,
    tsMs: typeof ts === "number" ? ts : null,
    meta: {},
  });
  res.json({ ok: true, ...payload });
});

app.post("/api/add", (req, res) => {
  const { gw, id, mac, name } = req.body || {};
  if (!mac) return res.status(400).json({ ok: false, error: "Thiếu trường dữ liệu" });
  const macKey = normalizeMac(mac);
  if (name && typeof name === "string" && name.trim()) {
    DEVICE_NAME_BY_MAC[macKey] = name.trim();
    dbRun("INSERT OR REPLACE INTO devices_config (mac_address, name, is_whitelisted) VALUES (?, ?, 1)", [macKey, name.trim()]).catch(e => { });
  } else {
    dbRun("UPDATE devices_config SET is_whitelisted = 1 WHERE mac_address = ?", [macKey]).catch(e => { });
  }
  DEVICE_WHITELIST_BY_MAC[macKey] = true;
  const gwValue = (typeof gw === "string" && gw.trim()) ? gw.trim() : BROADCAST_GW;
  const seq = Math.floor(Math.random() * 100000);
  const payload = {
    data: { gw: gwValue, id: id || "", mac: macKey, request_time: new Date().toISOString().replace('T', ' ').substring(0, 19), seq }
  };
  mqttClient.publish("ble/add", JSON.stringify(payload));
  publishWhitelist();

  ensureDevice(macKey);
  devices[macKey].updatedAt = Date.now();
  if (name && typeof name === "string" && name.trim()) {
    devices[macKey].meta = { ...devices[macKey].meta, name: name.trim() };
  }
  broadcast({
    type: "update",
    deviceId: macKey,
    currentRoom: devices[macKey].currentRoom,
    rooms: devices[macKey].rooms,
    updatedAt: devices[macKey].updatedAt,
    meta: devices[macKey].meta
  });
  scheduleDeviceStateSave();

  res.json({ ok: true, seq });
});

app.post("/api/remove", (req, res) => {
  const { gw, id, mac } = req.body || {};
  if (!mac) return res.status(400).json({ ok: false, error: "Thiếu trường dữ liệu" });
  const macKey = normalizeMac(mac);
  const gwValue = (typeof gw === "string" && gw.trim()) ? gw.trim() : BROADCAST_GW;
  const seq = Math.floor(Math.random() * 100000);
  const payload = {
    data: { gw: gwValue, id: id || "", mac: macKey, request_time: new Date().toISOString().replace('T', ' ').substring(0, 19), seq, reason: "Web Request" }
  };
  mqttClient.publish("ble/remove", JSON.stringify(payload));

  delete DEVICE_NAME_BY_MAC[macKey];
  delete DEVICE_WHITELIST_BY_MAC[macKey];
  dbRun("DELETE FROM devices_config WHERE mac_address = ?", [macKey]).catch(e => { });
  publishWhitelist();


  if (devices[macKey]) {
    delete devices[macKey];
  }
  broadcast({ type: "delete", deviceId: macKey });
  scheduleDeviceStateSave();
  res.json({ ok: true, seq });
});


setInterval(() => {
  const now = Date.now();
  for (const deviceId in devices) {
    const dev = devices[deviceId];
    if (dev.currentRoom && (now - dev.updatedAt > 10000)) {
      dev.currentRoom = null;
      dev.rooms = {};
      dev.lastSwitch = now;
      dev.meta = { ...dev.meta, status: 0 };

      broadcast({
        type: "update",
        deviceId,
        currentRoom: null,
        rooms: dev.rooms,
        updatedAt: dev.updatedAt,
        meta: dev.meta,
      });
      queueAppSheetDeviceSync(deviceId);
      scheduleDeviceStateSave();
    }
  }
}, 5000);

app.post("/api/publish-whitelist", (req, res) => {
  publishWhitelist();
  res.json({ ok: true });
});

app.post("/api/gw/reboot", (req, res) => {
  const { gw } = req.body || {};
  const payload = {
    action: "reboot",
    target: gw || BROADCAST_GW,
    ts: Date.now()
  };
  mqttClient.publish("ble/gw/command", JSON.stringify(payload));
  res.json({ ok: true });
});

app.post("/api/gw/config", (req, res) => {
  const { gw, interval, window } = req.body || {};
  const payload = {
    action: "config",
    target: gw || BROADCAST_GW,
    data: { interval, window },
    ts: Date.now()
  };
  mqttClient.publish("ble/gw/command", JSON.stringify(payload));
  res.json({ ok: true });
});

app.post("/api/appsheet/sync/:deviceId", async (req, res) => {
  const deviceId = String(req.params.deviceId || "").trim();
  if (!deviceId) return res.status(400).json({ ok: false, error: "Thiếu deviceId" });
  const dev = devices[deviceId];
  if (!dev) return res.status(404).json({ ok: false, error: "Không tìm thấy thiết bị" });
  try {
    const result = await syncDeviceToAppSheet(deviceId, dev);
    appsheetSyncedSignature.set(deviceId, getAppSheetSyncSignature(dev));
    res.json({ ok: true, result });
  } catch (error) {
    const status = error?.response?.status || 502;
    res.status(status).json({
      ok: false,
      error: "Sync AppSheet thất bại",
      detail: error?.response?.data || error?.message,
    });
  }
});

app.post("/api/appsheet/sync-all", async (_req, res) => {
  const ids = Object.keys(devices);
  const output = {
    total: ids.length,
    success: 0,
    failed: 0,
    errors: [],
  };

  for (const deviceId of ids) {
    try {
      await syncDeviceToAppSheet(deviceId, devices[deviceId]);
      appsheetSyncedSignature.set(deviceId, getAppSheetSyncSignature(devices[deviceId]));
      output.success += 1;
    } catch (error) {
      output.failed += 1;
      output.errors.push({
        deviceId,
        detail: error?.response?.data || error?.message,
      });
    }
  }

  res.json({ ok: output.failed === 0, ...output });
});

app.get("/api/appsheet/devices", async (req, res) => {
  if (!isAppSheetConfigured()) {
    return res.status(400).json({
      ok: false,
      error: "Chưa cấu hình AppSheet (APPSHEET_APP_ID / APPSHEET_ACCESS_KEY / APPSHEET_TABLE_NAME)",
    });
  }

  try {
    const response = await axios.post(getAppSheetUrl(), {
      "Action": "Find",
      "Properties": {
        "Locale": "vi-VN",
        "Timezone": "Asia/Ho_Chi_Minh"
      },
      "Rows": []
    }, {
      headers: {
        'ApplicationAccessKey': APPSHEET_ACCESS_KEY,
        'Content-Type': 'application/json'
      },
      timeout: APPSHEET_SYNC_TIMEOUT_MS,
    });

    const rows = extractRowsFromAppSheetPayload(response.data);

    res.json({ ok: true, data: rows, count: rows.length });
  } catch (error) {
    const status = error?.response?.status || 502;
    const upstream = error?.response?.data;
    const detailText = typeof upstream === "string"
      ? upstream
      : (upstream?.error || upstream?.message || error.message);

    console.error("Lỗi khi gọi AppSheet API:", detailText);

    res.status(status).json({
      ok: false,
      error: "Không thể lấy dữ liệu từ AppSheet",
      detail: detailText,
    });
  }
});

/* ── USERS API ── */
app.get("/api/users", async (req, res) => {
  try {
    const list = await dbAll("SELECT username, pin, role, full_name as fullName, email, phone, last_login, status, created_at FROM users");
    for (const u of list) {
      u.activities = await dbAll("SELECT timestamp as ts, message as msg FROM audit_logs WHERE username = ? ORDER BY timestamp DESC LIMIT 5", [u.username]);
    }
    res.json({ ok: true, users: list });
  } catch (err) { res.json({ ok: false, error: err.message }); }
});

app.post("/api/users", async (req, res) => {
  const { username, password, role, fullName, email, phone } = req.body || {};
  if (!username) return res.status(400).json({ ok: false, error: "Thiếu tên đăng nhập" });
  try {
    const hash = await bcrypt.hash(password || "123", 10);
    await dbRun("INSERT INTO users (username, password_hash, pin, role, full_name, email, phone, created_at) VALUES (?, ?, '1234', ?, ?, ?, ?, ?)", [username, hash, role || "viewer", fullName || "", email || "", phone || "", getNowString()]);
    await logActivity(username, "Tài khoản được tạo");
    broadcast({ type: "users_updated" });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.put("/api/users/:username", async (req, res) => {
  const targetUser = req.params.username;
  const { password, role, fullName, email, phone } = req.body || {};
  try {
    const dbUser = await dbGet("SELECT username FROM users WHERE username = ?", [targetUser]);
    if (!dbUser) return res.status(404).json({ ok: false, error: "Không tìm thấy người dùng" });

    let sql = "UPDATE users SET role = ?, full_name = ?, email = ?, phone = ?";
    let params = [role || "viewer", fullName || "", email || "", phone || ""];

    if (password) {
      sql += ", password_hash = ?";
      params.push(await bcrypt.hash(password, 10));
    }
    sql += " WHERE username = ?";
    params.push(targetUser);

    await dbRun(sql, params);
    broadcast({ type: "users_updated" });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: err.message }); }
});

app.delete("/api/users/:username", async (req, res) => {
  if (req.params.username === "admin") return res.status(400).json({ ok: false });

  const { pin, requestUser } = req.body || {};
  if (!requestUser || !pin) return res.status(401).json({ ok: false, error: "Thiếu mã PIN hoặc user" });

  const dbUser = await dbGet("SELECT pin FROM users WHERE username = ?", [requestUser]);
  if (!dbUser || dbUser.pin !== pin) return res.status(401).json({ ok: false, error: "Mã PIN không đúng, thao tác bị từ chối!" });

  await dbRun("DELETE FROM users WHERE username = ?", [req.params.username]);
  broadcast({ type: "users_updated" });
  await logActivity(requestUser, "Xoá tài khoản " + req.params.username);
  res.json({ ok: true });
});

app.post("/api/users/change-password", async (req, res) => {
  const { username, oldPassword, newPassword } = req.body || {};
  const user = await dbGet("SELECT password_hash FROM users WHERE username = ?", [username]);
  if (!user || !(await bcrypt.compare(oldPassword, user.password_hash))) return res.status(400).json({ ok: false });
  await dbRun("UPDATE users SET password_hash = ? WHERE username = ?", [await bcrypt.hash(newPassword, 10), username]);
  res.json({ ok: true });
});

app.post("/api/users/change-pin", async (req, res) => {
  await dbRun("UPDATE users SET pin = ? WHERE username = ?", [req.body.newPin, req.body.username]);
  res.json({ ok: true });
});

app.post("/api/users/:username/activity", async (req, res) => {
  const { msg, setOnline } = req.body || {};
  const username = req.params.username;
  if (!username) return res.status(400).json({ ok: false });

  if (msg === 'Đăng xuất') {
    await dbRun("UPDATE users SET status = 'offline' WHERE username = ?", [username]);
  } else if (setOnline) {
    await dbRun("UPDATE users SET status = 'online' WHERE username = ?", [username]);
  }

  if (msg) {
    await logActivity(username, msg);
  }
  broadcast({ type: "users_updated" });
  res.json({ ok: true });
});

/* ── OTA API ── */
app.post("/api/ota", upload.single("firmware"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "Chưa chọn file" });
  }

  const { pin, requestUser } = req.body || {};
  if (!requestUser || !pin) return res.status(401).json({ ok: false, error: "Thiếu mã PIN hoặc user" });

  const dbUser = await dbGet("SELECT pin FROM users WHERE username = ?", [requestUser]);
  if (!dbUser || dbUser.pin !== pin) return res.status(401).json({ ok: false, error: "Mã PIN không đúng, thao tác bị từ chối!" });

  if (!fs.existsSync(path.join(__dirname, "firmware"))) {
    fs.mkdirSync(path.join(__dirname, "firmware"));
  }

  const payload = {
    action: "ota",
    target: BROADCAST_GW,
    url: `http://${getLocalIp()}:${PORT}/firmware/${req.file.filename}`,
    ts: Date.now()
  };
  mqttClient.publish("ble/gw/command", JSON.stringify(payload));

  await logActivity(requestUser, "Đẩy bản cập nhật Firmware " + req.file.originalname);

  res.json({ ok: true, filename: req.file.filename, originalname: req.file.originalname });
});

app.get("/api/ota/version", (req, res) => {
  res.json({ ok: true, version: "v1.2.5" });
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: "Thiếu thông tin đăng nhập" });
  try {
    const user = await dbGet("SELECT * FROM users WHERE username = ?", [username]);
    if (!user) return res.status(401).json({ ok: false, error: "Sai mật khẩu" });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ ok: false, error: "Sai mật khẩu" });
    const token = jwt.sign({ username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    await dbRun("UPDATE users SET status = 'online', last_login = ? WHERE username = ?", [getNowString(), username]);
    await logActivity(username, "Đăng nhập");
    broadcast({ type: "users_updated" });
    res.json({ ok: true, user: { username: user.username, role: user.role }, token });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/state", (_req, res) => {
  res.json({ ok: true, devices, gateways });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders?.();

  // Send initial hello event with proper SSE newlines
  res.write("data: " + JSON.stringify({ type: "hello", t: Date.now() }) + "\n\n");

  // Send current state snapshot immediately on connect
  res.write("data: " + JSON.stringify({ type: "snapshot", devices, gateways }) + "\n\n");

  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

const os = require("os");
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {

      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

// Health check endpoint - dùng cho UptimeRobot để giữ server không sleep
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    mqtt: mqttClient.connected,
    uptime: Math.floor(process.uptime()),
    ts: new Date().toISOString()
  });
});

const PORT = Number(process.env.PORT || "3000");
initDB().then(() => loadDeviceConfigs()).then(() => {
  app.listen(PORT, "0.0.0.0", () => { console.log("Server started on port " + PORT); });
});
