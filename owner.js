/* لوحة المالك — الحماية الحقيقية في قاعدة البيانات (Supabase RLS)، وهذه الواجهة للتعامل معها فقط */
(function () {
  'use strict';
  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = t => (typeof toast === 'function' ? toast(t) : alert(t));
  const money = n => Number(n).toLocaleString('en-US') + ' ' + (typeof SETTINGS !== 'undefined' ? SETTINGS.currency : '');
  let tab = 'products', data = { products: [], orders: [], settings: {} }, editing = null, pendingImage = '', origImage = '';

  const mapP = r => ({ id: +r.id, name: r.name, cat: r.cat, price: +r.price, desc: r.descr || '', image: r.image || '', available: r.available !== false });
  const mapS = r => ({ whatsapp: r.whatsapp, instagram: r.instagram, currency: r.currency, heroTitle: r.hero_title, heroText: r.hero_text });

  /* أي طلب يرجع 401/403 يعني انتهت الجلسة أو الحساب ليس المالك */
  async function guard(fn) {
    try { return await fn(); }
    catch (e) {
      if (e.status === 401 || e.status === 403) { await SB.logout(); closePanel(); openLogin(); say('سجّل الدخول من جديد'); }
      throw e;
    }
  }

  /* ---------- نافذة الدخول ---------- */
  const back = document.createElement('div');
  back.className = 'o-back';
  back.innerHTML = `
    <form class="o-box" id="oLogin" autocomplete="on">
      <h2>دخول المالك</h2>
      <div class="sub">هذه المنطقة خاصة بصاحب المحل فقط</div>
      <label class="o-field">البريد الإلكتروني<input id="oUser" name="email" type="email" autocomplete="username" required dir="ltr"></label>
      <label class="o-field">كلمة المرور<input id="oPass" name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
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
      await SB.login($o('oUser').value, $o('oPass').value);
      const ok = await SB.rpc('is_owner');
      if (ok !== true) { await SB.logout(); throw new Error('هذا الحساب ليس حساب المالك'); }
      $o('oPass').value = ''; closeLogin(); openPanel();
    } catch (err) { $o('oErr').textContent = err.message; }
    b.disabled = false;
  });

  /* ---------- زر المالك ---------- */
  document.getElementById('ownerBtn').addEventListener('click', () => {
    if (typeof ONLINE !== 'undefined' && !ONLINE) return say('اربط قاعدة البيانات أولاً (ملف config.js)');
    SB.loggedIn() ? openPanel() : openLogin();
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
  $o('oOut').onclick = async () => { await SB.logout(); closePanel(); say('تم تسجيل الخروج'); };

  async function openPanel() {
    panel.classList.add('open'); document.body.style.overflow = 'hidden';
    editing = null;
    try {
      const [s, p, o] = await guard(() => Promise.all([
        SB.get('settings?id=eq.1&select=*'), SB.get('products?select=*&order=id.desc'), SB.get('orders?select=*&order=id.desc&limit=300')]));
      data.settings = mapS(s[0]); data.products = p.map(mapP); data.orders = o;
    } catch (e) { say(e.message); return; }
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
          <div class="th">${p.image ? `<img src="${E(SB.img(p.image))}" alt="">` : '💎'}</div>
          <div class="tx"><b>${E(p.name)}</b><small>${E(p.cat)} · ${money(p.price)}</small>
            <span class="o-tag ${p.available === false ? 'off' : 'on'}">${p.available === false ? 'نفد' : 'متوفر'}</span></div>
          <div class="act"><button class="o-btn ghost sm" data-e="${+p.id}">تعديل</button><button class="o-btn danger sm" data-d="${+p.id}">حذف</button></div>
        </div>`).join('') || '<div class="o-empty">لا توجد منتجات بعد. اضغط «إضافة منتج».</div>'}`;
    $o('oAdd').onclick = () => { editing = 0; pendingImage = ''; origImage = ''; render(); };
    $o('oBody').querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
      editing = +b.dataset.e; origImage = pendingImage = (data.products.find(p => p.id === editing) || {}).image || ''; render();
    });
    $o('oBody').querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
      const p = data.products.find(x => x.id === +b.dataset.d);
      if (!confirm('حذف «' + p.name + '» نهائياً؟')) return;
      try {
        await guard(() => SB.del('products?id=eq.' + p.id));
        SB.removeImage(p.image);
        data.products = data.products.filter(x => x.id !== p.id); render(); refreshStore(); say('تم الحذف');
      } catch (e) { say(e.message); }
    });
  }

  function viewProductForm() {
    const p = editing ? data.products.find(x => x.id === editing) : { name: '', cat: '', price: '', desc: '', available: true };
    const cats = [...new Set(data.products.map(x => x.cat))];
    $o('oBody').innerHTML = `
      <form class="o-form" id="pForm">
        <h3 style="margin-top:14px">${editing ? 'تعديل منتج' : 'منتج جديد'}</h3>
        <div class="o-prev"><div class="th" id="pPrev">${pendingImage ? `<img src="${E(SB.img(pendingImage))}" alt="">` : '💎'}</div>
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
    const discardNew = () => { if (pendingImage && pendingImage !== origImage) SB.removeImage(pendingImage); };
    $o('pBack').onclick = () => { discardNew(); editing = null; render(); };
    $o('pPick').onclick = () => $o('pFile').click();
    $o('pClr').onclick = () => { discardNew(); pendingImage = ''; $o('pPrev').innerHTML = '💎'; };
    $o('pFile').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      $o('pUp').textContent = 'جاري رفع الصورة...'; $o('pErr').textContent = '';
      try {
        const blob = await shrink(f, 1100);
        const name = await guard(() => SB.upload(blob));
        discardNew(); pendingImage = name; $o('pPrev').innerHTML = `<img src="${E(SB.img(name))}" alt="">`; $o('pUp').textContent = 'تم رفع الصورة ✓';
      } catch (err) { $o('pUp').textContent = ''; $o('pErr').textContent = err.message; }
    };
    $o('pForm').onsubmit = async e => {
      e.preventDefault(); $o('pErr').textContent = '';
      const price = Math.round(Number($o('pPrice').value));
      if (!(price >= 0)) return ($o('pErr').textContent = 'السعر غير صحيح');
      $o('pSave').disabled = true;
      const body = { name: $o('pName').value.trim(), cat: $o('pCat').value.trim(), price, descr: $o('pDesc').value.trim(), image: pendingImage, available: $o('pAv').checked };
      try {
        const r = await guard(() => editing ? SB.patch('products?id=eq.' + editing, body) : SB.post('products', body));
        if (!r || !r[0]) throw new Error('تعذر الحفظ، تحقق من صلاحيتك');
        const saved = mapP(r[0]);
        if (editing && origImage && origImage !== saved.image) SB.removeImage(origImage);
        if (editing) data.products = data.products.map(x => x.id === editing ? saved : x); else data.products.unshift(saved);
        origImage = pendingImage; editing = null; render(); refreshStore(); say('تم الحفظ ✓');
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
      const items = Array.isArray(o.items) ? o.items : [];
      return `<div class="o-order">
        <header><b>طلب #${+o.id}</b><small>${E(new Date(o.created_at).toLocaleString('ar-IQ'))}</small></header>
        <div class="meta">👤 ${E(o.name)}<br>📞 <a href="tel:${E(ph)}">${E(o.phone)}</a> · <a target="_blank" rel="noopener" href="https://wa.me/${E(ph)}">واتساب</a><br>📍 ${E(o.address)}</div>
        <ul>${items.map(i => `<li>${E(i.name)} × ${+i.qty} — ${money(i.price * i.qty)}</li>`).join('')}</ul>
        <div class="o-total">المجموع: ${money(o.total)}</div>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap">
          <select data-s="${+o.id}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="o-btn danger sm" data-od="${+o.id}">حذف</button></div></div>`;
    }).join('')) || '<div class="o-empty">لا توجد طلبات بعد.</div>';
    $o('oBody').querySelectorAll('[data-s]').forEach(s => s.onchange = async () => {
      try { await guard(() => SB.patch('orders?id=eq.' + s.dataset.s, { status: s.value })); data.orders.find(o => o.id === +s.dataset.s).status = s.value; render(); say('تم تحديث الحالة'); }
      catch (e) { say(e.message); }
    });
    $o('oBody').querySelectorAll('[data-od]').forEach(b => b.onclick = async () => {
      if (!confirm('حذف هذا الطلب؟')) return;
      try { await guard(() => SB.del('orders?id=eq.' + b.dataset.od)); data.orders = data.orders.filter(o => o.id !== +b.dataset.od); render(); }
      catch (e) { say(e.message); }
    });
  }

  /* --- الإعدادات --- */
  function viewSettings() {
    const s = data.settings;
    $o('oBody').innerHTML = `
      <form class="o-form" id="sForm"><h3 style="margin-top:14px">إعدادات الموقع</h3>
        <label class="o-field">رقم الواتساب (صيغة دولية بدون + مثل 9647701234567)<input id="sWa" inputmode="numeric" dir="ltr" value="${E(s.whatsapp)}"></label>
        <label class="o-field">حساب الانستغرام (بدون @)<input id="sIg" dir="ltr" value="${E(s.instagram)}"></label>
        <label class="o-field">العملة<input id="sCur" maxlength="10" value="${E(s.currency)}"></label>
        <label class="o-field">العنوان الرئيسي<input id="sT" maxlength="80" value="${E(s.heroTitle)}"></label>
        <label class="o-field">النص تحت العنوان<textarea id="sD" rows="2" maxlength="300">${E(s.heroText)}</textarea></label>
        <div class="o-err" id="sErr"></div>
        <button class="o-btn gold full" type="submit">حفظ الإعدادات</button></form>`;
    $o('sForm').onsubmit = async e => {
      e.preventDefault(); $o('sErr').textContent = '';
      const wa = $o('sWa').value.replace(/\D/g, ''), ig = $o('sIg').value.trim().replace(/^@/, '');
      if (wa.length < 8 || wa.length > 15) return ($o('sErr').textContent = 'رقم الواتساب غير صحيح (صيغة دولية بدون +)');
      if (!/^[A-Za-z0-9._]{1,30}$/.test(ig)) return ($o('sErr').textContent = 'اسم حساب الانستغرام غير صحيح');
      try {
        const r = await guard(() => SB.patch('settings?id=eq.1', { whatsapp: wa, instagram: ig, currency: $o('sCur').value.trim() || 'د.ع', hero_title: $o('sT').value.trim(), hero_text: $o('sD').value.trim() }));
        if (!r || !r[0]) throw new Error('تعذر الحفظ، تحقق من صلاحيتك');
        data.settings = mapS(r[0]); refreshStore(); say('تم حفظ الإعدادات ✓');
      } catch (err) { $o('sErr').textContent = err.message; }
    };
  }

  /* --- الحساب --- */
  function viewAccount() {
    $o('oBody').innerHTML = `
      <form class="o-form" id="aForm"><h3 style="margin-top:14px">حساب المالك</h3>
        <div class="o-note">البريد المسجّل: <b dir="ltr">${E(SB.email())}</b><br>استخدم كلمة مرور قوية (8 أحرف أو أكثر) ولا تشاركها مع أحد.</div>
        <label class="o-field">كلمة المرور الحالية<input id="aC" type="password" autocomplete="current-password" required dir="ltr"></label>
        <label class="o-field">كلمة المرور الجديدة<input id="aN" type="password" autocomplete="new-password" minlength="8" required dir="ltr"></label>
        <div class="o-err" id="aErr"></div>
        <button class="o-btn gold full" type="submit">تغيير كلمة المرور</button></form>`;
    $o('aForm').onsubmit = async e => {
      e.preventDefault(); $o('aErr').textContent = '';
      try {
        await SB.login(SB.email(), $o('aC').value);
        await SB.changePassword($o('aN').value);
        $o('aForm').reset(); say('تم تغيير كلمة المرور ✓');
      } catch (err) { $o('aErr').textContent = err.message; }
    };
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLogin(); });
})();
