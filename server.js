'use strict';
/* خادم موقع مجوهرات أحمد مسك — بدون أي مكتبات خارجية (Node 18+) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC = ROOT;
const STATIC = new Set(['index.html', 'owner.js', 'owner.css']); // فقط هذه الملفات تُعرض للزوار
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');
const ADMIN_FILE = path.join(DATA, 'admin.json');
fs.mkdirSync(UPLOADS, { recursive: true });

/* ---------- قاعدة البيانات (ملف JSON) ---------- */
const DEFAULT_DB = {
  nextId: 11,
  settings: {
    whatsapp: '9647XXXXXXXXX', instagram: 'your_instagram', currency: 'د.ع',
    heroTitle: 'أناقة تدوم مدى الحياة',
    heroText: 'اكتشف مجموعتنا من الذهب والمجوهرات الفاخرة. اختر، اطلب، ونوصلك لباب بيتك.'
  },
  products: [
    [1, 'خاتم سوليتير ذهب 21', 'خواتم', 450000], [2, 'خاتم نسائي مرصّع', 'خواتم', 380000],
    [3, 'سوار ذهب إيطالي', 'أساور', 620000], [4, 'أنسيال ناعم', 'أساور', 310000],
    [5, 'قلادة بحرف اسم', 'قلادات', 290000], [6, 'سلسال ذهب مع حلق', 'قلادات', 540000],
    [7, 'حلق ذهب دائري', 'أقراط', 210000], [8, 'حلق لؤلؤ', 'أقراط', 240000],
    [9, 'طقم عروس كامل', 'أطقم', 2400000], [10, 'طقم ذهب 21 ثلاث قطع', 'أطقم', 1350000]
  ].map(([id, name, cat, price]) => ({ id, name, cat, price, desc: '', image: '', available: true })),
  orders: []
};
let saving = false, dirty = false;
let db;
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
catch { db = JSON.parse(JSON.stringify(DEFAULT_DB)); saveDb(); }
function saveDb() {
  dirty = true;
  if (saving) return;
  saving = true; dirty = false;
  const tmp = DB_FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db, null, 1), err => {
    if (!err) fs.renameSync(tmp, DB_FILE);
    saving = false;
    if (dirty) saveDb();
  });
}

/* ---------- حساب المالك (كلمة المرور مشفّرة بـ scrypt) ---------- */
function hashPass(pass, salt) { return crypto.scryptSync(String(pass), salt, 64).toString('hex'); }
function setAdmin(user, pass) {
  const salt = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(ADMIN_FILE, JSON.stringify({ user, salt, hash: hashPass(pass, salt) }), { mode: 0o600 });
}
if (!fs.existsSync(ADMIN_FILE)) {
  const user = process.env.ADMIN_USER || 'owner';
  let pass = process.env.ADMIN_PASS;
  let generated = false;
  if (!pass) { pass = crypto.randomBytes(9).toString('base64url'); generated = true; }
  setAdmin(user, pass);
  console.log('\n==== تم إنشاء حساب المالك ====');
  console.log('اسم المستخدم:', user);
  if (generated) console.log('كلمة المرور المؤقتة:', pass, '\n(غيّرها من لوحة المالك بعد أول دخول)');
  else console.log('كلمة المرور: من متغير ADMIN_PASS');
  console.log('==============================\n');
}
let admin = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
const sha = v => crypto.createHash('sha256').update(String(v)).digest();
function checkAdmin(user, pass) {
  const a = Buffer.from(hashPass(pass, admin.salt), 'hex'), b = Buffer.from(admin.hash, 'hex');
  const passOk = crypto.timingSafeEqual(a, b);
  const userOk = crypto.timingSafeEqual(sha(user), sha(admin.user));
  return passOk && userOk;
}

/* ---------- الجلسات وحماية المحاولات ---------- */
const sessions = new Map(); // token -> expiry
const SESSION_MS = 12 * 3600 * 1000;
function newSession() { const t = crypto.randomBytes(32).toString('hex'); sessions.set(t, Date.now() + SESSION_MS); return t; }
function getCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? m.slice(name.length + 1) : null;
}
function isAuthed(req) {
  const t = getCookie(req, 'sid'); const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
const loginFails = new Map(); // ip -> {n, until}
const orderHits = new Map();  // ip -> [timestamps]
function ipOf(req) { return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
setInterval(() => {
  const now = Date.now();
  for (const [t, e] of sessions) if (e < now) sessions.delete(t);
  for (const [k, v] of loginFails) if (v.until < now && v.n < 5) loginFails.delete(k);
  for (const [k, v] of orderHits) { const f = v.filter(x => now - x < 3600e3); f.length ? orderHits.set(k, f) : orderHits.delete(k); }
}, 600e3).unref();

/* ---------- أدوات ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
function secure(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function send(req, res, code, body, type, extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers = { 'Content-Type': type, ...extra };
  if (/^(text|application\/(json|javascript))/.test(type) && buf.length > 1024 && /gzip/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding';
    return res.writeHead(code, headers).end(zlib.gzipSync(buf));
  }
  res.writeHead(code, headers).end(buf);
}
const json = (req, res, code, obj, extra) => send(req, res, code, JSON.stringify(obj), MIME['.json'], { 'Cache-Control': 'no-store', ...extra });
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, limit = 20000) {
  const b = await readBody(req, limit);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('bad json'), { code: 400 }); }
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/* ---------- التحقق من المدخلات ---------- */
function cleanProduct(b) {
  const name = str(b.name, 100), cat = str(b.cat, 40), desc = str(b.desc, 300);
  const price = Math.round(Number(b.price));
  if (!name || !cat) return { error: 'الاسم والقسم مطلوبان' };
  if (!Number.isFinite(price) || price < 0 || price > 1e10) return { error: 'السعر غير صحيح' };
  let image = typeof b.image === 'string' ? b.image : '';
  if (image && !/^\/uploads\/[a-f0-9]{24}\.(jpg|png|webp)$/.test(image)) return { error: 'مسار الصورة غير صحيح' };
  return { value: { name, cat, price, desc, image, available: b.available !== false } };
}
function cleanSettings(b) {
  const s = {};
  const wa = String(b.whatsapp || '').replace(/\D/g, '');
  if (wa && (wa.length < 8 || wa.length > 15)) return { error: 'رقم الواتساب غير صحيح (صيغة دولية بدون +)' };
  s.whatsapp = wa || db.settings.whatsapp;
  const ig = str(b.instagram, 30).replace(/^@/, '');
  if (ig && !/^[A-Za-z0-9._]{1,30}$/.test(ig)) return { error: 'اسم حساب الانستغرام غير صحيح' };
  s.instagram = ig || db.settings.instagram;
  s.currency = str(b.currency, 10) || db.settings.currency;
  s.heroTitle = str(b.heroTitle, 80); s.heroText = str(b.heroText, 300);
  return { value: s };
}
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function removeUpload(url) {
  const m = /^\/uploads\/([a-f0-9]{24}\.(jpg|png|webp))$/.exec(url || '');
  if (m) fs.unlink(path.join(UPLOADS, m[1]), () => {});
}

/* ---------- المسارات ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) { try { if (new URL(origin).host !== req.headers.host) return json(req, res, 403, { error: 'مرفوض' }); } catch { return json(req, res, 403, { error: 'مرفوض' }); } }
  }

  /* عام */
  if (p === '/api/store' && m === 'GET') return json(req, res, 200, { settings: db.settings, products: db.products });

  if (p === '/api/orders' && m === 'POST') {
    const ip = ipOf(req), now = Date.now();
    const hits = (orderHits.get(ip) || []).filter(x => now - x < 3600e3);
    if (hits.length >= 10) return json(req, res, 429, { error: 'محاولات كثيرة، حاول لاحقاً' });
    const b = await readJson(req);
    const name = str(b.name, 80), phone = str(b.phone, 30), address = str(b.address, 250);
    if (!name || !phone || !address || !/\d{6,}/.test(phone.replace(/\D/g, '') ) ) return json(req, res, 400, { error: 'تأكد من الاسم والهاتف والعنوان' });
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 30) return json(req, res, 400, { error: 'السلة فارغة' });
    const items = []; let total = 0;
    for (const it of b.items) {
      const prod = db.products.find(x => x.id === Number(it.id));
      const qty = Math.floor(Number(it.qty));
      if (!prod || prod.available === false || !(qty >= 1 && qty <= 20)) return json(req, res, 400, { error: 'منتج غير متوفر في السلة' });
      items.push({ id: prod.id, name: prod.name, price: prod.price, qty }); total += prod.price * qty;
    }
    hits.push(now); orderHits.set(ip, hits);
    const id = db.nextId++;
    db.orders.unshift({ id, date: new Date().toISOString(), name, phone, address, items, total, status: 'new' });
    if (db.orders.length > 3000) db.orders.length = 3000;
    saveDb();
    return json(req, res, 200, { ok: true, id });
  }

  /* الدخول */
  if (p === '/api/login' && m === 'POST') {
    const ip = ipOf(req), f = loginFails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return json(req, res, 429, { error: 'تم إيقاف المحاولات مؤقتاً. حاول بعد ' + Math.ceil((f.until - Date.now()) / 60000) + ' دقيقة' });
    const b = await readJson(req, 2000);
    if (checkAdmin(str(b.username, 100), String(b.password || '').slice(0, 200))) {
      loginFails.delete(ip);
      const t = newSession();
      const secureFlag = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return json(req, res, 200, { ok: true }, { 'Set-Cookie': `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secureFlag}` });
    }
    f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60000; }
    loginFails.set(ip, f);
    await new Promise(r => setTimeout(r, 600));
    return json(req, res, 401, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  if (p === '/api/logout' && m === 'POST') {
    const t = getCookie(req, 'sid'); if (t) sessions.delete(t);
    return json(req, res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p === '/api/me' && m === 'GET') return json(req, res, 200, { owner: isAuthed(req) });

  /* كل ما يلي للمالك فقط */
  if (p.startsWith('/api/admin/')) {
    if (!isAuthed(req)) return json(req, res, 401, { error: 'غير مصرّح' });

    if (p === '/api/admin/orders' && m === 'GET') return json(req, res, 200, { orders: db.orders });
    let mm;
    if ((mm = /^\/api\/admin\/orders\/(\d+)$/.exec(p))) {
      const i = db.orders.findIndex(o => o.id === +mm[1]);
      if (i < 0) return json(req, res, 404, { error: 'غير موجود' });
      if (m === 'PUT') {
        const b = await readJson(req, 500);
        if (!['new', 'processing', 'done', 'cancelled'].includes(b.status)) return json(req, res, 400, { error: 'حالة غير صحيحة' });
        db.orders[i].status = b.status; saveDb(); return json(req, res, 200, { ok: true });
      }
      if (m === 'DELETE') { db.orders.splice(i, 1); saveDb(); return json(req, res, 200, { ok: true }); }
    }

    if (p === '/api/admin/products' && m === 'POST') {
      const r = cleanProduct(await readJson(req)); if (r.error) return json(req, res, 400, { error: r.error });
      const prod = { id: db.nextId++, ...r.value }; db.products.unshift(prod); saveDb(); return json(req, res, 200, { product: prod });
    }
    if ((mm = /^\/api\/admin\/products\/(\d+)$/.exec(p))) {
      const i = db.products.findIndex(x => x.id === +mm[1]);
      if (i < 0) return json(req, res, 404, { error: 'غير موجود' });
      if (m === 'PUT') {
        const r = cleanProduct(await readJson(req)); if (r.error) return json(req, res, 400, { error: r.error });
        if (db.products[i].image && db.products[i].image !== r.value.image) removeUpload(db.products[i].image);
        db.products[i] = { id: db.products[i].id, ...r.value }; saveDb(); return json(req, res, 200, { product: db.products[i] });
      }
      if (m === 'DELETE') { removeUpload(db.products[i].image); db.products.splice(i, 1); saveDb(); return json(req, res, 200, { ok: true }); }
    }

    if (p === '/api/admin/upload' && m === 'POST') {
      const buf = await readBody(req, 5 * 1024 * 1024);
      const ext = sniffImage(buf);
      if (!ext) return json(req, res, 400, { error: 'الملف ليس صورة صالحة (JPG / PNG / WEBP)' });
      const name = crypto.randomBytes(12).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UPLOADS, name), buf);
      return json(req, res, 200, { url: '/uploads/' + name });
    }

    if (p === '/api/admin/settings' && m === 'PUT') {
      const r = cleanSettings(await readJson(req)); if (r.error) return json(req, res, 400, { error: r.error });
      db.settings = r.value; saveDb(); return json(req, res, 200, { settings: db.settings });
    }

    if (p === '/api/admin/account' && m === 'PUT') {
      const b = await readJson(req, 2000);
      if (!checkAdmin(admin.user, String(b.currentPassword || '').slice(0, 200))) return json(req, res, 403, { error: 'كلمة المرور الحالية غير صحيحة' });
      const user = str(b.username, 40) || admin.user, pass = String(b.newPassword || '');
      if (user.length < 3) return json(req, res, 400, { error: 'اسم المستخدم قصير جداً' });
      if (pass && pass.length < 8) return json(req, res, 400, { error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' });
      setAdmin(user, pass || String(b.currentPassword));
      admin = JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8'));
      const keep = getCookie(req, 'sid'); for (const t of [...sessions.keys()]) if (t !== keep) sessions.delete(t);
      return json(req, res, 200, { ok: true });
    }
  }
  return json(req, res, 404, { error: 'غير موجود' });
}

function serveFile(req, res, base, rel, cache) {
  let file;
  try { file = path.join(base, decodeURIComponent(rel)); } catch { return send(req, res, 400, 'bad', 'text/plain'); }
  if (!file.startsWith(base + path.sep) || path.basename(file).startsWith('.')) return send(req, res, 403, 'forbidden', 'text/plain');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(req, res, 404, 'غير موجود', 'text/plain; charset=utf-8');
    fs.readFile(file, (e, data) => {
      if (e) return send(req, res, 500, 'error', 'text/plain');
      send(req, res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': cache });
    });
  });
}

const server = http.createServer(async (req, res) => {
  secure(req, res);
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'method not allowed', 'text/plain');
    if (url.pathname.startsWith('/uploads/')) return serveFile(req, res, UPLOADS, url.pathname.slice(9), 'public, max-age=2592000, immutable');
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!STATIC.has(rel)) return send(req, res, 404, 'غير موجود', 'text/plain; charset=utf-8');
    return serveFile(req, res, PUBLIC, rel, 'no-cache');
  } catch (e) {
    const code = e.code === 413 ? 413 : e.code === 400 ? 400 : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(req, res, code, { error: code === 413 ? 'الحجم كبير جداً' : code === 400 ? 'طلب غير صحيح' : 'خطأ في الخادم' });
  }
});
server.listen(PORT, () => console.log('الموقع يعمل على المنفذ ' + PORT));
