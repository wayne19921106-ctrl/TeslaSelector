// 3D 配件檢視器：介面、互動、與 API 同步
(function () {
  const $ = (s) => document.querySelector(s);
  const AV = window.AV;
  const I = AV.i18n;
  const t = (k, v) => I.t(k, v);
  const site = AV.site || { track() {}, adOn() { return false; }, init() {} };
  const ACCENT = 0xf0a020;
  const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // 選定產品後的狀態；null = 尚未購買
  const STATUS_KEYS = ['purchased', 'installed'];
  const statusName = (s) => t('status.' + (s || 'none'));

  const S = {
    client: null, catalog: null, generation: null, parts: {}, partList: [], trims: [],
    trimCache: {}, assetCache: {}, build: null, trim: null, asset: null, car: null,
    sel: null, hover: null, pending: null, busy: false, placeable: new Set(),
    brands: [], openForm: null,   // openForm：正在填自訂產品表單的配件 id
    tab: 'acc'
  };

  /* ---------- 名稱（依語系） ---------- */
  const partName = (code) => I.d('part', code, S.parts[code] ? S.parts[code].name : code);
  const groupName = (g) => I.d('partGroup', g, g);
  const typeName = (at) => (at.isCustom ? at.name : I.d('accType', at.name, at.name));
  const catName = (c) => (c ? I.d('accCategory', c.code, c.name) : '');
  const trimName = (tr) => I.d('trim', tr.code, tr.name);
  const trimShort = (tr) => I.d('trimShort', tr.code, tr.name);
  const paintName = (c) => I.d('paint', c.code, c.name);
  const openingName = (o) => I.d('opening', o.code, o.name);
  const genName = (g) => I.d('generation', g.code, g.name);

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
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  let blobMat;
  {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 2.5), blobMat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.002; scene.add(m);
  }
  // 深色背景下陰影要深一點才看得出來
  function applySceneTheme(eff) {
    const dark = eff === 'dark';
    groundMat.opacity = dark ? 0.45 : 0.2;
    blobMat.opacity = dark ? 1 : 0.85;
    renderer.toneMappingExposure = dark ? 1.12 : 1.05;
  }

  /* ---------- Data loading ---------- */
  async function getTrim(id) { return (S.trimCache[id] = S.trimCache[id] || (await S.client.trim(id))); }
  async function getAsset(id) { return (S.assetCache[id] = S.assetCache[id] || (await S.client.asset(id))); }

  async function loadTrim(trimId) {
    const trim = await getTrim(trimId);
    const summary = trim.assets.find((a) => a.assetType === 'parametric' && a.tier === 'free');
    if (!summary) throw new Error(t('err.noFree'));
    const asset = await getAsset(summary.id);
    const gen = AV.generators[asset.generator];
    if (!gen) throw new Error(t('err.generator', { g: asset.generator }));

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
      const tx = document.createElement('span'); tx.className = 't'; tx.textContent = accLabel(a);
      el.append(num, tx); el.title = partName(a.partCode) + ' · ' + accLabel(a);
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

  /* ---------- Panel: tabs & sheet ---------- */
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const panel = $('#panel');
  const sheetMq = matchMedia('(max-width: 1024px)');

  function setTab(name, focus) {
    S.tab = name;
    document.querySelectorAll('.tabs [role="tab"]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
      $('#pane-' + b.dataset.tab).hidden = !on;
      if (on && focus) b.focus();
    });
    $('#panes').scrollTop = 0;
  }
  const tabBtns = [...document.querySelectorAll('.tabs [role="tab"]')];
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => setTab(b.dataset.tab));
    b.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      setTab(tabBtns[(i + k + tabBtns.length) % tabBtns.length].dataset.tab, true);
    });
  });

  function setSheet(expanded) {
    panel.classList.toggle('expanded', expanded);
    const btn = $('#sheetBtn');
    btn.setAttribute('aria-expanded', expanded);
    btn.dataset.i18nAria = expanded ? 'sheet.collapse' : 'sheet.expand';
    btn.setAttribute('aria-label', t(btn.dataset.i18nAria));
  }
  {
    // 抽屜：點一下切換；往上拖展開、往下拖收合
    const btn = $('#sheetBtn'); let y0 = null, moved = false;
    btn.addEventListener('pointerdown', (e) => { y0 = e.clientY; moved = false; btn.setPointerCapture(e.pointerId); });
    btn.addEventListener('pointermove', (e) => {
      if (y0 == null) return;
      const dy = e.clientY - y0;
      if (Math.abs(dy) > 30) { moved = true; setSheet(dy < 0); y0 = null; }
    });
    btn.addEventListener('pointerup', () => { if (y0 != null && !moved) setSheet(!panel.classList.contains('expanded')); y0 = null; });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheet(!panel.classList.contains('expanded')); } });
    const reset = () => { if (!sheetMq.matches) setSheet(false); };
    sheetMq.addEventListener ? sheetMq.addEventListener('change', reset) : sheetMq.addListener(reset);
  }

  /* ---------- Panel content ---------- */
  function renderTrimSeg() {
    const box = $('#trimSeg'); box.textContent = '';
    for (const tr of S.trims) {
      const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'radio');
      const on = S.build && S.build.trimId === tr.id;
      b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1;
      b.textContent = trimShort(tr); b.title = trimName(tr);
      b.addEventListener('click', () => switchTrim(tr.id));
      b.addEventListener('keydown', (e) => {
        const k = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!k) return;
        e.preventDefault();
        const i = S.trims.indexOf(tr), next = S.trims[(i + k + S.trims.length) % S.trims.length];
        switchTrim(next.id).then(() => { const nb = box.children[S.trims.indexOf(next)]; if (nb) nb.focus(); });
      });
      box.appendChild(b);
    }
  }

  function renderTrim() {
    renderTrimSeg();
    const tr = S.trim, s = tr.specs;
    $('#genLabel').textContent = t('gen', { model: tr.generation.modelName, gen: genName(tr.generation), year: tr.modelYear, market: tr.market });
    $('#dimsLabel').textContent = t('spec.summary', { l: fmt(s.lengthMm), w: fmt(s.widthMirrorsFoldedMm), h: fmt(s.heightMm), wb: fmt(s.wheelbaseMm) });
    const tires = tr.tires.length === 2 && tr.tires[0].designation !== tr.tires[1].designation
      ? t('spec.tiresFR', { f: tr.tires[0].designation, r: tr.tires[1].designation }) : tr.tires[0].designation;
    const cells = [
      ['spec.length', fmt(s.lengthMm), 'mm'], ['spec.height', fmt(s.heightMm), 'mm'],
      ['spec.width', fmt(s.widthMm), 'mm'], ['spec.widthFolded', fmt(s.widthMirrorsFoldedMm), 'mm'],
      ['spec.wheelbase', fmt(s.wheelbaseMm), 'mm'], ['spec.clearance', fmt(s.groundClearanceMm), 'mm'],
      ['spec.track', `${fmt(s.frontTrackMm)}／${fmt(s.rearTrackMm)}`, 'mm'], ['spec.weight', fmt(s.curbWeightKg), 'kg']
    ];
    $('#specs').innerHTML = cells.map(([k, v, u]) => `<div class="spec"><dt>${t(k)}</dt><dd>${v}<small>${u}</small></dd></div>`).join('') +
      `<div class="spec wide"><dt>${t('spec.tires')}</dt><dd class="tire">${esc(tires)}</dd></div>`;
    const src = s.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>`).join(t('sep'));
    $('#specNote').innerHTML = s.verified
      ? t('spec.verified', { src })
      : `<span class="flag">${t('spec.unverifiedFlag')}</span>${t('spec.unverified', { src })}`;
  }

  function renderOpenings() {
    const box = $('#opens'); box.textContent = '';
    for (const o of S.car.openings) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tg';
      const open = S.car.isOpen(o.code);
      b.setAttribute('aria-pressed', open);
      b.innerHTML = `<span>${esc(openingName(o))}</span><span class="st">${open ? t('open') : t('closed')}</span>`;
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
      b.style.background = c.hex; b.title = paintName(c); b.setAttribute('aria-label', paintName(c));
      b.setAttribute('aria-pressed', c === cur);
      b.addEventListener('click', () => run(async () => {
        S.build = await S.client.updateBuild(S.build.id, { paintColorId: c.id });
        applyPaint(); renderSwatches();
        site.track('select_paint', { paint: c.code });
      }));
      box.appendChild(b);
    }
    $('#swname').textContent = cur ? paintName(cur) : '';
  }

  function renderPartSel() {
    const groups = [];
    for (const p of S.partList) {
      let g = groups.find((x) => x.name === p.category);
      if (!g) groups.push((g = { name: p.category, items: [] }));
      g.items.push(p);
    }
    $('#partSel').innerHTML = `<option value="">${esc(t('part.choose'))}</option>` + groups.map((g) =>
      `<optgroup label="${esc(groupName(g.name))}">${g.items.map((p) => `<option value="${esc(p.code)}">${esc(partName(p.code))}</option>`).join('')}</optgroup>`).join('');
    $('#partSel').value = S.sel || '';
  }

  /* ---------- Accessory helpers ---------- */
  const selectedOf = (a) => { const c = a.products.find((x) => x.isSelected); return c ? c.product : null; };
  const accLabel = (a) => { const p = selectedOf(a); return p ? `${typeName(a.accessoryType)} · ${p.displayName}` : typeName(a.accessoryType); };
  const stars = (n) => (n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '');
  const money = (n) => (n == null ? '' : 'NT$ ' + Number(n).toLocaleString('en-US'));
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  function productMeta(p) {
    return [p.model ? esc(t('p.model', { m: p.model })) : '', money(p.suggestedPriceTwd),
      p.rating ? `<span class="stars" aria-label="${esc(t('p.rating', { n: p.rating }))}">${stars(p.rating)}</span>` : '',
      p.source === 'custom' ? `<span class="tag">${t('custom')}</span>` : ''].filter(Boolean).join('<i>·</i>');
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
      : a.products.length ? esc(t('item.candidates', { n: a.products.length })) : esc(t('item.noProducts'));
    row.innerHTML = `<span class="num${a.position ? '' : ' off'}">${i + 1}</span>` +
      `<span class="t">${esc(typeName(a.accessoryType))}${a.accessoryType.isCustom ? `<span class="tag">${t('custom')}</span>` : ''}` +
      `${a.isExample ? `<span class="ex">${t('example')}</span>` : ''}<span class="meta${sp ? ' chosen' : ''}">${meta}</span></span>` +
      (a.status ? `<span class="badge" data-s="${a.status}">${statusName(a.status)}</span>` : '');
    const del = el('button', 'del', '×'); del.type = 'button';
    del.setAttribute('aria-label', t('del', { name: typeName(a.accessoryType) }));
    del.addEventListener('click', (e) => { e.stopPropagation(); removeAccessory(a); });
    row.appendChild(del);
    row.addEventListener('click', () => focusAcc(a));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === row) focusAcc(a); });
    return row;
  }

  /** 原生廣告卡片（贊助）：外觀與配件列相同，固定標示「贊助」。 */
  function sponsorRow() {
    const row = el('div', 'item sponsor');
    row.dataset.ad = 'native';
    row.setAttribute('aria-label', t('ad.sponsored'));
    row.innerHTML = `<span class="sp">${t('ad.sponsored')}</span><span class="t">${t('ad.slot')} · native</span>`;
    return row;
  }

  /** 車項下的一個配件：候選產品（單選、可清除）、加入產品、狀態。 */
  function accessoryCard(a) {
    const box = el('div', 'acc');
    const sp = selectedOf(a);
    const name = typeName(a.accessoryType);
    const head = el('div', 'acc-head',
      `<b>${esc(name)}</b>` +
      (a.accessoryType.category ? `<small>${esc(catName(a.accessoryType.category))}</small>` : '') +
      (a.accessoryType.isCustom ? `<span class="tag">${t('customAcc')}</span>` : ''));
    const del = el('button', 'del', '×'); del.type = 'button'; del.setAttribute('aria-label', t('delAcc', { name }));
    del.addEventListener('click', () => removeAccessory(a));
    head.appendChild(del);
    box.appendChild(head);

    // 候選產品：radio 單選，選中顯示綠色勾勾；再點一次已選的那筆可取消
    if (a.products.length) {
      const group = el('div', 'cands'); group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', t('products', { name }));
      for (const c of a.products) {
        const row = el('div', 'cand' + (c.isSelected ? ' on' : ''));
        const lab = el('label');
        const r = document.createElement('input'); r.type = 'radio'; r.name = 'sel-' + a.id; r.value = c.id; r.checked = c.isSelected;
        r.addEventListener('click', (e) => { e.preventDefault(); chooseCandidate(a, c, !c.isSelected); });
        lab.append(r, el('span', 'radio', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>'),
          el('span', 'pinfo', `<span class="pname">${esc(c.product.displayName)}</span>` +
            `<span class="pmeta">${productMeta(c.product)}</span>`));
        const rm = el('button', 'del', '×'); rm.type = 'button'; rm.setAttribute('aria-label', t('remove', { name: c.product.displayName }));
        rm.addEventListener('click', () => removeCandidate(a, c));
        row.append(lab, rm);
        group.appendChild(row);
      }
      box.appendChild(group);
    } else {
      box.appendChild(el('p', 'nopos', esc(t('noProducts'))));
    }

    // 選定後才出現狀態
    if (sp) {
      const st = el('div', 'statusrow');
      const sel = document.createElement('select'); sel.className = 'status'; sel.dataset.s = a.status || '';
      sel.setAttribute('aria-label', t('statusOf', { name }));
      sel.innerHTML = `<option value="">${statusName(null)}</option>` +
        STATUS_KEYS.map((k) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${statusName(k)}</option>`).join('');
      sel.addEventListener('change', () => setStatus(a, sel.value || null));
      const clr = el('button', 'link', esc(t('clearSel'))); clr.type = 'button';
      clr.addEventListener('click', () => chooseCandidate(a, a.products.find((x) => x.isSelected), false));
      st.append(el('span', 'label', esc(t('status'))), sel, clr);
      box.appendChild(st);
    }

    // 加入產品：內建選單或自訂
    const builtin = a.accessoryType.isCustom ? [] :
      (((S.parts[a.partCode] || {}).accessoryTypes || []).find((x) => x.id === a.accessoryType.id) || { products: [] }).products
        .filter((p) => !a.products.some((c) => c.product.id === p.id));
    const addRow = el('div', 'addrow');
    if (builtin.length) {
      const pick = document.createElement('select'); pick.className = 'addprod'; pick.setAttribute('aria-label', t('addProduct'));
      pick.innerHTML = `<option value="">${esc(t('addProduct.menu'))}</option>` + builtin.map((p) =>
        `<option value="${p.id}">${esc(p.displayName)}${p.suggestedPriceTwd != null ? '｜' + money(p.suggestedPriceTwd) : ''}${p.rating ? '｜' + stars(p.rating) : ''}</option>`).join('');
      pick.addEventListener('change', () => { if (pick.value) addCandidate(a, { productId: +pick.value, select: !a.products.length }); });
      addRow.appendChild(pick);
    }
    const custom = el('button', 'link', esc(S.openForm === a.id ? t('customProduct.cancel') : t('customProduct'))); custom.type = 'button';
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
      `<label for="${id('brand')}">${t('f.brand')}<input id="${id('brand')}" list="brandList" maxlength="60" autocomplete="off" placeholder="${esc(t('f.brandPh'))}"></label>` +
      `<label for="${id('name')}">${t('f.name')}<input id="${id('name')}" required maxlength="60" autocomplete="off"></label>` +
      `<label for="${id('model')}">${t('f.model')}<input id="${id('model')}" maxlength="60" autocomplete="off"></label>` +
      `<label for="${id('price')}">${t('f.price')}<input id="${id('price')}" type="number" min="0" step="100" inputmode="numeric" placeholder="NT$"></label>` +
      `<label for="${id('rating')}" class="wide">${t('f.rating')}<select id="${id('rating')}"><option value="">${t('f.noRating')}</option>` +
      [5, 4, 3, 2, 1].map((n) => `<option value="${n}">${stars(n)}　${t('f.stars', { n })}</option>`).join('') + `</select></label>` +
      `<div class="wide actions"><button class="btn" type="submit">${t('addProduct')}</button></div>`;
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
      c.innerHTML = `<p class="empty">${esc(t('sel.empty'))}</p>`;
      return null;
    }
    const p = S.parts[S.sel] || { name: S.sel, category: '', accessoryTypes: [] };
    c.appendChild(el('div', null, `<div class="cat">${esc(groupName(p.category))}</div><p class="partname">${esc(partName(S.sel))}</p>` +
      (S.placeable.has(S.sel) ? '' : `<p class="nopos">${esc(t('sel.nopos'))}</p>`)));

    const mine = S.build.accessories.filter((a) => a.partCode === S.sel);
    if (mine.length) {
      const list = el('div', 'step', `<div class="label">${t('sel.acc')}</div>`);
      mine.forEach((a) => list.appendChild(accessoryCard(a)));
      c.appendChild(list);
    }

    // 新增配件：內建配件或自訂配件
    const add = el('div', 'step', `<div class="label">${mine.length ? t('sel.addMore') : t('sel.add')}</div>`);
    const remaining = (p.accessoryTypes || []).filter((x) => !mine.some((a) => !a.accessoryType.isCustom && a.accessoryType.id === x.id));
    if (remaining.length) {
      const chips = el('div', 'chips');
      for (const x of remaining) {
        const b = el('button', 'chip', '+ ' + esc(typeName(x)) + (x.category ? ` <small>${esc(catName(x.category))}</small>` : '')); b.type = 'button';
        b.addEventListener('click', () => addAccessory({ accessoryTypeId: x.id }));
        chips.appendChild(b);
      }
      add.appendChild(chips);
    }
    const form = el('form', 'add',
      `<input id="accName" type="text" maxlength="40" autocomplete="off" placeholder="${esc(t('sel.customPh'))}" aria-label="${esc(t('sel.customAria'))}">` +
      `<button class="btn" type="submit">${t('sel.add')}</button>`);
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
    if (!acc.length) list.innerHTML = `<p class="empty">${esc(t('all.empty'))}</p>`;
    const groups = {};
    acc.forEach((a) => (groups[a.partCode] = groups[a.partCode] || []).push(a));
    const codes = Object.keys(groups);
    codes.forEach((code, gi) => {
      const g = el('div', 'group');
      const gh = el('button', 'gh', esc(partName(code))); gh.type = 'button';
      gh.addEventListener('click', () => focusAcc(groups[code][0]));
      g.appendChild(gh); groups[code].forEach((a) => g.appendChild(itemRow(a))); list.appendChild(g);
      // 原生廣告放在第二組之後（不足兩組時放在最後）
      if (site.adOn('native') && gi === Math.min(1, codes.length - 1)) list.appendChild(sponsorRow());
    });
    if (!codes.length && site.adOn('native')) list.appendChild(sponsorRow());
    frame = 0;
    return input;
  }

  /** 語系切換後重畫所有動態內容。 */
  function rerender() {
    if (!S.build) return;
    renderPartSel(); renderTrim(); renderOpenings(); renderSwatches(); renderAll();
    setSheet(panel.classList.contains('expanded'));
    renderThemeBtn();
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
      toast(t('t.added', { part: partName(a.partCode), acc: typeName(a.accessoryType) }));
      site.track('add_accessory', { part: a.partCode, accessory: a.accessoryType.name, custom: !!a.accessoryType.isCustom });
    });
  }
  async function removeAccessory(a) {
    await run(async () => {
      await S.client.deleteAccessory(S.build.id, a.id);
      S.build.accessories = S.build.accessories.filter((x) => x.id !== a.id);
      renderAll(); toast(t('t.deleted', { name: typeName(a.accessoryType) }));
    });
  }
  async function addCandidate(a, body) {
    await run(async () => {
      replaceAcc(await S.client.addCandidate(S.build.id, a.id, body));
      renderAll(); toast(t('t.productAdded'));
    });
  }
  async function chooseCandidate(a, c, on) {
    if (!c) return;
    await run(async () => {
      replaceAcc(await S.client.updateCandidate(S.build.id, a.id, c.id, { isSelected: on }));
      renderAll(); toast(on ? t('t.selected', { name: c.product.displayName }) : t('t.unselected'));
    });
  }
  async function removeCandidate(a, c) {
    await run(async () => {
      replaceAcc(await S.client.deleteCandidate(S.build.id, a.id, c.id));
      renderAll(); toast(t('t.removed', { name: c.product.displayName }));
    });
  }
  async function setStatus(a, status) {
    await run(async () => {
      replaceAcc(await S.client.updateAccessory(S.build.id, a.id, status ? { status } : { clear: ['status'] }));
      renderAll(); toast(t('t.status', { name: typeName(a.accessoryType), status: statusName(status) }));
    });
  }

  function select(code, pos) {
    if (code !== S.sel) S.openForm = null;
    S.sel = code; S.pending = pos;
    if (code) setTab('acc');
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
  /** 依畫面比例調整預設距離，窄畫面（手機直向）拉遠一點讓整台車入鏡。 */
  function homeDistance() {
    const base = HOME.distanceTo(controls.target);
    const byAspect = camera.aspect >= 1.2 ? 1 : 1.2 / Math.max(camera.aspect, 0.4);
    // 3D 區很矮時（手機底部抽屜打開），上下的說明與按鈕會佔掉畫面，再拉遠一些
    const byHeight = Math.max(1, 470 / Math.max(stage.clientHeight, 200));
    return Math.min(controls.maxDistance, base * Math.min(1.9, Math.max(byAspect, byHeight)));
  }
  document.querySelectorAll('.views button').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.v;
    if (v === 'reset') flyTo(HOME.clone().sub(controls.target), homeDistance());
    else { const dd = new THREE.Vector3(...VIEWS[v]); flyTo(dd, fitDistance(dd)); }
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
    toast(t(S.car.isOpen(oc) ? 't.opened' : 't.closed', { name: openingName(S.car.pivots[oc].def) }));
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
    tip.textContent = partName(code) + (oc ? t(S.car.isOpen(oc) ? 'tip.dbl.close' : 'tip.dbl.open', { name: openingName(S.car.pivots[oc].def) }) : '');
    tip.style.left = e.clientX - r.left + 'px'; tip.style.top = e.clientY - r.top + 'px';
  });
  canvas.addEventListener('pointerleave', () => { tip.hidden = true; if (S.hover && S.car) { S.hover = null; S.car.setHighlight(null, S.sel); } });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.sel && !['INPUT', 'SELECT'].includes(document.activeElement.tagName)) { S.sel = null; S.pending = null; renderAll(); }
  });

  /* ---------- Controls ---------- */
  async function switchTrim(trimId) {
    if (!S.build || trimId === S.build.trimId) return;
    await run(async () => {
      S.build = await S.client.updateBuild(S.build.id, { trimId });
      await loadTrim(trimId);
      renderAll();
      toast(t('t.trim', { name: trimName(S.trim) }));
      site.track('select_trim', { trim: S.trim.code });
    });
  }
  $('#openAll').addEventListener('click', () => { S.car.openings.forEach((o) => S.car.setOpen(o.code, true, REDUCE)); renderOpenings(); });
  $('#closeAll').addEventListener('click', () => { S.car.openings.forEach((o) => S.car.setOpen(o.code, false, REDUCE)); renderOpenings(); });
  $('#partSel').addEventListener('change', (e) => {
    const code = e.target.value;
    if (!code) { S.sel = null; S.pending = null; renderAll(); return; }
    select(code, null);
  });
  $('#copyBtn').addEventListener('click', () => {
    const acc = S.build.accessories;
    const head = `${S.trim.generation.modelName} ${trimName(S.trim)}（${S.trim.modelYear}）`;
    const rows = acc.map((a, i) => {
      const p = selectedOf(a) || {};
      return [i + 1, partName(a.partCode), typeName(a.accessoryType) + (a.accessoryType.isCustom ? t('copy.custom') : ''),
        catName(a.accessoryType.category),
        p.brandName || '', p.name || '', p.model || '', p.suggestedPriceTwd ?? '', p.rating ?? '',
        a.status ? statusName(a.status) : (p.name ? statusName(null) : t('status.unselected')), a.products.length].join('\t');
    });
    const tsv = [head, t('copy.head')].concat(rows).join('\n');
    const buf = $('#copyBuf');
    const fallback = () => { buf.value = tsv; buf.hidden = false; buf.focus(); buf.select(); toast(t('t.copyFallback')); };
    try { navigator.clipboard.writeText(tsv).then(() => { buf.hidden = true; toast(t('t.copied')); }, fallback); }
    catch (e) { fallback(); }
    site.track('copy_list', { count: acc.length });
  });

  // 語系
  $('#langBtn').addEventListener('click', () => {
    const next = I.lang === 'en' ? 'zh-Hant' : 'en';
    I.setLang(next);
    site.track('change_language', { language: next });
  });
  I.onChange(rerender);

  // 主題：自動 → 淺色 → 深色
  function renderThemeBtn() {
    const b = $('#themeBtn'); const m = AV.theme ? AV.theme.mode : 'auto';
    b.dataset.mode = m;
    const label = `${t('theme')}：${t('theme.' + m)}`.replace('Theme：', 'Theme: ');
    b.setAttribute('aria-label', label); b.title = label;
  }
  $('#themeBtn').addEventListener('click', () => {
    if (!AV.theme) return;
    AV.theme.cycle(); renderThemeBtn();
    site.track('change_theme', { theme: AV.theme.mode });
  });
  if (AV.theme) { AV.theme.onChange((eff) => applySceneTheme(eff)); applySceneTheme(AV.theme.effective); }
  renderThemeBtn();

  /* ---------- Helpers ---------- */
  let tt;
  function toast(msg, err) {
    const el2 = $('#toast'); el2.textContent = msg; el2.classList.toggle('err', !!err); el2.hidden = false;
    clearTimeout(tt); tt = setTimeout(() => (el2.hidden = true), err ? 4000 : 2200);
  }
  async function run(fn) {
    if (S.busy) return;
    S.busy = true; document.body.classList.add('busy');
    try { await fn(); }
    catch (e) { console.error(e); toast(e.message || t('err.generic'), true); }
    finally { S.busy = false; document.body.classList.remove('busy'); }
  }

  async function seedExamples() {
    // 前擋玻璃：內建配件「隔熱紙」，候選舒熱佳 LX（選定）與 XE；其他車項示範自訂配件
    const wind = (S.parts.windshield || {}).accessoryTypes || [];
    const film = wind.find((x) => x.name === '隔熱紙');
    const ex = [
      ['windshield', film ? { accessoryTypeId: film.id } : { customAccessoryName: typeName({ name: '隔熱紙' }) }, [3, 1.6, 0.2], [-2.3, -0.4, 0]],
      ['front-bumper', { customAccessoryName: t('ex.ppf') }, [5, 0.5, 0.3], [-1, 0, 0]],
      ['roof', { customAccessoryName: t('ex.shade') }, [-0.4, 5, 0.1], [0, -1, 0]],
      // 輪框外圈的高度依輪胎尺寸計算
      ['rim', { customAccessoryName: t('ex.rim') }, [S.trim.specs.wheelbaseMm / 2000,
        S.trim.tires[0].overallDiameterMm / 2000 + S.trim.tires[0].rimDiameterIn * 0.0127 - 0.01, -5], [0, 0, 1]],
      ['tailgate', { customAccessoryName: t('ex.spoiler') }, [-5, 0.9, 0], [1, 0, 0]]
    ];
    S.car.group.updateMatrixWorld(true);
    for (const [expect, choice, o, dd] of ex) {
      rc.set(new THREE.Vector3(...o), new THREE.Vector3(...dd).normalize());
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
  let lastAspect = 0;
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    // 直向窄畫面第一次載入時把相機拉遠
    if (!lastAspect && !fly) camera.position.copy(controls.target).add(HOME.clone().sub(controls.target).normalize().multiplyScalar(homeDistance()));
    lastAspect = camera.aspect;
  }
  new ResizeObserver(resize).observe(stage); resize();
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (S.car) S.car.step(dt);
    if (fly) {
      const k0 = Math.min(1, (now - fly.t0) / fly.dur), k = ease(k0);
      const a = fly.from.clone().sub(controls.target), b = fly.to.clone().sub(controls.target);
      const len = a.length() + (b.length() - a.length()) * k;
      camera.position.copy(controls.target).add(a.normalize().lerp(b.normalize(), k).normalize().multiplyScalar(len));
      if (k0 >= 1) fly = null;
    }
    controls.update();
    if (S.car) { S.car.group.updateMatrixWorld(); updateLabels(); }
    frame++;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // 開發用：在主控台以 AV.debug.state 檢視目前狀態
  AV.debug = { get state() { return S; }, camera, controls, hitAt, setTab, setSheet };

  /* ---------- Boot ---------- */
  const BUILD_KEY = (mode) => 'av.buildId.' + mode;
  async function boot() {
    I.apply();
    site.init();
    setTab(S.tab);
    S.client = await AV.createClient();
    $('#mode').hidden = S.client.mode !== 'mock';
    const [catalog, parts, brands] = await Promise.all([S.client.catalog(), S.client.parts(), S.client.brands()]);
    S.brands = brands;
    $('#brandList').innerHTML = brands.map((b) => `<option value="${esc(b.name)}">${esc(b.code)}</option>`).join('');
    S.catalog = catalog;
    S.partList = parts;
    parts.forEach((p) => (S.parts[p.code] = p));
    renderPartSel();
    const model = catalog.makes[0] && catalog.makes[0].models.find((m) => m.code === 'model-y');
    S.generation = model && model.generations[0];
    if (!S.generation || !S.generation.trims.length) throw new Error(t('err.noTrims'));
    S.trims = S.generation.trims;

    let build = null, id = null;
    try { id = localStorage.getItem(BUILD_KEY(S.client.mode)); } catch (e) { /* 無法使用 storage */ }
    if (id) {
      try { build = await S.client.getBuild(id); }
      catch (e) { if (e.status !== 404) throw e; }
    }
    let fresh = false;
    if (!build) {
      const tr = await getTrim(S.trims[0].id);
      build = await S.client.createBuild({ trimId: tr.id, paintColorId: tr.paintColors[0] ? tr.paintColors[0].id : null });
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
    $('#loading').innerHTML = `<p><strong>${esc(t('loadFail'))}</strong></p><p>${esc(e.message || e)}</p>`;
  });
})();
