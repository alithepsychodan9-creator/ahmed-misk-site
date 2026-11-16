/* طبقة الاتصال بقاعدة البيانات (Supabase) — بدون أي مكتبات */
(function () {
  'use strict';
  var C = window.SITE_CONFIG || {};
  var URL_ = String(C.SUPABASE_URL || '').trim().replace(/\/+$/, ''), KEY = String(C.SUPABASE_ANON_KEY || '').trim();
  var ready = /^https?:\/\//.test(URL_) && !/YOUR|ضع/i.test(URL_ + KEY) && KEY.length > 20;
  var isJwt = KEY.split('.').length === 3;
  var SKEY = 'ahmed_misk_session', sess = null;
  try { sess = JSON.parse(localStorage.getItem(SKEY) || 'null'); } catch (e) {}
  function save(s) { sess = s; try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch (e) {} }

  function authErr(st, d) {
    var m = st === 400 || st === 401 ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة'
      : st === 429 ? 'محاولات كثيرة، حاول بعد قليل'
      : st === 422 ? ((d && (d.msg || d.message)) || 'قيمة غير مقبولة')
      : 'تعذر الاتصال، حاول مرة ثانية';
    var e = new Error(m); e.status = st; return e;
  }
  async function authCall(method, path, body, tok) {
    var h = { apikey: KEY, 'Content-Type': 'application/json' }; if (tok) h.Authorization = 'Bearer ' + tok;
    var r = await fetch(URL_ + '/auth/v1/' + path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    var d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) throw authErr(r.status, d);
    return d || {};
  }
  function setSession(d) {
    save({ access: d.access_token, refresh: d.refresh_token, exp: Date.now() + Math.max(60, (d.expires_in || 3600) - 60) * 1000, email: (d.user && d.user.email) || (sess && sess.email) || '' });
  }
  async function token() {
    if (!sess) return null;
    if (Date.now() < sess.exp) return sess.access;
    try { var d = await authCall('POST', 'token?grant_type=refresh_token', { refresh_token: sess.refresh }); setSession(d); return sess.access; }
    catch (e) { save(null); return null; }
  }
  async function call(method, path, o) {
    o = o || {};
    var tok = await token(), h = Object.assign({ apikey: KEY }, o.headers || {});
    var bearer = tok || (isJwt ? KEY : null); if (bearer) h.Authorization = 'Bearer ' + bearer;
    var body;
    if (o.blob) { body = o.blob; h['Content-Type'] = o.blob.type || 'application/octet-stream'; }
    else if (o.body !== undefined) { body = JSON.stringify(o.body); h['Content-Type'] = 'application/json'; }
    var r = await fetch(URL_ + path, { method: method, headers: h, body: body, cache: 'no-store' });
    var d = null; try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      var msg = (r.status === 401 || r.status === 403) ? 'ليس لديك صلاحية أو انتهت الجلسة' : ((d && (d.message || d.msg || d.error_description)) || 'حدث خطأ');
      var err = new Error(msg); err.status = r.status; throw err;
    }
    return d;
  }
  function rand24() { var a = new Uint8Array(12); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }

  window.SB = {
    ready: ready,
    loggedIn: function () { return !!sess; },
    email: function () { return sess ? sess.email : ''; },
    img: function (n) { return n ? URL_ + '/storage/v1/object/public/products/' + n : ''; },
    thumb: function (n) { return n ? URL_ + '/storage/v1/object/public/products/t_' + n : ''; },
    get: function (p) { return call('GET', '/rest/v1/' + p); },
    post: function (p, b) { return call('POST', '/rest/v1/' + p, { body: b, headers: { Prefer: 'return=representation' } }); },
    patch: function (p, b) { return call('PATCH', '/rest/v1/' + p, { body: b, headers: { Prefer: 'return=representation' } }); },
    del: function (p) { return call('DELETE', '/rest/v1/' + p); },
    rpc: function (fn, b) { return call('POST', '/rest/v1/rpc/' + fn, { body: b || {} }); },
    login: async function (email, password) { var d = await authCall('POST', 'token?grant_type=password', { email: String(email).trim(), password: password }); setSession(d); return d; },
    logout: async function () { try { var t = await token(); if (t) await authCall('POST', 'logout', {}, t); } catch (e) {} save(null); },
    changePassword: async function (pw) { var t = await token(); if (!t) { var e = new Error('انتهت الجلسة'); e.status = 401; throw e; } await authCall('PUT', 'user', { password: pw }, t); },
    upload: async function (blob, thumb) {
      var ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg', name = rand24() + '.' + ext;
      await call('POST', '/storage/v1/object/products/' + name, { blob: blob });
      if (thumb) { try { await call('POST', '/storage/v1/object/products/t_' + name, { blob: thumb }); } catch (e) {} }
      return name;
    },
    removeImage: function (n) {
      if (!n) return Promise.resolve();
      return Promise.all([call('DELETE', '/storage/v1/object/products/' + n).catch(function () {}), call('DELETE', '/storage/v1/object/products/t_' + n).catch(function () {})]);
    }
  };
})();
