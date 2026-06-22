// 廣修打卡 + 員工名錄 + 權限 + 排班 Worker API（線上正式版，可同步上 git）
// 部署方式：複製本檔內容 → Cloudflare 後台 guangxiu-punch → </> Edit code → 貼上 → Deploy
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
}
async function sha256(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function padNo(v) {
  const n = parseInt(String(v).trim(), 10);
  if (!n || n < 1 || n > 999) return null;
  return String(n).padStart(3, "0");
}
async function ensureUsers(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS users (empno TEXT PRIMARY KEY, pass_hash TEXT NOT NULL, name TEXT, role TEXT, perm TEXT, updated_at TEXT)"
  ).run();
  for (const col of ["role TEXT", "perm TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE users ADD COLUMN " + col).run(); } catch (e) {}
  }
}
async function makeToken(env, empno, passHash) {
  return await sha256(empno + "|" + passHash + "|" + env.ADMIN_KEY);
}
async function userByToken(env, empno, token) {
  if (!empno || !token) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE empno=?").bind(empno).first();
  if (!u) return null;
  const expect = await makeToken(env, empno, u.pass_hash);
  return token === expect ? u : null;
}
async function ensureShifts(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS shifts (empno TEXT NOT NULL, date TEXT NOT NULL, shift TEXT, updated_at TEXT, PRIMARY KEY (empno, date))"
  ).run();
}
// 統一驗證：000=系統管理員，其餘走員工 token
async function authUser(env, rawEmpno, token) {
  const raw = String(rawEmpno == null ? "" : rawEmpno).trim();
  if (!token) return null;
  if (raw === "000" || raw === "0") {
    const tk = await sha256("000|" + env.ADMIN_KEY + "|" + env.ADMIN_KEY);
    return token === tk ? { empno: "000", perm: "admin" } : null;
  }
  const empno = padNo(raw);
  const u = await userByToken(env, empno, token);
  return u ? { empno: u.empno, perm: u.perm || "staff" } : null;
}
async function ensureConfig(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS config (k TEXT PRIMARY KEY, v TEXT)").run();
}
async function getShiftConfig(env) {
  await ensureConfig(env);
  const def = { M: "08:00", E: "13:00", D: "08:00", grace: 15 };
  const row = await env.DB.prepare("SELECT v FROM config WHERE k='shift_times'").first();
  if (!row || !row.v) return def;
  try { return Object.assign({}, def, JSON.parse(row.v)); } catch (e) { return def; }
}
async function ensurePunches(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS punches (id INTEGER PRIMARY KEY AUTOINCREMENT, emp TEXT NOT NULL, type TEXT NOT NULL, lat REAL, lng REAL, acc INTEGER, punched_at TEXT NOT NULL)"
  ).run();
  for (const col of ["shift TEXT", "status TEXT"]) {
    try { await env.DB.prepare("ALTER TABLE punches ADD COLUMN " + col).run(); } catch (e) {}
  }
}
function p2(n) { return String(n).padStart(2, "0"); }
function twWall() { return new Date(Date.now() + 8 * 3600 * 1000); } // 台灣時間 UTC+8
function twDateStr(d) { return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); }

// 18 人名錄：[編號, 姓名, 職稱, 權限]
const ROSTER = [
  ["001", "陳建修", "董事長", "admin"],
  ["002", "陳敬廉", "總經理", "admin"],
  ["003", "陳冠男", "副總經理", "admin"],
  ["004", "陳軍廷", "工務經理", "manager"],
  ["005", "康竣凱", "工務經理", "manager"],
  ["006", "蕭尉勳", "特助", "admin"],
  ["007", "楊茜媛", "會計", "manager"],
  ["008", "林榮", "工地領班", "staff"],
  ["009", "羅忠陽", "工地領班", "staff"],
  ["010", "陳凱強", "技工", "staff"],
  ["011", "羅忠順", "技工", "staff"],
  ["012", "蘇慶昌", "技工", "staff"],
  ["013", "呂忠義", "技工", "staff"],
  ["014", "胡定", "移工", "staff"],
  ["015", "德偉", "移工", "staff"],
  ["016", "阿南", "移工", "staff"],
  ["017", "EKO", "移工", "staff"],
  ["018", "阿NO", "移工", "staff"],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const isAdmin = () => url.searchParams.get("key") === env.ADMIN_KEY;
    try {
      // 登入（編號+密碼；000=系統管理員，密碼=ADMIN_KEY）
      if (url.pathname === "/api/login" && request.method === "POST") {
        await ensureUsers(env);
        const b = await request.json();
        const raw = String(b.empno == null ? "" : b.empno).trim();
        if (raw === "000" || raw === "0") {
          if (!b.password || b.password !== env.ADMIN_KEY) return json({ error: "密碼錯誤" }, 401);
          const tk = await sha256("000|" + env.ADMIN_KEY + "|" + env.ADMIN_KEY);
          return json({ ok: true, empno: "000", name: "系統管理員", role: "系統管理員", perm: "admin", must_change: 0, token: tk });
        }
        const empno = padNo(b.empno);
        if (!empno || !b.password) return json({ error: "請輸入編號與密碼" }, 400);
        const u = await env.DB.prepare("SELECT * FROM users WHERE empno=?").bind(empno).first();
        if (!u) return json({ error: "查無此員工編號" }, 401);
        const h = await sha256(empno + ":" + b.password);
        if (h !== u.pass_hash) return json({ error: "密碼錯誤" }, 401);
        const defHash = await sha256(empno + ":1234");
        const must_change = u.pass_hash === defHash ? 1 : 0;
        return json({ ok: true, empno, name: u.name || "員工" + empno, role: u.role || "", perm: u.perm || "staff", must_change, token: await makeToken(env, empno, u.pass_hash) });
      }
      // 改密碼
      if (url.pathname === "/api/change-password" && request.method === "POST") {
        await ensureUsers(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        const u = await userByToken(env, empno, b.token);
        if (!u) return json({ error: "登入已失效，請重新登入" }, 401);
        if (!b.newPassword || String(b.newPassword).length < 4) return json({ error: "新密碼至少 4 碼" }, 400);
        const newHash = await sha256(empno + ":" + b.newPassword);
        await env.DB.prepare("UPDATE users SET pass_hash=?, updated_at=? WHERE empno=?").bind(newHash, new Date().toISOString(), empno).run();
        return json({ ok: true, token: await makeToken(env, empno, newHash) });
      }
      // 打卡（含排班 + 遲到判斷）
      if (url.pathname === "/api/punch" && request.method === "POST") {
        await ensurePunches(env);
        await ensureShifts(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        const u = await userByToken(env, empno, b.token);
        if (!u) return json({ error: "請先登入" }, 401);
        if (!b.type) return json({ error: "缺少打卡類別" }, 400);
        const at = new Date().toISOString();
        const tw = twWall();
        const today = twDateStr(tw);
        const sr = await env.DB.prepare("SELECT shift FROM shifts WHERE empno=? AND date=?").bind(empno, today).first();
        const shift = sr ? (sr.shift || "") : "";
        let status = "";
        if (b.type === "in") {
          if (!shift) status = "noshift";
          else if (shift === "O" || shift === "L") status = "off";
          else {
            const cfg = await getShiftConfig(env);
            const startStr = cfg[shift] || "08:00";
            const parts = String(startStr).split(":");
            const startMin = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0) + (parseInt(cfg.grace, 10) || 0);
            const nowMin = tw.getUTCHours() * 60 + tw.getUTCMinutes();
            status = nowMin > startMin ? "late" : "ontime";
          }
        }
        const res = await env.DB.prepare(
          "INSERT INTO punches (emp,type,lat,lng,acc,punched_at,shift,status) VALUES (?,?,?,?,?,?,?,?)"
        ).bind(u.name ? empno + " " + u.name : empno, b.type, b.lat ?? null, b.lng ?? null, b.acc ?? null, at, shift, status).run();
        return json({ ok: true, id: res.meta.last_row_id, punched_at: at, shift, status });
      }
      // 後台讀打卡
      if (url.pathname === "/api/punches" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        let q = "SELECT * FROM punches WHERE 1=1"; const ps = [];
        const emp = url.searchParams.get("emp"); if (emp) { q += " AND emp = ?"; ps.push(emp); }
        const date = url.searchParams.get("date"); if (date) { q += " AND substr(punched_at,1,10) = ?"; ps.push(date); }
        q += " ORDER BY punched_at DESC LIMIT 2000";
        const { results } = await env.DB.prepare(q).bind(...ps).all();
        return json({ ok: true, rows: results });
      }
      // 後台讀名錄
      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const { results } = await env.DB.prepare("SELECT empno,name,role,perm,updated_at FROM users ORDER BY empno").all();
        return json({ ok: true, rows: results });
      }
      // 建立/重設名錄
      if (url.pathname === "/api/admin/seed-roster" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const now = new Date().toISOString();
        await env.DB.prepare("DELETE FROM users").run();
        const stmts = [];
        for (const [no, name, role, perm] of ROSTER) {
          const h = await sha256(no + ":1234");
          stmts.push(env.DB.prepare("INSERT INTO users (empno,pass_hash,name,role,perm,updated_at) VALUES (?,?,?,?,?,?)").bind(no, h, name, role, perm, now));
        }
        await env.DB.batch(stmts);
        return json({ ok: true, total: ROSTER.length, message: "已建立員工名錄 " + ROSTER.length + " 人（密碼全部重設為 1234）" });
      }
      // 改權限
      if (url.pathname === "/api/admin/set-perm" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        if (!empno || !["admin", "manager", "staff"].includes(b.perm)) return json({ error: "參數錯誤" }, 400);
        await env.DB.prepare("UPDATE users SET perm=?, updated_at=? WHERE empno=?").bind(b.perm, new Date().toISOString(), empno).run();
        return json({ ok: true });
      }
      // 重設密碼
      if (url.pathname === "/api/admin/reset-pw" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        if (!empno) return json({ error: "編號錯誤" }, 400);
        const h = await sha256(empno + ":1234");
        await env.DB.prepare("UPDATE users SET pass_hash=?, updated_at=? WHERE empno=?").bind(h, new Date().toISOString(), empno).run();
        return json({ ok: true, message: "編號 " + empno + " 密碼已重設為 1234" });
      }
      // 排班：查詢（主管/管理層看全部，員工看自己）
      if (url.pathname === "/api/shifts/list" && request.method === "POST") {
        await ensureUsers(env);
        await ensureShifts(env);
        const b = await request.json();
        const caller = await authUser(env, b.empno, b.token);
        if (!caller) return json({ error: "登入已失效，請重新登入" }, 401);
        if (!b.from || !b.to) return json({ error: "缺少日期範圍" }, 400);
        const isMgr = caller.perm === "admin" || caller.perm === "manager";
        let q, ps;
        if (isMgr) { q = "SELECT empno,date,shift FROM shifts WHERE date>=? AND date<=?"; ps = [b.from, b.to]; }
        else { q = "SELECT empno,date,shift FROM shifts WHERE date>=? AND date<=? AND empno=?"; ps = [b.from, b.to, caller.empno]; }
        const { results } = await env.DB.prepare(q).bind(...ps).all();
        return json({ ok: true, manager: isMgr, rows: results });
      }
      // 排班：設定（限主管/管理層）
      if (url.pathname === "/api/shifts/set" && request.method === "POST") {
        await ensureUsers(env);
        await ensureShifts(env);
        const b = await request.json();
        const caller = await authUser(env, b.empno, b.token);
        if (!caller || (caller.perm !== "admin" && caller.perm !== "manager")) return json({ error: "沒有排班權限" }, 403);
        const target = padNo(b.target);
        const shift = b.shift == null ? "" : String(b.shift);
        if (!target || !b.date || !["", "M", "E", "D", "O", "L"].includes(shift)) return json({ error: "參數錯誤" }, 400);
        const now = new Date().toISOString();
        if (!shift) {
          await env.DB.prepare("DELETE FROM shifts WHERE empno=? AND date=?").bind(target, b.date).run();
        } else {
          await env.DB.prepare("INSERT INTO shifts (empno,date,shift,updated_at) VALUES (?,?,?,?) ON CONFLICT(empno,date) DO UPDATE SET shift=excluded.shift, updated_at=excluded.updated_at").bind(target, b.date, shift, now).run();
        }
        return json({ ok: true });
      }
      // 班別上班時間設定：查
      if (url.pathname === "/api/shift-config/get" && request.method === "POST") {
        const b = await request.json();
        const caller = await authUser(env, b.empno, b.token);
        if (!caller) return json({ error: "登入已失效，請重新登入" }, 401);
        return json({ ok: true, config: await getShiftConfig(env) });
      }
      // 班別上班時間設定：設（限主管/管理層）
      if (url.pathname === "/api/shift-config/set" && request.method === "POST") {
        await ensureConfig(env);
        const b = await request.json();
        const caller = await authUser(env, b.empno, b.token);
        if (!caller || (caller.perm !== "admin" && caller.perm !== "manager")) return json({ error: "沒有設定權限" }, 403);
        const c = b.config || {};
        const reTime = /^([01]\d|2[0-3]):[0-5]\d$/;
        for (const k of ["M", "E", "D"]) {
          if (!reTime.test(String(c[k] || ""))) return json({ error: "時間格式需為 HH:MM" }, 400);
        }
        let grace = parseInt(c.grace, 10);
        if (isNaN(grace) || grace < 0 || grace > 120) grace = 15;
        const v = JSON.stringify({ M: c.M, E: c.E, D: c.D, grace });
        await env.DB.prepare("INSERT INTO config (k,v) VALUES ('shift_times',?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").bind(v).run();
        return json({ ok: true, config: JSON.parse(v) });
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "伺服器錯誤：" + e.message }, 500);
    }
  },
};
