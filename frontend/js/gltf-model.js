// .glb 模型產生器（測試）：介面與參數化產生器相同（raycast / placePin / setHighlight / setPaint …），
// app.js 不需要知道模型從哪裡來。
//
// 對齊方式：依車長縮放、軸距中點為原點、輪胎貼地、x 向前、y 向上、z 向右（與參數化模型相同）。
// 部位辨識：點到的位置用參數化模型的映射換回「參考座標」，沿用資料庫的座標範圍（zone）對應；
// 輪胎、輪框、燈具、後照鏡等依材質或節點名稱對應到車項。
(function () {
  const AV = (window.AV = window.AV || {});
  const ACCENT = 0xf0a020;

  // 已知模型的設定（以 asset.extras.source 比對）。沒有比對到時用名稱猜測。
  const PROFILES = [{
    match: '619601e7800d418da5922c4fa7833f74',   // Sketchfab：2025 Tesla Model Y（BloxBloger）
    paint: ['Material_2125765635'],
    glass: ['glass_base', 'glass_roof_panorama'],
    lights: ['front_white_light', 'glass_headlight222', 'back_red_Light', 'red_plastic', 'material'],
    tires: ['Rubber_Rough'],
    materialParts: { glass_roof_panorama: 'roof', mirror: 'mirror', Rubber_Rough: 'tire', Rubber_Rough222: 'tire' },
    nodeParts: {
      Object_10: 'rim', Object_11: 'rim', Object_12: 'rim', Object_13: 'rim', Object_22: 'rim', Object_27: 'rim', Object_28: 'rim',
      Object_30: 'rim', Object_31: 'rim', Object_32: 'rim', Object_33: 'rim'
    }
  }];
  const GUESS = {
    paint: [], glass: [], lights: [], tires: [], materialParts: {}, nodeParts: {},
    isGlass: (m) => m.transparent || m.transmission > 0 || /glass|window/i.test(m.name),
    isLight: (m) => /light|lamp/i.test(m.name),
    isTire: (m) => /rubber|tire|tyre/i.test(m.name),
    isMirror: (m) => /mirror/i.test(m.name)
  };

  function profileFor(gltf) {
    const src = (((gltf.parser && gltf.parser.json.asset) || {}).extras || {}).source || '';
    return PROFILES.find((p) => src.includes(p.match)) || null;
  }

  /** 解析 .glb（ArrayBuffer）。需要先載入 THREE.GLTFLoader。 */
  AV.parseGlb = function (THREE, buffer) {
    return new Promise((resolve, reject) => {
      new THREE.GLTFLoader().parse(buffer, '', (gltf) => {
        const extras = ((gltf.parser && gltf.parser.json.asset) || {}).extras || {};
        resolve({ gltf, info: { title: extras.title || '', author: extras.author || '', license: extras.license || '', source: extras.source || '' } });
      }, (e) => reject(e instanceof Error ? e : new Error(String(e && e.message || e))));
    });
  };

  // 讓材質能依參考座標範圍上色（hover / 選取的車項）
  function addTint(mat, tint) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tint);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aRef;\nvarying vec3 vRef;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRef = aRef;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRef;
uniform vec3 uHMin, uHMax, uH2Min, uH2Max, uSMin, uSMax, uS2Min, uS2Max, uTint;
uniform float uHOn, uSOn;
bool avIn(vec3 p, vec3 a, vec3 b) { return all(greaterThanEqual(p, a)) && all(lessThanEqual(p, b)); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float avHl = 0.0;
if (uHOn > 0.5 && (avIn(vRef, uHMin, uHMax) || avIn(vRef, uH2Min, uH2Max))) avHl = 0.3;
if (uSOn > 0.5 && (avIn(vRef, uSMin, uSMax) || avIn(vRef, uS2Min, uS2Max))) avHl = 0.6;
totalEmissiveRadiance += uTint * avHl;`);
    };
    mat.customProgramCacheKey = () => 'av-zone-tint';
  }

  AV.generators = AV.generators || {};
  AV.generators['gltf@1'] = function build({ THREE, gltf, params, spec, mappings }) {
    const kit = AV.parametricKit;
    const map = kit.mappingFor(THREE, params, spec);
    const P = profileFor(gltf) || GUESS;
    const has = (list, name) => list.includes(name);

    const group = new THREE.Group();
    const root = new THREE.Group();
    const model = gltf.scene.clone(true);
    root.add(model); group.add(root);
    const disposables = [];

    // ---- 方向：長軸轉到 x；頭燈那一側朝 +x ---------------------------------
    group.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    let size = box.getSize(new THREE.Vector3());
    if (size.z > size.x) { model.rotation.y = Math.PI / 2; group.updateMatrixWorld(true); }
    const centerOf = (test) => {
      const c = new THREE.Vector3(); let n = 0;
      model.traverse((o) => { if (o.isMesh && test(o)) { c.add(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); n++; } });
      return n ? c.divideScalar(n) : null;
    };
    box = new THREE.Box3().setFromObject(root);
    const front = centerOf((o) => /front|head/i.test(o.material.name));
    if (front && front.x < box.getCenter(new THREE.Vector3()).x) { model.rotation.y += Math.PI; group.updateMatrixWorld(true); }

    // ---- 縮放與位置：車長對齊規格、軸距中點為原點、輪胎貼地 ------------------
    box = new THREE.Box3().setFromObject(root); size = box.getSize(new THREE.Vector3());
    const k = spec.lengthMm / 1000 / size.x;
    root.scale.setScalar(k); group.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    const isTire = (o) => (P.tires.length ? has(P.tires, o.material.name) : GUESS.isTire(o.material));
    const wheels = [];
    model.traverse((o) => { if (o.isMesh && isTire(o)) wheels.push(new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3())); });
    const cx = box.getCenter(new THREE.Vector3()).x;
    const fw = wheels.filter((w) => w.x > cx), rw = wheels.filter((w) => w.x <= cx);
    const avgX = (ws) => ws.reduce((s, w) => s + w.x, 0) / ws.length;
    const mid = fw.length && rw.length ? (avgX(fw) + avgX(rw)) / 2 : cx;
    root.position.set(-mid, -box.min.y, -box.getCenter(new THREE.Vector3()).z);
    group.updateMatrixWorld(true);

    // ---- 材質、部位、參考座標 ----------------------------------------------
    const tint = { body: kit.makeTint(THREE, null), glass: kit.makeTint(THREE, null) };
    const pickables = [], paintMats = [], meshParts = {};
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const src = o.material;
      const mat = src.clone(); o.material = mat; disposables.push(mat);
      const name = src.name || '';
      o.castShadow = true; o.receiveShadow = true;
      const glass = P.glass.length ? has(P.glass, name) : GUESS.isGlass(src);
      const light = P.lights.length ? has(P.lights, name) : GUESS.isLight(src);
      let part = P.nodeParts[o.name] || P.materialParts[name] ||
        (!P.tires.length && GUESS.isTire(src) ? 'tire' : null) || (!P.paint.length && GUESS.isMirror(src) ? 'mirror' : null);
      o.userData.surface = glass ? 'glass' : 'body';
      o.userData.light = light && !part;
      if (part) {
        o.userData.part = part;
        o.userData.baseE = { c: mat.emissive ? mat.emissive.getHex() : 0, i: mat.emissiveIntensity || 0 };
        (meshParts[part] = meshParts[part] || []).push(o);
      } else if (!o.userData.light) {
        addTint(mat, tint[o.userData.surface]);
      }
      if (o.userData.light) o.userData.baseE = { c: mat.emissive ? mat.emissive.getHex() : 0, i: mat.emissiveIntensity || 0 };
      if (has(P.paint, name)) paintMats.push(mat);

      // 每個頂點的參考座標（著色器用來判斷落在哪個範圍）
      const geo = o.geometry, pos = geo.attributes.position;
      m4.multiplyMatrices(inv, o.matrixWorld);
      const ref = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m4);
        const r = map.inv(v); ref[i * 3] = r.x; ref[i * 3 + 1] = r.y; ref[i * 3 + 2] = r.z;
      }
      geo.setAttribute('aRef', new THREE.BufferAttribute(ref, 3));
      pickables.push(o);
    });
    // 沒有指定車漆材質時，用面積最大（外框最大）的不透明材質
    if (!paintMats.length) {
      let best = null, bv = 0;
      for (const o of pickables) {
        if (o.userData.surface !== 'body' || o.userData.part) continue;
        const s = new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3()), vol = s.x * s.y * s.z;
        if (vol > bv) { bv = vol; best = o; }
      }
      if (best) paintMats.push(best.material);
    }

    // ---- 部位範圍 ------------------------------------------------------------
    const zones = { body: [], glass: [] };
    for (const m of mappings) if (m.mappingType === 'zone') zones[m.zone.surface].push({ code: m.partCode, min: m.zone.min, max: m.zone.max, priority: m.priority });
    zones.body.sort((a, b) => a.priority - b.priority); zones.glass.sort((a, b) => a.priority - b.priority);
    const zoneByCode = {};
    for (const s of ['body', 'glass']) for (const z of zones[s]) (zoneByCode[z.code] = zoneByCode[z.code] || []).push({ ...z, surface: s });
    const classify = (surface, ref) => { const z = zones[surface].find((zz) => kit.inBox(ref, zz)); return z ? z.code : surface === 'body' ? 'body' : 'roof'; };
    const lightMeshes = pickables.filter((o) => o.userData.light);

    return {
      group, pickables, pivots: {}, map, openings: [],
      raycast(rc) {
        const h = rc.intersectObjects(pickables, false)[0];
        if (!h) return null;
        const o = h.object;
        const ref = map.inv(group.worldToLocal(h.point.clone()));
        const part = o.userData.part || (o.userData.light ? (ref.x > 0 ? 'lights-front' : 'lights-rear') : classify(o.userData.surface, ref));
        const n = h.face ? h.face.normal.clone().transformDirection(o.matrixWorld) : new THREE.Vector3(0, 1, 0);
        if (n.dot(rc.ray.direction) > 0) n.negate();
        const r = (x) => Math.round(x * 1e5) / 1e5;
        return { partCode: part, p: [r(ref.x), r(ref.y), r(ref.z)], n: [r(n.x), r(n.y), r(n.z)] };
      },
      blocked(rc) { return rc.intersectObjects(pickables, false).length > 0; },
      openingFor() { return null; },
      placePin(mesh, p, n) {
        mesh.position.copy(map.fwdArr(p).addScaledVector(new THREE.Vector3(...n), 0.012));
        group.add(mesh);
        return null;
      },
      setHighlight(hover, sel) {
        for (const u of Object.values(tint)) { u.uHOn.value = 0; u.uSOn.value = 0; }
        const glow = (ms, on) => {
          const b = ms.userData.baseE;
          if (on) { ms.material.emissive.setHex(ACCENT); ms.material.emissiveIntensity = Math.max(on, b.i ? 1 : 0); }
          else { ms.material.emissive.setHex(b.c); ms.material.emissiveIntensity = b.i; }
        };
        for (const [code, list] of Object.entries(meshParts)) for (const ms of list) glow(ms, code === sel ? 0.6 : code === hover ? 0.3 : 0);
        for (const ms of lightMeshes) {
          const c = new THREE.Box3().setFromObject(ms).getCenter(v).x > 0 ? 'lights-front' : 'lights-rear';
          glow(ms, c === sel ? 0.6 : c === hover ? 0.3 : 0);
        }
        for (const [slot, code] of [['H', hover], ['S', sel]]) {
          const zs = zoneByCode[code];
          if (!zs || code === 'body') continue;
          const [a, b = a] = zs;
          const u = tint[a.surface];
          u['u' + slot + 'Min'].value.fromArray(a.min); u['u' + slot + 'Max'].value.fromArray(a.max);
          u['u' + slot + '2Min'].value.fromArray(b.min); u['u' + slot + '2Max'].value.fromArray(b.max);
          u['u' + slot + 'On'].value = 1;
        }
      },
      setPaint(c) {
        for (const m of paintMats) { m.color.set(c.hex); m.metalness = +c.metalness; m.roughness = +c.roughness; }
      },
      setOpen() {}, isOpen() { return false; }, step() {},
      dispose() {
        if (group.parent) group.parent.remove(group);
        for (const d of disposables) d.dispose && d.dispose();
      }
    };
  };
})();
