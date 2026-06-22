// 廣修打卡 + 員工名錄 + 權限 + 案場排班 Worker API（案場制）
// 部署：複製本檔 → Cloudflare guangxiu-punch → </> Edit code → 貼上 → Deploy
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
function distM(a, b, c, d) {
  if (a == null || b == null || c == null || d == null) return null;
  const R = 6371000, t = Math.PI / 180;
  const dLat = (c - a) * t, dLng = (d - b) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * t) * Math.cos(c * t) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}
async function ensureUsers(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS users (empno TEXT PRIMARY KEY, pass_hash TEXT NOT NULL, name TEXT, role TEXT, perm TEXT, updated_at TEXT)").run();
  for (const col of ["role TEXT", "perm TEXT"]) { try { await env.DB.prepare("ALTER TABLE users ADD COLUMN " + col).run(); } catch (e) {} }
}
async function ensureSites(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sites (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, address TEXT, lat REAL, lng REAL, status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT)").run();
}
async function ensureSchedule(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS schedule (empno TEXT NOT NULL, date TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT, site_id INTEGER, updated_at TEXT, PRIMARY KEY (empno,date,seq))").run();
}
async function ensurePunches(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS punches (id INTEGER PRIMARY KEY AUTOINCREMENT, emp TEXT NOT NULL, type TEXT NOT NULL, lat REAL, lng REAL, acc INTEGER, punched_at TEXT NOT NULL)").run();
  for (const col of ["site_id INTEGER", "site_name TEXT", "dev_m INTEGER", "grp TEXT", "early INTEGER"]) {
    try { await env.DB.prepare("ALTER TABLE punches ADD COLUMN " + col).run(); } catch (e) {}
  }
}
async function makeToken(env, empno, passHash) { return await sha256(empno + "|" + passHash + "|" + env.ADMIN_KEY); }
async function userByToken(env, empno, token) {
  if (!empno || !token) return null;
  const u = await env.DB.prepare("SELECT * FROM users WHERE empno=?").bind(empno).first();
  if (!u) return null;
  return token === await makeToken(env, empno, u.pass_hash) ? u : null;
}
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
function groupOf(perm) { return (perm === "admin" || perm === "manager") ? "office" : "site"; }
const END_MIN = { site: 17 * 60, office: 18 * 60 }; // 工地師傅17:00 / 管理部18:00
function p2(n) { return String(n).padStart(2, "0"); }
function twWall() { return new Date(Date.now() + 8 * 3600 * 1000); }
function twDateStr(d) { return d.getUTCFullYear() + "-" + p2(d.getUTCMonth() + 1) + "-" + p2(d.getUTCDate()); }

const ROSTER = [
  ["001", "陳建修", "董事長", "admin"], ["002", "陳敬廉", "總經理", "admin"], ["003", "陳冠男", "副總經理", "admin"],
  ["004", "陳軍廷", "工務經理", "manager"], ["005", "康竣凱", "工務經理", "manager"], ["006", "蕭尉勳", "特助", "admin"], ["007", "楊茜媛", "會計", "manager"],
  ["008", "林榮", "工地領班", "staff"], ["009", "羅忠陽", "工地領班", "staff"],
  ["010", "陳凱強", "技工", "staff"], ["011", "羅忠順", "技工", "staff"], ["012", "蘇慶昌", "技工", "staff"], ["013", "呂忠義", "技工", "staff"],
  ["014", "胡定", "移工", "staff"], ["015", "德偉", "移工", "staff"], ["016", "阿南", "移工", "staff"], ["017", "EKO", "移工", "staff"], ["018", "阿NO", "移工", "staff"],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const isAdmin = () => url.searchParams.get("key") === env.ADMIN_KEY;
    try {
      // ===== 登入 =====
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
        const must_change = u.pass_hash === await sha256(empno + ":1234") ? 1 : 0;
        return json({ ok: true, empno, name: u.name || "員工" + empno, role: u.role || "", perm: u.perm || "staff", must_change, token: await makeToken(env, empno, u.pass_hash) });
      }
      // ===== 改密碼 =====
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
      // ===== 打卡（綁案場 + 偏離 + 早退）=====
      if (url.pathname === "/api/punch" && request.method === "POST") {
        await ensurePunches(env); await ensureSites(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        const u = await userByToken(env, empno, b.token);
        if (!u) return json({ error: "請先登入" }, 401);
        if (!b.type) return json({ error: "缺少打卡類別" }, 400);
        const at = new Date().toISOString();
        const tw = twWall();
        let site_id = b.site_id ? parseInt(b.site_id, 10) : null;
        let site_name = null, dev_m = null;
        if (site_id) {
          const s = await env.DB.prepare("SELECT * FROM sites WHERE id=?").bind(site_id).first();
          if (s) { site_name = s.name; dev_m = distM(b.lat, b.lng, s.lat, s.lng); }
          else site_id = null;
        }
        const grp = groupOf(u.perm);
        let early = null;
        if (b.type === "out") {
          const nowMin = tw.getUTCHours() * 60 + tw.getUTCMinutes();
          early = nowMin < END_MIN[grp] ? 1 : 0;
        }
        const res = await env.DB.prepare(
          "INSERT INTO punches (emp,type,lat,lng,acc,punched_at,site_id,site_name,dev_m,grp,early) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).bind(u.name ? empno + " " + u.name : empno, b.type, b.lat ?? null, b.lng ?? null, b.acc ?? null, at, site_id, site_name, dev_m, grp, early).run();
        return json({ ok: true, id: res.meta.last_row_id, punched_at: at, site_name, dev_m, early });
      }
      // ===== 後台讀打卡 =====
      if (url.pathname === "/api/punches" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        let q = "SELECT * FROM punches WHERE 1=1"; const ps = [];
        const emp = url.searchParams.get("emp"); if (emp) { q += " AND emp = ?"; ps.push(emp); }
        const date = url.searchParams.get("date"); if (date) { q += " AND substr(punched_at,1,10) = ?"; ps.push(date); }
        q += " ORDER BY punched_at DESC LIMIT 2000";
        const { results } = await env.DB.prepare(q).bind(...ps).all();
        return json({ ok: true, rows: results });
      }
      // ===== 名錄 / 權限 =====
      if (url.pathname === "/api/admin/users" && request.method === "GET") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const { results } = await env.DB.prepare("SELECT empno,name,role,perm,updated_at FROM users ORDER BY empno").all();
        return json({ ok: true, rows: results });
      }
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
      if (url.pathname === "/api/admin/set-perm" && request.method === "POST") {
        if (!isAdmin()) return json({ error: "密碼錯誤" }, 401);
        await ensureUsers(env);
        const b = await request.json();
        const empno = padNo(b.empno);
        if (!empno || !["admin", "manager", "staff"].includes(b.perm)) return json({ error: "參數錯誤" }, 400);
        await env.DB.prepare("UPDATE users SET perm=?, updated_at=? WHERE empno=?").bind(b.perm, new Date().toISOString(), empno).run();
        return json({ ok: true });
      }
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
      // ===== 案場清單 =====
      if (url.pathname === "/api/sites/list" && request.method === "POST") {
        await ensureSites(env);
        const b = await request.json();
        const caller = isAdmin() ? { empno: "000", perm: "admin" } : await authUser(env, b.empno, b.token);
        if (!caller) return json({ error: "登入已失效，請重新登入" }, 401);
        const { results } = await env.DB.prepare("SELECT * FROM sites ORDER BY status ASC, id DESC").all();
        return json({ ok: true, rows: results });
      }
      // ===== 案場 新增/編輯/完工（限主管/管理層）=====
      if (url.pathname === "/api/sites/save" && request.method === "POST") {
        await ensureSites(env);
        const b = await request.json();
        const caller = isAdmin() ? { empno: "000", perm: "admin" } : await authUser(env, b.empno, b.token);
        if (!caller || (caller.perm !== "admin" && caller.perm !== "manager")) return json({ error: "沒有管理案場權限" }, 403);
        const name = (b.name || "").trim();
        if (!name) return json({ error: "請輸入案場名稱" }, 400);
        const address = (b.address || "").trim() || null;
        const lat = (b.lat === "" || b.lat == null) ? null : parseFloat(b.lat);
        const lng = (b.lng === "" || b.lng == null) ? null : parseFloat(b.lng);
        const status = b.status === "done" ? "done" : "active";
        const now = new Date().toISOString();
        if (b.id) {
          await env.DB.prepare("UPDATE sites SET name=?,address=?,lat=?,lng=?,status=?,updated_at=? WHERE id=?")
            .bind(name, address, lat, lng, status, now, parseInt(b.id, 10)).run();
          return json({ ok: true, id: parseInt(b.id, 10) });
        } else {
          const res = await env.DB.prepare("INSERT INTO sites (name,address,lat,lng,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
            .bind(name, address, lat, lng, status, now, now).run();
          return json({ ok: true, id: res.meta.last_row_id });
        }
      }
      // ===== 案場 刪除（限主管/管理層）=====
      if (url.pathname === "/api/sites/delete" && request.method === "POST") {
        await ensureSites(env);
        const b = await request.json();
        const caller = isAdmin() ? { empno: "000", perm: "admin" } : await authUser(env, b.empno, b.token);
        if (!caller || (caller.perm !== "admin" && caller.perm !== "manager")) return json({ error: "沒有管理案場權限" }, 403);
        if (!b.id) return json({ error: "缺少案場" }, 400);
        await env.DB.prepare("DELETE FROM sites WHERE id=?").bind(parseInt(b.id, 10)).run();
        return json({ ok: true });
      }
      // ===== 班表查詢（所有人可看，班表公開）=====
      if (url.pathname === "/api/schedule/list" && request.method === "POST") {
        await ensureSchedule(env); await ensureSites(env);
        const b = await request.json();
        const caller = isAdmin() ? { empno: "000", perm: "admin" } : await authUser(env, b.empno, b.token);
        if (!caller) return json({ error: "登入已失效，請重新登入" }, 401);
        if (!b.from || !b.to) return json({ error: "缺少日期範圍" }, 400);
        const { results } = await env.DB.prepare(
          "SELECT s.empno,s.date,s.seq,s.kind,s.site_id, si.name AS site_name FROM schedule s LEFT JOIN sites si ON si.id=s.site_id WHERE s.date>=? AND s.date<=? ORDER BY s.empno,s.date,s.seq"
        ).bind(b.from, b.to).all();
        return json({ ok: true, rows: results });
      }
      // ===== 排班設定（限主管/管理層）items=[{kind:'site',site_id} ...] 或 [{kind:'off'}] =====
      if (url.pathname === "/api/schedule/set" && request.method === "POST") {
        await ensureSchedule(env);
        const b = await request.json();
        const caller = isAdmin() ? { empno: "000", perm: "admin" } : await authUser(env, b.empno, b.token);
        if (!caller || (caller.perm !== "admin" && caller.perm !== "manager")) return json({ error: "沒有排班權限" }, 403);
        const target = padNo(b.target);
        if (!target || !b.date) return json({ error: "參數錯誤" }, 400);
        const items = Array.isArray(b.items) ? b.items : [];
        const now = new Date().toISOString();
        await env.DB.prepare("DELETE FROM schedule WHERE empno=? AND date=?").bind(target, b.date).run();
        let seq = 0;
        const stmts = [];
        for (const it of items) {
          if (it.kind === "off") {
            stmts.push(env.DB.prepare("INSERT INTO schedule (empno,date,seq,kind,site_id,updated_at) VALUES (?,?,?,?,?,?)").bind(target, b.date, seq++, "off", null, now));
          } else if (it.kind === "site" && it.site_id) {
            stmts.push(env.DB.prepare("INSERT INTO schedule (empno,date,seq,kind,site_id,updated_at) VALUES (?,?,?,?,?,?)").bind(target, b.date, seq++, "site", parseInt(it.site_id, 10), now));
          }
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true });
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "伺服器錯誤：" + e.message }, 500);
    }
  },
};
