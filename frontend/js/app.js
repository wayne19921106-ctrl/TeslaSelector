// 3D 配件檢視器：介面、互動、與 API 同步
(function () {
  const $ = (s) => document.querySelector(s);
  const AV = window.AV;
  const ACCENT = 0xf0a020;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 選定產品後的狀態；null = 尚未購買
  const STATUS = { purchased: '已購買', installed: '已安裝' };

  const S = {
    client: null, catalog: null, generation: null, parts: {}, trims: [],
    trimCache: {}, assetCache: {}, build: null, trim: null, asset: null, car: null,
    sel: null, hover: null, pending: null, busy: false, placeable: new Set(),
    brands: [], openForm: null   // openForm：正在填自訂產品表單的配件 id
  };

  /* ---------- Scene ---------- */
  const stage = $('#stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.insertBefore(renderer.domElement, stage.firstChild);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const HOME = new THREE.Vector3(6.4, 2.5, 5.0);
  camera.position.copy(HOME);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.72, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false; controls.minDistance = 3.6; controls.maxDistance = 13;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = !REDUCE; controls.autoRotateSpeed = 0.7;

  if (THREE.RoomEnvironment) {
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  }
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4450, 0.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 8, 4); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.2 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.002; scene.add(m);
  }

  /* ---------- Data loading ---------- */
  async function getTrim(id) { return (S.trimCache[id] = S.trimCache[id] || (await S.client.trim(id))); }
  async function getAsset(id) { return (S.assetCache[id] = S.assetCache[id] || (await S.client.asset(id))); }

  async function loadTrim(trimId) {
    const trim = await getTrim(trimId);
    const summary = trim.assets.find((a) => a.assetType === 'parametric' && a.tier === 'free');
    if (!summary) throw new Error('這個版本沒有可用的免費模型。');
    const asset = await getAsset(summary.id);
    const gen = AV.generators[asset.generator];
    if (!gen) throw new Error('前端不支援這個模型產生器：' + asset.generator);

    const openState = S.car ? Object.fromEntries(S.car.openings.map((o) => [o.code, S.car.isOpen(o.code)])) : {};
    if (S.car) S.car.dispose();
    S.car = gen({ THREE, params: asset.params, spec: trim.specs, tires: trim.tires, mappings: asset.partMappings, openings: asset.openings, variant: trim.styleVariant });
    scene.add(S.car.group);
    for (const [code, open] of Object.entries(openState)) S.car.setOpen(code, open, true);
    S.car.step(0);
    S.trim = trim; S.asset = asset;
    S.placeable = new Set(asset.partMappings.map((m) => m.partCode));   // 模型上點得到的車項
    controls.target.y = (trim.specs.heightMm / 1000) * 0.45;
    applyPaint();
    renderTrim(); renderOpenings(); renderSwatches();
  }

  function applyPaint() {
    if (!S.car || !S.trim) return;
    const colors = S.trim.paintColors;
    const c = colors.find((x) => x.id === S.build.paintColorId) || colors[0];
    if (c) S.car.setPaint(c);
  }

  /* ---------- Picking ---------- */
  const rc = new THREE.Raycaster(); const ndc = new THREE.Vector2();
  function hitAt(cx, cy) {
    if (!S.car) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    rc.setFromCamera(ndc, camera);
    return S.car.raycast(rc);
  }
  const partName = (code) => (S.parts[code] ? S.parts[code].name : code);

  /* ---------- Pins ---------- */
  const pinGeo = new THREE.SphereGeometry(0.03, 16, 12);
  const pinMat = new THREE.MeshBasicMaterial({ color: ACCENT });
  const labelsEl = $('#labels');
  let pinViews = [];
  function placed() { return S.build ? S.build.accessories.filter((a) => a.position) : []; }
  function buildPins() {
    pinViews.forEach((v) => v.mesh.parent && v.mesh.parent.remove(v.mesh));
    labelsEl.textContent = '';
    if (!S.car) { pinViews = []; return; }
    const list = S.build.accessories;
    pinViews = placed().map((a) => {
      const m = new THREE.Mesh(pinGeo, pinMat);
      const pv = S.car.placePin(m, a.position.p, a.position.n, a.partCode);
      const el = document.createElement('div'); el.className = 'pl' + (a.partCode === S.sel ? ' on' : '');
      const num = document.createElement('span'); num.className = 'num'; num.textContent = list.indexOf(a) + 1;
      const t = document.createElement('span'); t.className = 't'; t.textContent = accLabel(a);
      el.append(num, t); el.title = partName(a.partCode) + '：' + accLabel(a);
      el.addEventListener('click', () => focusAcc(a));
      labelsEl.appendChild(el);
      const p = new THREE.Vector3(...a.position.p);
      const stack = placed().slice(0, placed().indexOf(a)).filter((o) => new THREE.Vector3(...o.position.p).distanceTo(p) < 0.12).length;
      return { mesh: m, n: new THREE.Vector3(...a.position.n), pv, el, stack, occ: false };
    });
  }
  const wp = new THREE.Vector3(), wn = new THREE.Vector3(), toCam = new THREE.Vector3(), scr = new THREE.Vector3();
  let frame = 0;
  function updateLabels() {
    const w = stage.clientWidth, h = stage.clientHeight, check = frame % 8 === 0;
    for (const v of pinViews) {
      v.mesh.getWorldPosition(wp);
      wn.copy(v.n); if (v.pv) wn.applyQuaternion(v.pv.quaternion);
      toCam.copy(camera.position).sub(wp);
      const dist = toCam.length(); toCam.divideScalar(dist);
      if (check) {
        rc.set(camera.position, toCam.clone().negate()); rc.far = Math.max(0, dist - 0.05);
        v.occ = S.car.blocked(rc); rc.far = Infinity;
      }
      scr.copy(wp).project(camera);
      v.el.classList.toggle('back', v.occ || wn.dot(toCam) < 0.03);
      v.el.style.transform = `translate(${Math.round(((scr.x + 1) / 2) * w + 10)}px, ${Math.round(((1 - scr.y) / 2) * h - 12 - v.stack * 26)}px)`;
    }
  }

  /* ---------- Panel ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));

  function renderTrim() {
    const sel = $('#trimSel');
    sel.value = String(S.build.trimId);
    const t = S.trim, s = t.specs;
    $('#genLabel').textContent = `${t.generation.modelName} ${t.generation.name} · ${t.modelYear} 年式 · ${t.market}`;
    const tires = t.tires.length === 2 && t.tires[0].designation !== t.tires[1].designation
      ? `前 ${t.tires[0].designation}／後 ${t.tires[1].designation}` : t.tires[0].designation;
    const cells = [
      ['車長', fmt(s.lengthMm), 'mm'], ['車高', fmt(s.heightMm), 'mm'],
      ['車寬（不含後照鏡）', fmt(s.widthMm), 'mm'], ['車寬（後照鏡收折）', fmt(s.widthMirrorsFoldedMm), 'mm'],
      ['軸距', fmt(s.wheelbaseMm), 'mm'], ['離地高', fmt(s.groundClearanceMm), 'mm'],
      ['輪距 前／後', `${fmt(s.frontTrackMm)}／${fmt(s.rearTrackMm)}`, 'mm'], ['車重', fmt(s.curbWeightKg), 'kg']
    ];
    $('#specs').innerHTML = cells.map(([k, v, u]) => `<div class="spec"><dt>${k}</dt><dd>${v}<small>${u}</small></dd></div>`).join('') +
      `<div class="spec wide"><dt>輪胎</dt><dd class="tire">${esc(tires)}</dd></div>`;
    const src = s.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join('、');
    $('#specNote').innerHTML = s.verified
      ? `已與官網核對。資料來源：${src}`
      : `<span class="flag">待核對</span>尚未與 Tesla 官網逐項核對。資料來源：${src}`;
  }

  function renderOpenings() {
    const box = $('#opens'); box.textContent = '';
    for (const o of S.car.openings) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tg';
      const open = S.car.isOpen(o.code);
      b.setAttribute('aria-pressed', open);
      b.innerHTML = `<span>${esc(o.name)}</span><span class="st">${open ? '開啟' : '關閉'}</span>`;
      b.addEventListener('click', () => { S.car.setOpen(o.code, !S.car.isOpen(o.code), REDUCE); renderOpenings(); });
      box.appendChild(b);
    }
  }

  function renderSwatches() {
    const box = $('#swatches'); box.textContent = '';
    const colors = S.trim.paintColors;
    const cur = colors.find((c) => c.id === S.build.paintColorId) || colors[0];
    for (const c of colors) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sw';
      b.style.background = c.hex; b.title = c.name; b.setAttribute('aria-label', c.name);
      b.setAttribute('aria-pressed', c === cur);
      b.addEventListener('click', () => run(async () => {
        S.build = await S.client.updateBuild(S.build.id, { paintColorId: c.id });
        applyPaint(); renderSwatches();
      }));
      box.appendChild(b);
    }
    $('#swname').textContent = cur ? cur.name : '';
  }

  /* ---------- Accessory helpers ---------- */
  const selectedOf = (a) => { const c = a.products.find((x) => x.isSelected); return c ? c.product : null; };
  const accLabel = (a) => { const p = selectedOf(a); return p ? `${a.accessoryType.name} · ${p.displayName}` : a.accessoryType.name; };
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
  const money = (n) => (n == null ? '' : 'NT$ ' + Number(n).toLocaleString('en-US'));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function productMeta(p) {
    return [p.model ? `型號 ${esc(p.model)}` : '', money(p.suggestedPriceTwd),
      p.rating ? `<span class="stars" aria-label="推薦指數 ${p.rating}／5">${stars(p.rating)}</span>` : '',
      p.source === 'custom' ? '<span class="tag">自訂</span>' : ''].filter(Boolean).join('<i>·</i>');
  }
  function replaceAcc(updated) {
    const k = S.build.accessories.findIndex((x) => x.id === updated.id);
    if (k >= 0) S.build.accessories[k] = updated; else S.build.accessories.push(updated);
  }

  /** 全部配件清單中的一列。 */
  function itemRow(a) {
    const i = S.build.accessories.indexOf(a);
    const sp = selectedOf(a);
    const row = el('div', 'item'); row.tabIndex = 0;
    const meta = sp ? esc(sp.displayName)
      : a.products.length ? `尚未選定 · ${a.products.length} 個候選產品` : '尚未加入產品';
    row.innerHTML = `<span class="num${a.position ? '' : ' off'}">${i + 1}</span>` +
      `<span class="t">${esc(a.accessoryType.name)}${a.accessoryType.isCustom ? '<span class="tag">自訂</span>' : ''}` +
      `${a.isExample ? '<span class="ex">範例</span>' : ''}<span class="meta${sp ? ' chosen' : ''}">${meta}</span></span>` +
      (a.status ? `<span class="badge" data-s="${a.status}">${STATUS[a.status]}</span>` : '');
    const del = el('button', 'del', '×'); del.type = 'button';
    del.setAttribute('aria-label', '刪除 ' + a.accessoryType.name);
    del.addEventListener('click', (e) => { e.stopPropagation(); removeAccessory(a); });
    row.appendChild(del);
    row.addEventListener('click', () => focusAcc(a));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) focusAcc(a); });
    return row;
  }

  /** 車項下的一個配件：候選產品（單選、可清除）、加入產品、狀態。 */
  function accessoryCard(a) {
    const box = el('div', 'acc');
    const sp = selectedOf(a);
    const head = el('div', 'acc-head',
      `<b>${esc(a.accessoryType.name)}</b>` +
      (a.accessoryType.category ? `<small>${esc(a.accessoryType.category.name)}</small>` : '') +
      (a.accessoryType.isCustom ? '<span class="tag">自訂配件</span>' : ''));
    const del = el('button', 'del', '×'); del.type = 'button'; del.setAttribute('aria-label', '刪除配件 ' + a.accessoryType.name);
    del.addEventListener('click', () => removeAccessory(a));
    head.appendChild(del);
    box.appendChild(head);

    // 候選產品：radio 單選，選中顯示綠色勾勾；再點一次已選的那筆可取消
    if (a.products.length) {
      const group = el('div', 'cands'); group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', a.accessoryType.name + '的產品');
      for (const c of a.products) {
        const row = el('div', 'cand' + (c.isSelected ? ' on' : ''));
        const lab = el('label');
        const r = document.createElement('input'); r.type = 'radio'; r.name = 'sel-' + a.id; r.value = c.id; r.checked = c.isSelected;
        r.addEventListener('click', (e) => { e.preventDefault(); chooseCandidate(a, c, !c.isSelected); });
        lab.append(r, el('span', 'radio', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>'),
          el('span', 'pinfo', `<span class="pname">${esc(c.product.displayName)}</span>` +
            `<span class="pmeta">${productMeta(c.product)}</span>`));
        const rm = el('button', 'del', '×'); rm.type = 'button'; rm.setAttribute('aria-label', '移除 ' + c.product.displayName);
        rm.addEventListener('click', () => removeCandidate(a, c));
        row.append(lab, rm);
        group.appendChild(row);
      }
      box.appendChild(group);
    } else {
      box.appendChild(el('p', 'nopos', '還沒有產品。從下方選單加入，或新增自訂產品。'));
    }

    // 選定後才出現狀態
    if (sp) {
      const st = el('div', 'statusrow');
      const sel = document.createElement('select'); sel.className = 'status'; sel.dataset.s = a.status || '';
      sel.setAttribute('aria-label', a.accessoryType.name + ' 的狀態');
      sel.innerHTML = `<option value="">尚未購買</option>` +
        Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${v}</option>`).join('');
      sel.addEventListener('change', () => setStatus(a, sel.value || null));
      const clr = el('button', 'link', '取消選定'); clr.type = 'button';
      clr.addEventListener('click', () => chooseCandidate(a, a.products.find((x) => x.isSelected), false));
      st.append(el('span', 'label', '狀態'), sel, clr);
      box.appendChild(st);
    }

    // 加入產品：內建選單或自訂
    const builtin = a.accessoryType.isCustom ? [] :
      (((S.parts[a.partCode] || {}).accessoryTypes || []).find((t) => t.id === a.accessoryType.id) || { products: [] }).products
        .filter((p) => !a.products.some((c) => c.product.id === p.id));
    const addRow = el('div', 'addrow');
    if (builtin.length) {
      const pick = document.createElement('select'); pick.className = 'addprod'; pick.setAttribute('aria-label', '加入產品');
      pick.innerHTML = '<option value="">加入產品…</option>' + builtin.map((p) =>
        `<option value="${p.id}">${esc(p.displayName)}${p.suggestedPriceTwd != null ? '｜' + money(p.suggestedPriceTwd) : ''}${p.rating ? '｜' + stars(p.rating) : ''}</option>`).join('');
      pick.addEventListener('change', () => { if (pick.value) addCandidate(a, { productId: +pick.value, select: !a.products.length }); });
      addRow.appendChild(pick);
    }
    const custom = el('button', 'link', S.openForm === a.id ? '取消自訂產品' : '＋ 自訂產品'); custom.type = 'button';
    custom.addEventListener('click', () => { S.openForm = S.openForm === a.id ? null : a.id; renderSel(); });
    addRow.appendChild(custom);
    box.appendChild(addRow);
    if (S.openForm === a.id) box.appendChild(customProductForm(a));
    return box;
  }

  function customProductForm(a) {
    const f = el('form', 'cform');
    const id = (k) => `cp-${k}-${a.id}`;
    f.innerHTML =
      `<label for="${id('brand')}">品牌<input id="${id('brand')}" list="brandList" maxlength="60" autocomplete="off" placeholder="選擇或輸入"></label>` +
      `<label for="${id('name')}">名稱<input id="${id('name')}" required maxlength="60" autocomplete="off"></label>` +
      `<label for="${id('model')}">型號<input id="${id('model')}" maxlength="60" autocomplete="off"></label>` +
      `<label for="${id('price')}">建議售價<input id="${id('price')}" type="number" min="0" step="100" inputmode="numeric" placeholder="NT$"></label>` +
      `<label for="${id('rating')}" class="wide">推薦指數<select id="${id('rating')}"><option value="">不評分</option>` +
      [5, 4, 3, 2, 1].map((n) => `<option value="${n}">${stars(n)}　${n} 星</option>`).join('') + `</select></label>` +
      `<div class="wide actions"><button class="btn" type="submit">加入產品</button></div>`;
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = (k) => f.querySelector('#' + id(k)).value.trim();
      const brandText = v('brand');
      const brand = S.brands.find((b) => b.name === brandText || b.code.toLowerCase() === brandText.toLowerCase());
      const custom = {
        brandId: brand ? brand.id : undefined, brandName: !brand && brandText ? brandText : undefined,
        name: v('name'), model: v('model') || undefined,
        suggestedPriceTwd: v('price') === '' ? undefined : Number(v('price')),
        rating: v('rating') === '' ? undefined : Number(v('rating'))
      };
      if (!custom.name) return;
      S.openForm = null;
      addCandidate(a, { custom, select: !a.products.length });
    });
    return f;
  }

  function renderSel() {
    const c = $('#selCard'); c.textContent = ''; c.classList.toggle('active', !!S.sel);
    $('#partSel').value = S.sel || '';
    if (!S.sel) {
      c.innerHTML = '<p class="empty">點擊車上任一部位，或從上方清單選擇車項。打開車門或前後廂後，也能點選座椅、螢幕、行李箱等車內位置。</p>';
      return null;
    }
    const p = S.parts[S.sel] || { name: S.sel, category: '', accessoryTypes: [] };
    c.appendChild(el('div', null, `<div class="cat">${esc(p.category)}</div><p class="partname">${esc(p.name)}</p>` +
      (S.placeable.has(S.sel) ? '' : '<p class="nopos">這個車項在模型上沒有位置，配件只會列在清單中。</p>')));

    const mine = S.build.accessories.filter((a) => a.partCode === S.sel);
    if (mine.length) {
      const list = el('div', 'step', '<div class="label">配件</div>');
      mine.forEach((a) => list.appendChild(accessoryCard(a)));
      c.appendChild(list);
    }

    // 新增配件：內建配件或自訂配件
    const add = el('div', 'step', `<div class="label">${mine.length ? '再加一項配件' : '新增配件'}</div>`);
    const remaining = (p.accessoryTypes || []).filter((t) => !mine.some((a) => !a.accessoryType.isCustom && a.accessoryType.id === t.id));
    if (remaining.length) {
      const chips = el('div', 'chips');
      for (const t of remaining) {
        const b = el('button', 'chip', '+ ' + esc(t.name) + (t.category ? ` <small>${esc(t.category.name)}</small>` : '')); b.type = 'button';
        b.addEventListener('click', () => addAccessory({ accessoryTypeId: t.id }));
        chips.appendChild(b);
      }
      add.appendChild(chips);
    }
    const form = el('form', 'add',
      '<input id="accName" type="text" maxlength="40" autocomplete="off" placeholder="自訂配件名稱，例如雨刷" aria-label="自訂配件名稱">' +
      '<button class="btn" type="submit">新增配件</button>');
    form.addEventListener('submit', (e) => {
      e.preventDefault(); const v = form.querySelector('input').value.trim(); if (v) addAccessory({ customAccessoryName: v });
    });
    add.appendChild(form);
    c.appendChild(add);
    return form.querySelector('input');
  }

  function renderAll() {
    buildPins();
    if (S.car) S.car.setHighlight(S.hover, S.sel);
    const input = renderSel();
    const list = $('#allList'); list.textContent = '';
    const acc = S.build ? S.build.accessories : [];
    $('#total').textContent = acc.length;
    if (!acc.length) list.innerHTML = '<p class="empty">還沒有配件。點擊車身部位或選擇車項開始標註。</p>';
    const groups = {};
    acc.forEach((a) => (groups[a.partCode] = groups[a.partCode] || []).push(a));
    for (const code of Object.keys(groups)) {
      const g = el('div', 'group');
      const gh = el('button', 'gh', esc(partName(code))); gh.type = 'button';
      gh.addEventListener('click', () => focusAcc(groups[code][0]));
      g.appendChild(gh); groups[code].forEach((a) => g.appendChild(itemRow(a))); list.appendChild(g);
    }
    frame = 0;
    return input;
  }

  /* ---------- Accessory actions ---------- */
  /** 在目前車項加入配件：{ accessoryTypeId } 或 { customAccessoryName }。位置用點擊處或同車項既有配件的位置。 */
  async function addAccessory(choice) {
    if (!S.sel || S.busy) return;
    let pos = S.placeable.has(S.sel) ? S.pending : null;
    if (!pos && S.placeable.has(S.sel)) {
      const last = S.build.accessories.filter((a) => a.partCode === S.sel && a.position).pop(); pos = last ? last.position : null;
    }
    await run(async () => {
      const a = await S.client.addAccessory(S.build.id, { partCode: S.sel, assetId: S.asset.id, position: pos, ...choice });
      replaceAcc(a);
      renderAll();
      toast(`已在「${partName(a.partCode)}」加入「${a.accessoryType.name}」`);
    });
  }
  async function removeAccessory(a) {
    await run(async () => {
      await S.client.deleteAccessory(S.build.id, a.id);
      S.build.accessories = S.build.accessories.filter((x) => x.id !== a.id);
      renderAll(); toast('已刪除「' + a.accessoryType.name + '」');
    });
  }
  async function addCandidate(a, body) {
    await run(async () => {
      replaceAcc(await S.client.addCandidate(S.build.id, a.id, body));
      renderAll(); toast('已加入產品');
    });
  }
  async function chooseCandidate(a, c, on) {
    if (!c) return;
    await run(async () => {
      replaceAcc(await S.client.updateCandidate(S.build.id, a.id, c.id, { isSelected: on }));
      renderAll(); toast(on ? `已選定「${c.product.displayName}」` : '已取消選定');
    });
  }
  async function removeCandidate(a, c) {
    await run(async () => {
      replaceAcc(await S.client.deleteCandidate(S.build.id, a.id, c.id));
      renderAll(); toast('已移除「' + c.product.displayName + '」');
    });
  }
  async function setStatus(a, status) {
    await run(async () => {
      replaceAcc(await S.client.updateAccessory(S.build.id, a.id, status ? { status } : { clear: ['status'] }));
      renderAll(); toast(status ? `「${a.accessoryType.name}」改為${STATUS[status]}` : `「${a.accessoryType.name}」改為尚未購買`);
    });
  }

  function select(code, pos) {
    if (code !== S.sel) S.openForm = null;
    S.sel = code; S.pending = pos;
    renderAll();
  }
  function focusAcc(a) {
    select(a.partCode, a.position);
    if (!a.position) return;
    const dir = new THREE.Vector3(...a.position.n);
    const oc = S.car.openingFor(a.partCode, a.position.p);
    if (oc) dir.applyQuaternion(S.car.pivots[oc].obj.quaternion);
    dir.y = Math.max(dir.y, 0.25);
    flyTo(dir, 7);
  }

  /* ---------- Camera ---------- */
  let fly = null;
  function flyTo(dir, dist) {
    controls.autoRotate = false;
    const to = controls.target.clone().add(dir.clone().normalize().multiplyScalar(dist || camera.position.distanceTo(controls.target)));
    fly = { from: camera.position.clone(), to, t0: performance.now(), dur: REDUCE ? 1 : 750 };
  }
  const VIEWS = { front: [1, 0.22, 0.12], rear: [-1, 0.28, 0.12], left: [0.08, 0.2, -1], right: [0.08, 0.2, 1], top: [0.25, 1, 0.15] };
  /** 讓整台車（含開啟的車門）落在畫面內所需的距離。 */
  function fitDistance(dir) {
    const L = S.trim ? S.trim.specs.lengthMm / 1000 : 4.8;
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const side = Math.abs(dir.z) > Math.abs(dir.x);  // 側視時車長在水平方向
    const span = side ? L * 1.3 : L * 0.75;
    return Math.min(controls.maxDistance, Math.max(6.5, span / 2 / Math.tan(Math.min(hf, vf * 1.6) / 2)));
  }
  document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'reset') flyTo(HOME.clone().sub(controls.target), HOME.distanceTo(controls.target));
    else { const d = new THREE.Vector3(...VIEWS[v]); flyTo(d, fitDistance(d)); }
  }));

  /* ---------- Pointer ---------- */
  const tip = $('#tip'); let down = null;
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; controls.autoRotate = false; fly = null; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !S.build) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 6) return;
    const h = hitAt(e.clientX, e.clientY);
    if (h) select(h.partCode, { p: h.p, n: h.n });
    else { S.sel = null; S.pending = null; renderAll(); }
  });
  canvas.addEventListener('dblclick', (e) => {
    const h = hitAt(e.clientX, e.clientY); if (!h) return;
    const oc = S.car.openingFor(h.partCode, h.p);
    if (!oc) return;
    S.car.setOpen(oc, !S.car.isOpen(oc), REDUCE); renderOpenings();
    toast(S.car.pivots[oc].def.name + (S.car.isOpen(oc) ? '已開啟' : '已關閉'));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!S.car) return;
    if (e.pointerType !== 'mouse' || e.buttons) { if (S.hover) { S.hover = null; S.car.setHighlight(null, S.sel); } tip.hidden = true; return; }
    const h = hitAt(e.clientX, e.clientY);
    const code = h ? h.partCode : null;
    if (code !== S.hover) { S.hover = code; S.car.setHighlight(S.hover, S.sel); }
    if (!code) { tip.hidden = true; return; }
    const r = stage.getBoundingClientRect();
    const oc = S.car.openingFor(code, h.p);
    tip.hidden = false;
    tip.textContent = partName(code) + (oc ? ' · 雙擊' + (S.car.isOpen(oc) ? '關閉' : '開啟') + S.car.pivots[oc].def.name : '');
    tip.style.left = e.clientX - r.left + 'px'; tip.style.top = e.clientY - r.top + 'px';
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (S.hover && S.car) { S.hover = null; S.car.setHighlight(null, S.sel); } });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sel && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) { S.sel = null; S.pending = null; renderAll(); }
  });

  /* ---------- Controls in the panel ---------- */
  $('#trimSel').addEventListener('change', (e) => run(async () => {
    const trimId = +e.target.value;
    S.build = await S.client.updateBuild(S.build.id, { trimId });
    await loadTrim(trimId);
    renderAll();
    toast('已切換為 ' + S.trim.name);
  }));
  $('#openAll').addEventListener('click', () => { S.car.openings.forEach((o) => S.car.setOpen(o.code, true, REDUCE)); renderOpenings(); });
  $('#closeAll').addEventListener('click', () => { S.car.openings.forEach((o) => S.car.setOpen(o.code, false, REDUCE)); renderOpenings(); });
  $('#partSel').addEventListener('change', (e) => {
    const code = e.target.value;
    if (!code) { S.sel = null; S.pending = null; renderAll(); return; }
    select(code, null);
  });
  $('#copyBtn').addEventListener('click', () => {
    const acc = S.build.accessories;
    const head = `${S.trim.generation.modelName} ${S.trim.name}（${S.trim.modelYear}）`;
    const rows = acc.map((a, i) => {
      const p = selectedOf(a) || {};
      return [i + 1, partName(a.partCode), a.accessoryType.name + (a.accessoryType.isCustom ? '（自訂）' : ''),
        a.accessoryType.category ? a.accessoryType.category.name : '',
        p.brandName || '', p.name || '', p.model || '', p.suggestedPriceTwd ?? '', p.rating ?? '',
        a.status ? STATUS[a.status] : (p.name ? '尚未購買' : '尚未選定'), a.products.length].join('\t');
    });
    const tsv = [head, '編號\t車項\t配件\t分類\t品牌\t產品名稱\t型號\t建議售價\t推薦指數\t狀態\t候選產品數'].concat(rows).join('\n');
    const buf = $('#copyBuf');
    const fallback = () => { buf.value = tsv; buf.hidden = false; buf.focus(); buf.select(); toast('已選取清單，請按 Ctrl＋C 或長按複製'); };
    try { navigator.clipboard.writeText(tsv).then(() => { buf.hidden = true; toast('已複製，可直接貼到 Google Sheets'); }, fallback); }
    catch (e) { fallback(); }
  });

  /* ---------- Helpers ---------- */
  let tt;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.classList.toggle('err', !!err); t.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), err ? 4000 : 2200);
  }
  async function run(fn) {
    if (S.busy) return;
    S.busy = true; document.body.classList.add('busy');
    try { await fn(); }
    catch (e) { console.error(e); toast(e.message || '發生錯誤，請稍後再試。', true); }
    finally { S.busy = false; document.body.classList.remove('busy'); }
  }

  async function seedExamples() {
    // 前擋玻璃：內建配件「隔熱紙」，候選舒熱佳 LX（選定）與 XE；其他車項示範自訂配件
    const wind = (S.parts.windshield || {}).accessoryTypes || [];
    const film = wind.find((t) => t.name === '隔熱紙');
    const ex = [
      ['windshield', film ? { accessoryTypeId: film.id } : { customAccessoryName: '隔熱紙' }, [3, 1.6, 0.2], [-2.3, -0.4, 0]],
      ['front-bumper', { customAccessoryName: '犀牛皮 PPF' }, [5, 0.5, 0.3], [-1, 0, 0]],
      ['roof', { customAccessoryName: '天窗遮陽簾' }, [-0.4, 5, 0.1], [0, -1, 0]],
      // 輪框外圈的高度依輪胎尺寸計算
      ['rim', { customAccessoryName: '輪框保護圈' }, [S.trim.specs.wheelbaseMm / 2000,
        S.trim.tires[0].overallDiameterMm / 2000 + S.trim.tires[0].rimDiameterIn * 0.0127 - 0.01, -5], [0, 0, 1]],
      ['tailgate', { customAccessoryName: '尾翼' }, [-5, 0.9, 0], [1, 0, 0]]
    ];
    S.car.group.updateMatrixWorld(true);
    for (const [expect, choice, o, d] of ex) {
      rc.set(new THREE.Vector3(...o), new THREE.Vector3(...d).normalize());
      const h = S.car.raycast(rc);
      if (!h || h.partCode !== expect) continue;
      let a = await S.client.addAccessory(S.build.id, { partCode: h.partCode, ...choice, assetId: S.asset.id, position: { p: h.p, n: h.n }, isExample: true });
      if (film && choice.accessoryTypeId === film.id) {
        for (const [name, sel] of [['LX', true], ['XE', false]]) {
          const pr = film.products.find((x) => x.name === name);
          if (pr) a = await S.client.addCandidate(S.build.id, a.id, { productId: pr.id, select: sel });
        }
      }
      replaceAcc(a);
    }
  }

  /* ---------- Loop ---------- */
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(stage); resize();
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.car) S.car.step(dt);
    if (fly) {
      const t = Math.min(1, (now - fly.t0) / fly.dur), k = ease(t);
      const a = fly.from.clone().sub(controls.target), b = fly.to.clone().sub(controls.target);
      const len = a.length() + (b.length() - a.length()) * k;
      camera.position.copy(controls.target).add(a.normalize().lerp(b.normalize(), k).normalize().multiplyScalar(len));
      if (t >= 1) fly = null;
    }
    controls.update();
    if (S.car) { S.car.group.updateMatrixWorld(); updateLabels(); }
    frame++;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // 開發用：在主控台以 AV.debug.state 檢視目前狀態
  AV.debug = { get state() { return S; }, camera, controls, hitAt };

  /* ---------- Boot ---------- */
  const BUILD_KEY = (mode) => 'av.buildId.' + mode;
  async function boot() {
    S.client = await AV.createClient();
    $('#mode').hidden = S.client.mode !== 'mock';
    const [catalog, parts, brands] = await Promise.all([S.client.catalog(), S.client.parts(), S.client.brands()]);
    S.brands = brands;
    $('#brandList').innerHTML = brands.map((b) => `<option value="${esc(b.name)}">${esc(b.code)}</option>`).join('');
    S.catalog = catalog;
    parts.forEach((p) => (S.parts[p.code] = p));
    // 車項下拉：依分組列出
    const groups = [];
    for (const p of parts) {
      let g = groups.find((x) => x.name === p.category);
      if (!g) groups.push((g = { name: p.category, items: [] }));
      g.items.push(p);
    }
    $('#partSel').innerHTML = '<option value="">選擇車項…</option>' + groups.map((g) =>
      `<optgroup label="${esc(g.name)}">${g.items.map((p) => `<option value="${esc(p.code)}">${esc(p.name)}</option>`).join('')}</optgroup>`).join('');
    const model = catalog.makes[0] && catalog.makes[0].models.find((m) => m.code === 'model-y');
    S.generation = model && model.generations[0];
    if (!S.generation || !S.generation.trims.length) throw new Error('目錄中沒有可用的 Model Y 版本。');
    S.trims = S.generation.trims;
    $('#trimSel').innerHTML = S.trims.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');

    let build = null, id = null;
    try { id = localStorage.getItem(BUILD_KEY(S.client.mode)); } catch (e) { /* 無法使用 storage */ }
    if (id) {
      try { build = await S.client.getBuild(id); }
      catch (e) { if (e.status !== 404) throw e; }
    }
    let fresh = false;
    if (!build) {
      const t = await getTrim(S.trims[0].id);
      build = await S.client.createBuild({ trimId: t.id, paintColorId: t.paintColors[0] ? t.paintColors[0].id : null });
      try { localStorage.setItem(BUILD_KEY(S.client.mode), build.id); } catch (e) { /* 只在本次工作階段保留 */ }
      fresh = true;
    }
    S.build = build;
    await loadTrim(build.trimId);
    if (fresh) await seedExamples();
    $('#loading').hidden = true;
    renderAll();
  }
  boot().catch((e) => {
    console.error(e);
    $('#loading').innerHTML = `<p><strong>無法載入車型資料。</strong></p><p>${esc(e.message || e)}</p>`;
  });
})();
