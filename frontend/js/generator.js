// 參數化模型產生器：modely-juniper@1
// 讀取 /assets/{id} 的 params、部位對應、開啟件，以及 /trims/{id} 的規格與輪胎，
// 在「參考座標系」建好幾何後，依規格映射成實際尺寸（公尺）。
//
// 參考座標系：x 向前、軸距中點為原點、參考前後軸在 ±reference.axle_x；y 向上、地面 0；z 向右。
// 部位範圍、鉸鏈、標註位置都以參考座標記錄，所以切換版本後同一個標註仍落在同一部位。
(function () {
  const AV = (window.AV = window.AV || {});
  AV.generators = AV.generators || {};

  const ACCENT = 0xf0a020;
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const inBox = (p, b) => p.x >= b.min[0] && p.x <= b.max[0] && p.y >= b.min[1] && p.y <= b.max[1] && p.z >= b.min[2] && p.z <= b.max[2];

  function profileToShape(THREE, cmds) {
    const s = new THREE.Shape();
    for (const c of cmds) {
      switch (c[0]) {
        case 'M': s.moveTo(c[1], c[2]); break;
        case 'L': s.lineTo(c[1], c[2]); break;
        case 'Q': s.quadraticCurveTo(c[1], c[2], c[3], c[4]); break;
        case 'A': s.absarc(c[1], c[2], c[3], c[4], c[5], !!c[6]); break;
        default: throw new Error('未知的輪廓指令：' + c[0]);
      }
    }
    return s;
  }

  /** 擠出參考幾何並套用收窄，參考座標另存為 aRef 屬性。 */
  function refShell(THREE, conf) {
    const e = conf.extrude;
    let g = new THREE.ExtrudeGeometry(profileToShape(THREE, conf.profile), {
      depth: e.depth, bevelEnabled: true, bevelThickness: e.bevel_thickness, bevelSize: e.bevel_size,
      bevelSegments: e.bevel_segments, curveSegments: e.curve_segments
    });
    g.translate(0, 0, -e.depth / 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    if (THREE.BufferGeometryUtils) g = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      let k = 1;
      for (const t of conf.taper || []) k *= 1 - t.amount * ss(t.from, t.to, t.axis === 'x' ? x : t.axis === 'y' ? y : z);
      p.setXYZ(i, x, y, z * k);
    }
    g.setAttribute('aRef', new THREE.BufferAttribute(Float32Array.from(p.array), 3));
    g.computeBoundingBox();
    return g;
  }

  /** 參考座標 ↔ 實際尺寸。軸距固定、前後懸分開縮放、高度依離地高與車高線性映射。 */
  function makeMapping(THREE, bbox, params, spec) {
    const A = params.reference.axle_x;
    const half = spec.wheelbaseMm / 2000;
    const L = spec.lengthMm / 1000, WB = spec.wheelbaseMm / 1000;
    const ratio = params.front_overhang_ratio ?? 0.5;
    const fo = (L - WB) * ratio, ro = (L - WB) * (1 - ratio);
    const kf = fo / (bbox.max.x - A), kr = ro / (-A - bbox.min.x), km = half / A;
    const gc = spec.groundClearanceMm / 1000, H = spec.heightMm / 1000;
    const ky = (H - gc) / (bbox.max.y - bbox.min.y);
    const kz = (spec.widthMm / 2000) / Math.max(-bbox.min.z, bbox.max.z);
    const fx = (x) => x > A ? half + (x - A) * kf : x < -A ? -half + (x + A) * kr : x * km;
    const ix = (x) => x > half ? A + (x - half) / kf : x < -half ? -A + (x + half) / kr : x / km;
    const fy = (y) => gc + (y - bbox.min.y) * ky;
    const iy = (y) => bbox.min.y + (y - gc) / ky;
    return {
      fwd: (x, y, z) => new THREE.Vector3(fx(x), fy(y), z * kz),
      inv: (v) => new THREE.Vector3(ix(v.x), iy(v.y), v.z / kz),
      fwdArr: (a) => new THREE.Vector3(fx(a[0]), fy(a[1]), a[2] * kz),
      fx, fy, kz
    };
  }

  function applyMapping(g, map) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const v = map.fwd(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox(); g.computeBoundingSphere();
  }

  // 依部位範圍上色、切出開啟件，並以參考座標畫出鈑件分縫
  function makeTint(THREE, seams) {
    return {
      uHMin: { value: new THREE.Vector3() }, uHMax: { value: new THREE.Vector3() }, uHOn: { value: 0 },
      uSMin: { value: new THREE.Vector3() }, uSMax: { value: new THREE.Vector3() }, uSOn: { value: 0 },
      uH2Min: { value: new THREE.Vector3() }, uH2Max: { value: new THREE.Vector3() },
      uS2Min: { value: new THREE.Vector3() }, uS2Max: { value: new THREE.Vector3() },
      uTint: { value: new THREE.Color(ACCENT) },
      uSeam: { value: seams ? 1 : 0 },
      uDoorX: { value: new THREE.Vector3(...(seams ? seams.door_x : [99, 99, 99])) },
      uSeamA: { value: new THREE.Vector4(seams ? seams.hood_x : 99, seams ? seams.gate_x : 99, seams ? seams.side_z : 99, seams ? (seams.hood_y ?? 0.88) : 99) },
      uSeamY: { value: new THREE.Vector3(...(seams ? [seams.y_range[0], seams.y_range[1], seams.gate_y ?? 0.70] : [0, 0, 0])) }
    };
  }

  function shellMaterial(THREE, tint, surface, keep, cuts) {
    const m = surface === 'body'
      ? new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.6, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 });
    m.side = THREE.DoubleSide;
    const cmin = [], cmax = [];
    for (let i = 0; i < 8; i++) {
      const b = cuts && cuts[i];
      cmin.push(new THREE.Vector3(...(b ? b.min : [9, 9, 9])));
      cmax.push(new THREE.Vector3(...(b ? b.max : [-9, -9, -9])));
    }
    const own = {
      uMode: { value: keep ? 1 : 0 },
      uKMin: { value: new THREE.Vector3(...(keep ? keep.min : [0, 0, 0])) },
      uKMax: { value: new THREE.Vector3(...(keep ? keep.max : [0, 0, 0])) },
      uCMin: { value: cmin }, uCMax: { value: cmax }
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tint, own);
      sh.vertexShader = 'attribute vec3 aRef;\nvarying vec3 vLoc;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = aRef;');
      sh.fragmentShader = [
        'varying vec3 vLoc;',
        'uniform vec3 uHMin, uHMax, uSMin, uSMax, uH2Min, uH2Max, uS2Min, uS2Max, uTint, uKMin, uKMax, uDoorX, uSeamY;',
        'uniform vec4 uSeamA;',
        'uniform float uHOn, uSOn, uSeam, uMode;',
        'uniform vec3 uCMin[8];', 'uniform vec3 uCMax[8];',
        'float inBox(vec3 a, vec3 b){ vec3 s = step(a, vLoc) * step(vLoc, b); return s.x*s.y*s.z; }',
        'float line(float v, float at){ return 1.0 - smoothstep(0.0, 0.006, abs(v - at)); }',
        ''
      ].join('\n') + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
        if (uMode < 0.5) { for (int i = 0; i < 8; i++) { if (inBox(uCMin[i], uCMax[i]) > 0.5) discard; } }
        else if (inBox(uKMin, uKMax) < 0.5) discard;
        if (uSeam > 0.5) {
          float side = step(uSeamA.z, abs(vLoc.z)) * step(uSeamY.x, vLoc.y) * step(vLoc.y, uSeamY.y);
          float sm = max(max(line(vLoc.x, uDoorX.x), line(vLoc.x, uDoorX.y)), line(vLoc.x, uDoorX.z));
          float hood = line(vLoc.x, uSeamA.x) * step(uSeamA.w, vLoc.y) * step(abs(vLoc.z), uSeamA.z);
          float gate = line(vLoc.x, uSeamA.y) * step(uSeamY.z, vLoc.y);
          diffuseColor.rgb *= 1.0 - 0.75 * max(max(sm * side, hood), gate);
        }
        float h = uHOn * max(inBox(uHMin, uHMax), inBox(uH2Min, uH2Max));
        float s = uSOn * max(inBox(uSMin, uSMax), inBox(uS2Min, uS2Max));
        diffuseColor.rgb = mix(diffuseColor.rgb, uTint, max(s * 0.6, h * 0.32));
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.045);`);
    };
    return m;
  }

  AV.generators['modely-juniper@1'] = function build({ THREE, params, spec, tires, mappings, openings, variant }) {
    // 外觀版本：standard / premium / performance（由版本的 styleVariant 決定）
    const variants = params.variants || {};
    const V = variants[variant] || variants.premium || {};
    const group = new THREE.Group();
    const pickables = [];
    const disposables = [];
    const paintMats = [];
    const seatMats = [];   // 座椅材質，setInterior 換色
    const meshParts = {};      // partCode -> [mesh]
    const meshKeyToPart = {};
    const zones = { body: [], glass: [] };
    for (const m of mappings) {
      if (m.mappingType === 'zone') zones[m.zone.surface].push({ code: m.partCode, min: m.zone.min, max: m.zone.max, priority: m.priority });
      else meshKeyToPart[m.meshKey] = m.partCode;
    }
    zones.body.sort((a, b) => a.priority - b.priority);
    zones.glass.sort((a, b) => a.priority - b.priority);
    const zoneByCode = {};   // 車項 → 座標範圍（一個車項可有多個，例如車身玻璃 = 左右側窗）
    for (const s of ['body', 'glass']) for (const z of zones[s]) (zoneByCode[z.code] = zoneByCode[z.code] || []).push({ ...z, surface: s });

    // ---- 外殼：參考幾何 → 量測 → 映射 --------------------------------------
    const bodyGeo = refShell(THREE, params.body);
    const glassGeo = refShell(THREE, params.greenhouse);
    const bbox = bodyGeo.boundingBox.clone().union(glassGeo.boundingBox);
    const map = makeMapping(THREE, bbox, params, spec);
    applyMapping(bodyGeo, map); applyMapping(glassGeo, map);
    disposables.push(bodyGeo, glassGeo);

    const tint = { body: makeTint(THREE, params.seams), glass: makeTint(THREE, null) };
    const ops = openings.map((o) => ({ ...o }));
    const bodyCuts = ops.filter((o) => o.bodyRegion).map((o) => o.bodyRegion).concat([params.cabin_cuts.body]);
    const glassCuts = ops.filter((o) => o.glassRegion).map((o) => o.glassRegion).concat([params.cabin_cuts.glass]);
    if (bodyCuts.length > 8 || glassCuts.length > 8) console.warn('開啟件超過 8 個，著色器只會處理前 8 個。');

    function shell(geo, surface, keep, cuts) {
      const mat = shellMaterial(THREE, tint[surface], surface, keep, cuts);
      if (surface === 'body') paintMats.push(mat);
      disposables.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.userData.surface = surface;
      if (keep) m.userData.keep = keep; else m.userData.cuts = cuts;
      pickables.push(m);
      return m;
    }
    const body = shell(bodyGeo, 'body', null, bodyCuts); body.castShadow = body.receiveShadow = true; group.add(body);
    const glass = shell(glassGeo, 'glass', null, glassCuts); glass.castShadow = true; group.add(glass);

    // 開啟件：同一份外殼幾何，只保留自己的範圍，掛在鉸鏈上旋轉
    const pivots = {};
    for (const o of ops) {
      const hinge = map.fwdArr(o.hinge);
      const pv = new THREE.Group(); pv.position.copy(hinge);
      pv.userData.hinge = hinge;
      group.add(pv);
      if (o.bodyRegion) { const b = shell(bodyGeo, 'body', o.bodyRegion); b.position.copy(hinge).negate(); b.userData.pivot = pv; pv.add(b); }
      if (o.glassRegion) { const g = shell(glassGeo, 'glass', o.glassRegion); g.position.copy(hinge).negate(); g.userData.pivot = pv; pv.add(g); }
      pivots[o.code] = { def: o, obj: pv, cur: 0, target: 0, angle: (o.openAngleDeg * Math.PI) / 180 };
    }

    // ---- 獨立零件（以參考座標擺放）-----------------------------------------
    function partMesh(key, geo, mat, refPos, opts = {}) {
      const part = meshKeyToPart[key];
      const m = new THREE.Mesh(geo, mat);
      if (refPos) m.position.copy(map.fwdArr(refPos));
      m.castShadow = opts.shadow !== false;
      if (part) {
        m.userData.part = part;
        m.userData.baseE = { c: mat.emissive ? mat.emissive.getHex() : 0, i: mat.emissiveIntensity || 0 };
        (meshParts[part] = meshParts[part] || []).push(m);
        pickables.push(m);
      }
      disposables.push(geo, mat);
      return m;
    }
    const attachTo = (m, openingCode) => {
      const pv = pivots[openingCode];
      if (!pv) { group.add(m); return; }
      group.add(m); pv.obj.attach(m);
      m.traverse((o) => { o.userData.pivot = pv.obj; });   // 子物件也要知道自己跟著哪個開啟件
    };
    const openingOf = (key) => { const o = ops.find((x) => (x.meshKeys || []).includes(key)); return o ? o.code : null; };
    const box = (x, y, z) => new THREE.BoxGeometry(x, y, z);
    const std = (c, opt = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...opt });
    group.updateMatrixWorld(true);

    // ---- 貼合車身表面的燈具與飾條 -----------------------------------------
    // 從車外打射線到車身，取得表面點與法向量，零件就能順著車頭／車尾的弧度生成。
    const probe = new THREE.Raycaster();
    const DOWN = new THREE.Vector3(0, -1, 0);
    function hitBody(origin, dir) {
      probe.set(origin, dir);
      const h = probe.intersectObject(body, false)[0];
      if (!h) return null;
      const n = h.face.normal.clone();
      if (n.dot(dir) > 0) n.negate();
      return { p: h.point, n };
    }
    /** 車頭（end = 1）或車尾（end = -1）表面上，高度 y、左右 z0..z1 的曲線。 */
    function surfaceCurve(end, y, z0, z1, lift) {
      const pts = [], dir = new THREE.Vector3(-end, 0, 0);
      for (let i = 0; i <= 32; i++) {
        const h = hitBody(map.fwd(end * 4, y, z0 + ((z1 - z0) * i) / 32), dir);
        if (h) pts.push(h.p.addScaledVector(h.n, lift));
      }
      return pts.length >= 2 ? new THREE.CatmullRomCurve3(pts) : null;
    }
    /** 沿表面的管狀零件（燈條、進氣口），兩端加圓帽。 */
    function strip(key, end, conf, mat, mirror) {
      const ranges = mirror ? [[conf.z[0], conf.z[1]], [-conf.z[1], -conf.z[0]]] : [conf.z];
      const out = [];
      for (const [z0, z1] of ranges) {
        const curve = surfaceCurve(end, conf.y, z0, z1, conf.lift ?? conf.r * 0.35);
        if (!curve) continue;
        const g = new THREE.Group();
        g.add(partMesh(key, new THREE.TubeGeometry(curve, 48, conf.r, 10, false), mat));
        for (const t of [0, 1]) {
          const cap = partMesh(key, new THREE.SphereGeometry(conf.r, 10, 8), mat);
          cap.position.copy(curve.getPoint(t)); g.add(cap);
        }
        out.push(g);
      }
      return out;
    }
    {
      const L = params.lights || {};
      const lightW = () => std(0x000000, { emissive: 0xffffff, emissiveIntensity: 1.4 });
      const headMat = () => std(0x0b0d10, { emissive: 0xdfe8ff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.2 });
      const trimMat = () => std(0x111316, { roughness: 0.6, metalness: 0.15 });

      // 前燈條（Premium / Performance）：深色燈殼包住細發光條，淺色車漆上也看得到
      if (V.front_light_bar && L.front_bar) {
        const fb = L.front_bar;
        strip('lights-front', 1, fb, std(0x0b0c0e, { roughness: 0.3, metalness: 0.4 })).forEach((g) => group.add(g));
        strip('lights-front', 1, { ...fb, r: fb.r * 0.45, lift: fb.r * 0.95 }, lightW()).forEach((g) => group.add(g));
      }
      // 主頭燈：Standard 在引擎蓋前緣兩側；Premium / Performance 在前保桿兩側
      if (V.headlights) strip('lights-front', 1, V.headlights, headMat(), true).forEach((g) => group.add(g));
      // 前保桿進氣口與 Performance 導流口
      if (V.lower_intake) strip('front-bumper-trim', 1, V.lower_intake, trimMat()).forEach((g) => group.add(g));
      if (V.bumper_vents) strip('front-bumper-trim', 1, V.bumper_vents, trimMat(), true).forEach((g) => group.add(g));
      // 尾燈條（隨尾門開啟）
      if (L.rear_bar) {
        const rMat = std(0x200000, { emissive: 0xd0101a, emissiveIntensity: 1.2 });
        strip('lights-rear', -1, L.rear_bar, rMat).forEach((g) => attachTo(g, openingOf('lights-rear')));
      }
      // 後擴散器
      strip('rear-diffuser', -1, { y: 0.30, z: [-0.62, 0.62], r: 0.045 }, trimMat()).forEach((g) => group.add(g));
      // Performance 尾門擾流板
      if (V.rear_spoiler) {
        const sp = V.rear_spoiler;
        const h = hitBody(map.fwd(sp.x, 3, 0), DOWN);
        if (h) {
          const width = (sp.z[1] - sp.z[0]) * map.kz;
          const m = new THREE.Mesh(box(sp.chord, 0.022, width), std(0x16181b, { roughness: 0.35, metalness: 0.3 }));
          m.position.copy(h.p).addScaledVector(h.n, 0.016);
          m.rotation.z = Math.atan2(-h.n.x, h.n.y) - 0.12;   // 順著尾門斜面，尾端微翹
          m.castShadow = true; disposables.push(m.geometry, m.material);
          attachTo(m, 'tail');
        }
      }
    }

    // 後照鏡（隨前門開啟）
    for (const [key, side] of [['mirror-L', -1], ['mirror-R', 1]]) {
      const mat = new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.15, roughness: 0.32, clearcoat: 1 });
      paintMats.push(mat);
      const head = partMesh(key, new THREE.SphereGeometry(1, 28, 18), mat, [0.92, 1.06, side * 1.08]);
      head.scale.set(0.075, 0.06, 0.13);
      const stalk = partMesh(key, box(0.08, 0.035, 0.14), std(0x15171a, { roughness: 0.55 }), [0.95, 1.01, side * 0.97]);
      attachTo(head, openingOf(key)); attachTo(stalk, openingOf(key));
    }

    // 門把（隨車門開啟）與充電口：貼合車身側面
    {
      const F = params.fixtures || {};
      /** 從車側（side = -1 左、1 右）往內打射線，在車身側面放一個薄片零件。 */
      const onSide = (key, x, y, side, size, mat) => {
        const dir = new THREE.Vector3(0, 0, -side);
        const h = hitBody(map.fwd(x, y, side * 4), dir);
        if (!h) return null;
        const m = partMesh(key, box(size[0], size[1], size[2]), mat);
        m.position.copy(h.p).addScaledVector(h.n, size[2] * 0.3);
        m.rotation.y = Math.atan2(h.n.x, h.n.z);
        return m;
      };
      const dh = F.door_handles;
      if (dh) {
        for (const [key, x, side] of [['handle-FL', dh.front_x, -1], ['handle-FR', dh.front_x, 1],
                                      ['handle-RL', dh.rear_x, -1], ['handle-RR', dh.rear_x, 1]]) {
          const m = onSide(key, x, dh.y, side, [dh.length, 0.028, 0.018], std(0x15171a, { roughness: 0.4, metalness: 0.3 }));
          if (m) attachTo(m, openingOf(key));
        }
      }
      const cp = F.charge_port;
      if (cp) {
        const m = onSide('charge-port', cp.x, cp.y, cp.side, [cp.size[0], cp.size[1], 0.012], std(0x2a2d31, { roughness: 0.5 }));
        if (m) group.add(m);
      }
    }

    // 輪胎與輪框：依規格的輪胎尺寸與輪距生成
    const tireBy = Object.fromEntries(tires.map((t) => [t.axle, t]));
    // 點輪胎 → 輪胎；點輪框外圈與輪輻 → 輪框；點輪輻之間的底盤與中心蓋 → 節能蓋
    for (const [axle, xs, side] of [['front', 1, -1], ['front', 1, 1], ['rear', -1, -1], ['rear', -1, 1]]) {
      const t = tireBy[axle] || tires[0];
      const R = t.overallDiameterMm / 2000, hw = t.widthMm / 2000, rimR = (t.rimDiameterIn * 25.4) / 2000;
      const track = (axle === 'front' ? spec.frontTrackMm : spec.rearTrackMm) / 1000;
      const w = new THREE.Group();
      w.position.set(xs * spec.wheelbaseMm / 2000, R, side * track / 2);
      const tireMat = std(0x141518, { roughness: 0.88 });
      const wheelV = V.wheel || {};
      const rimMat = std(wheelV.rim_color || 0x8e959c, { metalness: 0.35, roughness: 0.45 });
      const darkMat = std(0x1c1f23, { metalness: 0.2, roughness: 0.55 });
      const prof = [[rimR, -hw], [R - 0.042, -hw * 1.01], [R - 0.012, -hw * 0.92], [R, -hw * 0.64], [R, hw * 0.64], [R - 0.012, hw * 0.92], [R - 0.042, hw * 1.01], [rimR, hw]]
        .map((p) => new THREE.Vector2(p[0], p[1]));
      const tire = partMesh('tire', new THREE.LatheGeometry(prof, 64), tireMat); tire.rotation.x = Math.PI / 2; w.add(tire);
      const disc = partMesh('aero-cover', new THREE.CylinderGeometry(rimR + 0.001, rimR + 0.001, 0.04, 48), darkMat, null);
      disc.position.z = side * (hw - 0.05); disc.rotation.x = Math.PI / 2; w.add(disc);
      const lip = partMesh('rim', new THREE.TorusGeometry(rimR - 0.01, 0.012, 8, 64), rimMat, null); lip.position.z = side * (hw - 0.025); w.add(lip);
      const spokes = wheelV.spokes || (t.rimDiameterIn >= 21 ? 10 : 5);
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        const sp = partMesh('rim', box(rimR * 0.82, spokes > 5 ? 0.026 : 0.05, 0.03), rimMat, null);
        sp.position.set(Math.cos(a) * rimR * 0.52, Math.sin(a) * rimR * 0.52, side * (hw - 0.025)); sp.rotation.z = a; w.add(sp);
      }
      const hub = partMesh('aero-cover', new THREE.CylinderGeometry(0.055, 0.055, 0.04, 24), darkMat, null);
      hub.position.z = side * (hw - 0.015); hub.rotation.x = Math.PI / 2; w.add(hub);
      group.add(w);
    }

    // 車內：打開車門或前後廂後可見
    {
      const add = (key, geo, mat, pos, rot) => {
        const m = partMesh(key, geo, mat, pos, { shadow: false });
        if (rot) { m.rotation.order = 'ZYX'; m.rotation.set(rot[0], rot[1], rot[2]); }
        group.add(m); return m;
      };
      const seat = () => { const m = std(0x2c2f34); seatMats.push(m); return m; };
      add('floor', box(3.0, 0.06, 1.6 * map.kz), std(0x17191c), [-0.45, 0.34, 0]);
      for (const z of [-0.38, 0.38]) {
        add('seat-front', box(0.5, 0.14, 0.5), seat(), [0.18, 0.5, z]);
        add('front-seatback', box(0.14, 0.62, 0.48), seat(), [-0.14, 0.86, z], [0, 0, 0.2]);
        add('seat-front', box(0.1, 0.18, 0.28), seat(), [-0.24, 1.26, z], [0, 0, 0.2]);
      }
      add('seat-rear', box(0.5, 0.14, 1.4), seat(), [-0.85, 0.5, 0]);
      add('rear-seatback', box(0.14, 0.6, 1.4), seat(), [-1.17, 0.86, 0], [0, 0, 0.25]);
      for (const z of [-0.45, 0, 0.45]) add('seat-rear', box(0.09, 0.15, 0.26), seat(), [-1.27, 1.24, z], [0, 0, 0.25]);
      add('console', box(0.75, 0.22, 0.22), std(0x202327), [0.3, 0.5, 0]);
      add('dash', box(0.45, 0.22, 1.55 * map.kz), std(0x1f2226), [0.92, 0.86, 0]);
      add('screen', box(0.025, 0.24, 0.38), std(0x0a0c0f, { emissive: 0x2a4a6a, emissiveIntensity: 0.9, roughness: 0.2 }), [0.66, 1.08, 0], [0, 0, 0.15]);
      add('rear-screen', box(0.02, 0.11, 0.17), std(0x0a0c0f, { emissive: 0x2a4a6a, emissiveIntensity: 0.9, roughness: 0.2 }), [-0.09, 0.66, 0], [0, 0, -0.2]);
      add('steer', new THREE.TorusGeometry(0.16, 0.022, 10, 40), std(0x18191c), [0.58, 0.98, -0.38], [0, Math.PI / 2, 0.35]);
      add('frunk-tub', box(0.85, 0.28, 1.25), std(0x1d2024), [1.62, 0.5, 0]);
      add('trunk', box(0.95, 0.06, 1.5), std(0x1a1c1f), [-1.85, 0.56, 0]);
      for (const [key, z] of [['trunk-pocket-L', -0.70], ['trunk-pocket-R', 0.70]]) {
        add(key, box(0.42, 0.18, 0.08), std(0x1d2024), [-1.80, 0.68, z]);
      }
    }

    // ---- 查詢 -------------------------------------------------------------
    const qInv = new THREE.Quaternion();
    function closedRef(o, point) {
      const pv = o.userData.pivot;
      const closed = pv ? pv.worldToLocal(point.clone()).add(pv.userData.hinge) : group.worldToLocal(point.clone());
      return map.inv(closed);
    }
    function validHits(hits) {
      const out = [];
      for (const h of hits) {
        const o = h.object;
        if (!o.userData.keep && !o.userData.cuts && !o.userData.part) continue;
        const ref = closedRef(o, h.point);
        if (o.userData.keep && !inBox(ref, o.userData.keep)) continue;
        if (o.userData.cuts && o.userData.cuts.some((b) => inBox(ref, b))) continue;
        out.push({ h, o, ref });
      }
      return out;
    }
    function classify(surface, ref) {
      const z = zones[surface].find((zz) => inBox(ref, zz));
      return z ? z.code : surface === 'body' ? 'body' : 'roof';
    }
    /** 該部位（與點）由哪個開啟件帶動，沒有則為 null。 */
    function openingFor(partCode, refP) {
      const v = Array.isArray(refP) ? new THREE.Vector3(...refP) : refP;
      // 獨立零件：同一車項可能分屬不同開啟件（左右後照鏡），取鉸鏈最近的
      const carriers = ops.filter((o) => (o.meshKeys || []).some((k) => meshKeyToPart[k] === partCode));
      if (carriers.length === 1 || (carriers.length > 1 && !v)) return carriers[0].code;
      if (carriers.length > 1) {
        const d = (o) => v.distanceToSquared(new THREE.Vector3(...o.hinge));
        return carriers.reduce((a, b) => (d(b) < d(a) ? b : a)).code;
      }
      const zs = zoneByCode[partCode];
      if (!zs || !v) return null;
      for (const z of zs) {
        if (!inBox(v, z)) continue;
        const key = z.surface === 'body' ? 'bodyRegion' : 'glassRegion';
        const o = ops.find((x) => x[key] && inBox(v, x[key]));
        return o ? o.code : null;
      }
      return null;
    }

    return {
      group, pickables, pivots, map,
      openings: ops.map((o) => ({ code: o.code, name: o.name })),
      raycast(rc) {
        const v = validHits(rc.intersectObjects(pickables, false))[0];
        if (!v) return null;
        const { h, o, ref } = v;
        const part = o.userData.surface ? classify(o.userData.surface, ref) : o.userData.part;
        const n = h.face ? h.face.normal.clone().transformDirection(o.matrixWorld) : new THREE.Vector3(0, 1, 0);
        if (n.dot(rc.ray.direction) > 0) n.negate();
        if (o.userData.pivot) n.applyQuaternion(qInv.copy(o.userData.pivot.quaternion).invert());
        const r = (x) => Math.round(x * 1e5) / 1e5;
        return { partCode: part, p: [r(ref.x), r(ref.y), r(ref.z)], n: [r(n.x), r(n.y), r(n.z)] };
      },
      blocked(rc) { return validHits(rc.intersectObjects(pickables, false)).length > 0; },
      openingFor,
      /** 把標註點放到正確的父物件下（開啟件或車身）。 */
      placePin(mesh, p, n, partCode) {
        const pos = map.fwdArr(p).addScaledVector(new THREE.Vector3(...n), 0.012);
        const oc = openingFor(partCode, p);
        if (oc) { mesh.position.copy(pos).sub(pivots[oc].obj.userData.hinge); pivots[oc].obj.add(mesh); }
        else { mesh.position.copy(pos); group.add(mesh); }
        return oc ? pivots[oc].obj : null;
      },
      setHighlight(hover, sel) {
        for (const u of Object.values(tint)) { u.uHOn.value = 0; u.uSOn.value = 0; }
        for (const [code, list] of Object.entries(meshParts)) for (const ms of list) {
          const b = ms.userData.baseE, on = code === sel ? 0.6 : code === hover ? 0.3 : 0;
          if (on) { ms.material.emissive.setHex(ACCENT); ms.material.emissiveIntensity = Math.max(on, b.i ? 1 : 0); }
          else { ms.material.emissive.setHex(b.c); ms.material.emissiveIntensity = b.i; }
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
      setInterior(code) {   // 內裝顏色：black / white（座椅、椅背、頭枕）
        const s = { black: 0x2c2f34, white: 0xdcd9d2 }[code] || 0x2c2f34;
        for (const m of seatMats) m.color.setHex(s);
      },
      setPaint(c) {
        for (const m of paintMats) { m.color.set(c.hex); m.metalness = +c.metalness; m.roughness = +c.roughness; }
      },
      setOpen(code, open, instant) {
        const p = pivots[code]; if (!p) return;
        p.target = open ? 1 : 0; if (instant) p.cur = p.target;
      },
      isOpen(code) { return !!(pivots[code] && pivots[code].target); },
      step(dt) {
        const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        for (const p of Object.values(pivots)) {
          if (p.cur !== p.target) p.cur = p.target > p.cur ? Math.min(p.target, p.cur + dt * 1.3) : Math.max(p.target, p.cur - dt * 1.3);
          p.obj.rotation[p.def.axis] = p.angle * ease(p.cur);
        }
      },
      dispose() { if (group.parent) group.parent.remove(group); for (const d of disposables) d.dispose && d.dispose(); }
    };
  };
})();
