/* لوحة المالك — تعمل فقط بعد تسجيل الدخول، والحماية الحقيقية على الخادم */
(function () {
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = t => (typeof toast === 'function' ? toast(t) : alert(t));
  const money = n => Number(n).toLocaleString('en-US') + ' ' + (window.SETTINGS_CUR || (typeof SETTINGS !== 'undefined' ? SETTINGS.currency : ''));
  let tab = 'products', data = { products: [], orders: [], settings: {} }, editing = null, pendingImage = '';

  async function api(method, path, body, raw) {
    const opt = { method, headers: {}, credentials: 'same-origin' };
    if (raw) { opt.body = raw; opt.headers['Content-Type'] = raw.type; }
    else if (body !== undefined) { opt.body = JSON.stringify(body); opt.headers['Content-Type'] = 'application/json'; }
    const r = await fetch(path, opt);
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (r.status === 401 && path.startsWith('/api/admin/')) { closePanel(); openLogin(); throw new Error('انتهت الجلسة، سجّل الدخول من جديد'); }
    if (!r.ok) throw new Error(d.error || 'حدث خطأ');
    return d;
  }

  /* ---------- نافذة الدخول ---------- */
  const back = document.createElement('div');
  back.className = 'o-back';
  back.innerHTML = `
    <form class="o-box" id="oLogin" autocomplete="on">
      <h2>دخول المالك</h2>
      <div class="sub">هذه المنطقة خاصة بصاحب المحل فقط</div>
      <label class="o-field">اسم المستخدم<input id="oUser" name="username" autocomplete="username" required></label>
      <label class="o-field">كلمة المرور<input id="oPass" name="password" type="password" autocomplete="current-password" required></label>
      <div class="o-err" id="oErr"></div>
      <button class="o-btn gold full" id="oGo" type="submit">دخول</button>
      <button class="o-btn ghost full" id="oCancel" type="button" style="margin-top:8px">إلغاء</button>
    </form>`;
  document.body.appendChild(back);
  const $o = id => document.getElementById(id);

  function openLogin() { $o('oErr').textContent = ''; $o('oPass').value = ''; back.classList.add('open'); setTimeout(() => $o('oUser').focus(), 50); }
  function closeLogin() { back.classList.remove('open'); }
  $o('oCancel').onclick = closeLogin;
  back.addEventListener('mousedown', e => { if (e.target === back) closeLogin(); });
  $o('oLogin').addEventListener('submit', async e => {
    e.preventDefault();
    const b = $o('oGo'); b.disabled = true; $o('oErr').textContent = '';
    try {
      await api('POST', '/api/login', { username: $o('oUser').value, password: $o('oPass').value });
      $o('oPass').value = ''; closeLogin(); openPanel();
    } catch (err) { $o('oErr').textContent = err.message; }
    b.disabled = false;
  });

  /* ---------- زر المالك ---------- */
  document.getElementById('ownerBtn').addEventListener('click', async () => {
    if (typeof ONLINE !== 'undefined' && !ONLINE) return say('لوحة المالك تعمل عند تشغيل الموقع على الخادم');
    try { const r = await api('GET', '/api/me'); r.owner ? openPanel() : openLogin(); }
    catch (e) { say('تعذر الاتصال بالخادم'); }
  });

  /* ---------- اللوحة ---------- */
  const panel = document.createElement('div');
  panel.id = 'oPanel';
  panel.innerHTML = `
    <div class="o-top"><h2>👑 لوحة المالك</h2>
      <div style="display:flex;gap:6px"><button class="o-btn" id="oView">عرض الموقع</button><button class="o-btn" id="oOut">خروج</button></div></div>
    <div class="o-tabs" id="oTabs"></div>
    <div class="o-body" id="oBody"></div>`;
  document.body.appendChild(panel);

  function closePanel() { panel.classList.remove('open'); document.body.style.overflow = ''; }
  $o('oView').onclick = closePanel;
  $o('oOut').onclick = async () => { try { await api('POST', '/api/logout'); } catch (e) {} closePanel(); say('تم تسجيل الخروج'); };

  async function openPanel() {
    panel.classList.add('open'); document.body.style.overflow = 'hidden';
    editing = null;
    try {
      const [s, o] = await Promise.all([fetch('/api/store', { cache: 'no-store' }).then(r => r.json()), api('GET', '/api/admin/orders')]);
      data.products = s.products; data.settings = s.settings; data.orders = o.orders;
    } catch (e) { say(e.message); }
    render();
  }

  const TABS = [['products', 'المنتجات'], ['orders', 'الطلبات'], ['settings', 'إعدادات الموقع'], ['account', 'حساب المالك']];
  function render() {
    const fresh = data.orders.filter(o => o.status === 'new').length;
    $o('oTabs').innerHTML = TABS.map(([k, n]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${n}${k === 'orders' && fresh ? `<i>${fresh}</i>` : ''}</button>`).join('');
    $o('oTabs').querySelectorAll('button').forEach(b => b.onclick = () => { tab = b.dataset.t; editing = null; render(); });
    ({ products: viewProducts, orders: viewOrders, settings: viewSettings, account: viewAccount })[tab]();
  }
  async function refreshStore() { if (typeof loadStore === 'function') await loadStore(); }

  /* --- المنتجات --- */
  function viewProducts() {
    if (editing !== null) return viewProductForm();
    const list = data.products;
    $o('oBody').innerHTML = `
      <div class="o-bar"><b>${list.length} منتج</b><button class="o-btn gold" id="oAdd">＋ إضافة منتج</button></div>
      ${list.map(p => `
        <div class="o-row">
          <div class="th">${p.image ? `<img src="${E(p.image)}" alt="">` : '💎'}</div>
          <div class="tx"><b>${E(p.name)}</b><small>${E(p.cat)} · ${money(p.price)}</small>
            <span class="o-tag ${p.available === false ? 'off' : 'on'}">${p.available === false ? 'نفد' : 'متوفر'}</span></div>
          <div class="act"><button class="o-btn ghost sm" data-e="${+p.id}">تعديل</button><button class="o-btn danger sm" data-d="${+p.id}">حذف</button></div>
        </div>`).join('') || '<div class="o-empty">لا توجد منتجات بعد. اضغط «إضافة منتج».</div>'}`;
    $o('oAdd').onclick = () => { editing = 0; pendingImage = ''; render(); };
    $o('oBody').querySelectorAll('[data-e]').forEach(b => b.onclick = () => { editing = +b.dataset.e; pendingImage = (data.products.find(p => p.id === editing) || {}).image || ''; render(); });
    $o('oBody').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
      const p = data.products.find(x => x.id === +b.dataset.d);
      if (!confirm('حذف «' + p.name + '» نهائياً؟')) return;
      try { await api('DELETE', '/api/admin/products/' + p.id); data.products = data.products.filter(x => x.id !== p.id); render(); refreshStore(); say('تم الحذف'); }
      catch (e) { say(e.message); }
    });
  }

  function viewProductForm() {
    const p = editing ? data.products.find(x => x.id === editing) : { name: '', cat: '', price: '', desc: '', available: true };
    const cats = [...new Set(data.products.map(x => x.cat))];
    $o('oBody').innerHTML = `
      <form class="o-form" id="pForm">
        <h3 style="margin-top:14px">${editing ? 'تعديل منتج' : 'منتج جديد'}</h3>
        <div class="o-prev"><div class="th" id="pPrev">${pendingImage ? `<img src="${E(pendingImage)}" alt="">` : '💎'}</div>
          <div><input type="file" id="pFile" accept="image/*" hidden>
            <button type="button" class="o-btn ghost sm" id="pPick">اختيار صورة</button>
            <button type="button" class="o-btn danger sm" id="pClr">إزالة</button>
            <div class="o-ok" id="pUp"></div></div></div>
        <label class="o-field">اسم المنتج<input id="pName" maxlength="100" required value="${E(p.name)}"></label>
        <label class="o-field">القسم<input id="pCat" list="pCats" maxlength="40" required value="${E(p.cat)}" placeholder="مثال: خواتم">
          <datalist id="pCats">${cats.map(c => `<option value="${E(c)}">`).join('')}</datalist></label>
        <label class="o-field">السعر<input id="pPrice" type="number" min="0" step="1" inputmode="numeric" required value="${E(p.price)}"></label>
        <label class="o-field">وصف (اختياري)<textarea id="pDesc" rows="2" maxlength="300">${E(p.desc || '')}</textarea></label>
        <label class="o-chk"><input type="checkbox" id="pAv" ${p.available === false ? '' : 'checked'}> متوفر للبيع</label>
        <div class="o-err" id="pErr"></div>
        <div style="display:flex;gap:8px;margin-top:10px"><button class="o-btn gold" type="submit" id="pSave">حفظ</button><button type="button" class="o-btn ghost" id="pBack">رجوع</button></div>
      </form>`;
    $o('pBack').onclick = () => { editing = null; render(); };
    $o('pPick').onclick = () => $o('pFile').click();
    $o('pClr').onclick = () => { pendingImage = ''; $o('pPrev').innerHTML = '💎'; };
    $o('pFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $o('pUp').textContent = 'جاري رفع الصورة...';
      try {
        const blob = await shrink(f, 1100);
        const r = await api('POST', '/api/admin/upload', undefined, blob);
        pendingImage = r.url; $o('pPrev').innerHTML = `<img src="${E(r.url)}" alt="">`; $o('pUp').textContent = 'تم رفع الصورة ✓';
      } catch (err) { $o('pUp').textContent = ''; $o('pErr').textContent = err.message; }
    };
    $o('pForm').onsubmit = async e => {
      e.preventDefault(); $o('pErr').textContent = ''; $o('pSave').disabled = true;
      const body = { name: $o('pName').value, cat: $o('pCat').value, price: $o('pPrice').value, desc: $o('pDesc').value, image: pendingImage, available: $o('pAv').checked };
      try {
        const r = editing ? await api('PUT', '/api/admin/products/' + editing, body) : await api('POST', '/api/admin/products', body);
        if (editing) data.products = data.products.map(x => x.id === editing ? r.product : x); else data.products.unshift(r.product);
        editing = null; render(); refreshStore(); say('تم الحفظ ✓');
      } catch (err) { $o('pErr').textContent = err.message; $o('pSave').disabled = false; }
    };
  }

  function shrink(file, max) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? res(b) : rej(new Error('تعذر معالجة الصورة')), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('الملف ليس صورة')); };
      img.src = url;
    });
  }

  /* --- الطلبات --- */
  const ST = { new: 'جديد', processing: 'قيد التجهيز', done: 'تم التسليم', cancelled: 'ملغي' };
  function viewOrders() {
    const l = data.orders;
    $o('oBody').innerHTML = (l.map(o => {
      const ph = String(o.phone).replace(/\D/g, '');
      return `<div class="o-order">
        <header><b>طلب #${+o.id}</b><small>${E(new Date(o.date).toLocaleString('ar-IQ'))}</small></header>
        <div class="meta">👤 ${E(o.name)}<br>📞 <a href="tel:${E(ph)}">${E(o.phone)}</a> · <a target="_blank" rel="noopener" href="https://wa.me/${E(ph)}">واتساب</a><br>📍 ${E(o.address)}</div>
        <ul>${o.items.map(i => `<li>${E(i.name)} × ${+i.qty} — ${money(i.price * i.qty)}</li>`).join('')}</ul>
        <div class="o-total">المجموع: ${money(o.total)}</div>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
          <select data-s="${+o.id}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="o-btn danger sm" data-od="${+o.id}">حذف</button></div></div>`;
    }).join('')) || '<div class="o-empty">لا توجد طلبات بعد.</div>';
    $o('oBody').querySelectorAll('[data-s]').forEach(s => s.onchange = async () => {
      try { await api('PUT', '/api/admin/orders/' + s.dataset.s, { status: s.value }); data.orders.find(o => o.id === +s.dataset.s).status = s.value; render(); say('تم تحديث الحالة'); }
      catch (e) { say(e.message); }
    });
    $o('oBody').querySelectorAll('[data-od]').forEach(b => b.onclick = async () => {
      if (!confirm('حذف هذا الطلب؟')) return;
      try { await api('DELETE', '/api/admin/orders/' + b.dataset.od); data.orders = data.orders.filter(o => o.id !== +b.dataset.od); render(); }
      catch (e) { say(e.message); }
    });
  }

  /* --- الإعدادات --- */
  function viewSettings() {
    const s = data.settings;
    $o('oBody').innerHTML = `
      <form class="o-form" id="sForm"><h3 style="margin-top:14px">إعدادات الموقع</h3>
        <label class="o-field">رقم الواتساب (صيغة دولية بدون + مثل 9647701234567)<input id="sWa" inputmode="numeric" value="${E(s.whatsapp)}"></label>
        <label class="o-field">حساب الانستغرام (بدون @)<input id="sIg" value="${E(s.instagram)}"></label>
        <label class="o-field">العملة<input id="sCur" maxlength="10" value="${E(s.currency)}"></label>
        <label class="o-field">العنوان الرئيسي<input id="sT" maxlength="80" value="${E(s.heroTitle)}"></label>
        <label class="o-field">النص تحت العنوان<textarea id="sD" rows="2" maxlength="300">${E(s.heroText)}</textarea></label>
        <div class="o-err" id="sErr"></div>
        <button class="o-btn gold full" type="submit">حفظ الإعدادات</button></form>`;
    $o('sForm').onsubmit = async e => {
      e.preventDefault(); $o('sErr').textContent = '';
      try {
        const r = await api('PUT', '/api/admin/settings', { whatsapp: $o('sWa').value, instagram: $o('sIg').value, currency: $o('sCur').value, heroTitle: $o('sT').value, heroText: $o('sD').value });
        data.settings = r.settings; refreshStore(); say('تم حفظ الإعدادات ✓');
      } catch (err) { $o('sErr').textContent = err.message; }
    };
  }

  /* --- الحساب --- */
  function viewAccount() {
    $o('oBody').innerHTML = `
      <form class="o-form" id="aForm"><h3 style="margin-top:14px">تغيير اسم المستخدم / كلمة المرور</h3>
        <div class="o-note">استخدم كلمة مرور قوية (8 أحرف أو أكثر) ولا تشاركها مع أحد.</div>
        <label class="o-field">اسم المستخدم الجديد (اتركه فارغاً للإبقاء على الحالي)<input id="aU" autocomplete="username"></label>
        <label class="o-field">كلمة المرور الجديدة (اتركها فارغة للإبقاء على الحالية)<input id="aN" type="password" autocomplete="new-password"></label>
        <label class="o-field">كلمة المرور الحالية (مطلوبة للتأكيد)<input id="aC" type="password" autocomplete="current-password" required></label>
        <div class="o-err" id="aErr"></div>
        <button class="o-btn gold full" type="submit">حفظ</button></form>`;
    $o('aForm').onsubmit = async e => {
      e.preventDefault(); $o('aErr').textContent = '';
      try {
        await api('PUT', '/api/admin/account', { username: $o('aU').value, newPassword: $o('aN').value, currentPassword: $o('aC').value });
        $o('aForm').reset(); say('تم تحديث الحساب ✓');
      } catch (err) { $o('aErr').textContent = err.message; }
    };
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLogin(); } });
})();
