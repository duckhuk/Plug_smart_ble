const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");

const dbPath = path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

// Đóng gói sqlite db operations với Promise
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function initDB() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    pin TEXT,
    role TEXT DEFAULT 'viewer',
    last_login TEXT,
    status TEXT DEFAULT 'offline',
    created_at TEXT
  )`);

  try { await run(`ALTER TABLE users ADD COLUMN full_name TEXT`); } catch(e) {}
  try { await run(`ALTER TABLE users ADD COLUMN email TEXT`); } catch(e) {}
  try { await run(`ALTER TABLE users ADD COLUMN phone TEXT`); } catch(e) {}

  await run(`CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    action TEXT,
    timestamp TEXT,
    message TEXT,
    FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
  )`);

  await run(`CREATE TABLE IF NOT EXISTS devices_config (
    mac_address TEXT PRIMARY KEY,
    name TEXT,
    is_whitelisted INTEGER DEFAULT 0
  )`);

  await migrateData();
}

async function migrateData() {
  // Kiểm tra nếu rỗng thì migrate user
  const userCount = await get(`SELECT COUNT(*) as count FROM users`);
  if (userCount.count === 0) {
    console.log("Migrating users.json to SQLite...");
    const USERS_FILE = path.join(__dirname, "users.json");
    if (fs.existsSync(USERS_FILE)) {
      try {
        const raw = fs.readFileSync(USERS_FILE, "utf8");
        const data = JSON.parse(raw);
        for (const [k, v] of Object.entries(data)) {
          const hash = await bcrypt.hash(v.password, 10);
          await run(
            `INSERT INTO users (username, password_hash, pin, role, last_login, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [k, hash, v.pin, v.role, v.lastLogin || Date.now(), Date.now(), v.status || "offline"]
          );
          if (v.activities && Array.isArray(v.activities)) {
            for (const act of v.activities) {
              await run(
                `INSERT INTO audit_logs (username, action, timestamp, message) VALUES (?, ?, ?, ?)`,
                [k, "SYSTEM", getNowString(), act.msg]
              );
            }
          }
        }
      } catch (err) {
        console.error("Migration error (users):", err);
      }
    } else {
      // Tao admin default
      const hash = await bcrypt.hash("123", 10);
      await run(
        `INSERT INTO users (username, password_hash, pin, role, created_at) VALUES (?, ?, ?, ?, ?)`,
        ["admin", hash, "1234", "admin", getNowString()]
      );
    }
  }

  // Khởi tạo Device config nếu rỗng
  const devCount = await get(`SELECT COUNT(*) as count FROM devices_config`);
  if (devCount.count === 0) {
    console.log("Migrating device info to SQLite...");
    const names = {};
    const DEVICE_NAMES_FILE = path.join(__dirname, "device-names.json");
    if (fs.existsSync(DEVICE_NAMES_FILE)) {
      Object.assign(names, JSON.parse(fs.readFileSync(DEVICE_NAMES_FILE, "utf8")));
    }

    const DEVICE_WHITELIST_FILE = path.join(__dirname, "device-whitelist.json");
    if (fs.existsSync(DEVICE_WHITELIST_FILE)) {
      const data = JSON.parse(fs.readFileSync(DEVICE_WHITELIST_FILE, "utf8"));
      const wlist = Array.isArray(data) ? data : Object.keys(data);
      for (const mac of wlist) {
        const m = mac.trim().toUpperCase();
        await run(`INSERT OR REPLACE INTO devices_config (mac_address, name, is_whitelisted) VALUES (?, ?, 1)`, [m, names[m] || null]);
        delete names[m];
      }
    }
    
    // Cac device co name nhung k co o whitelist
    for (const [mac, name] of Object.entries(names)) {
        const m = mac.trim().toUpperCase();
        await run(`INSERT OR IGNORE INTO devices_config (mac_address, name, is_whitelisted) VALUES (?, ?, 0)`, [m, name]);
    }
  }
}

function getNowString() {
  const d = new Date();
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

module.exports = {
  db,
  run,
  get,
  all,
  initDB,
  getNowString
};
