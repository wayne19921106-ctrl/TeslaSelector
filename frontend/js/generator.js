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

  /** 空力輪框葉片：從半徑 r0 掃到 r1、掃角 sweepDeg、寬度約 width 的弧形片（輪面 XY 平面）。 */
  function aeroBlade(THREE, r0, r1, sweepDeg, width) {
    const sweep = (sweepDeg * Math.PI) / 180, N = 14, lead = [], trail = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, r = r0 + (r1 - r0) * t, a = sweep * t * (2 - t);   // 外圈掃得較平
      const wa = (width * (1 - 0.45 * t)) / r;                           // 往外漸細
      lead.push(new THREE.Vector2(r * Math.cos(a), r * Math.sin(a)));
      trail.push(new THREE.Vector2(r * Math.cos(a + wa), r * Math.sin(a + wa)));
    }
    return new THREE.Shape(lead.concat(trail.reverse()));
  }

  /** 收窄曲線：smooth（預設，S 形漸變）或 round（到 to 之前維持全寬，之後以圓弧收邊，用於車頭轉角）。 */
  function taperCurve(t, v) {
    if (t.shape !== 'round') return ss(t.from, t.to, v);
    const u = Math.min(1, Math.max(0, (v - t.from) / (t.to - t.from)));
    return 1 - Math.sqrt(1 - u * u);
  }

  /**
   * 擠出參考幾何並套用收窄與雕塑，參考座標另存為 aRef 屬性。
   * sculpt（選用，都以擠出寬度正規化的 zn = |z| / 半寬 計算）：
   *   sweep：車頭／車尾面在平面上往兩側後掠，w 在 x 介於 from..to 間由 0 漸變到 1；
   *          to > from（車頭）時 x -= amount·zn²·w，to < from（車尾）時 x += amount·zn²·w
   *   crest：葉子板稜線，y += amount·exp(-((zn - at) / width)²)，只作用在 x、y 範圍內的上表面
   *   bulge：輪拱外鼓，z ×= 1 + amount·exp(-((x - x0) / wx)² - ((y - y0) / wy)²)，x、y 為 [中心, 寬度]
   */
  function refShell(THREE, conf) {
    const e = conf.extrude;
    let g = new THREE.ExtrudeGeometry(profileToShape(THREE, conf.profile), {
      depth: e.depth, steps: e.steps || 1, bevelEnabled: true, bevelThickness: e.bevel_thickness, bevelSize: e.bevel_size,
      bevelSegments: e.bevel_segments, curveSegments: e.curve_segments
    });
    g.translate(0, 0, -e.depth / 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    if (THREE.BufferGeometryUtils) g = THREE.BufferGeometryUtils.mergeVertices(g, 1e-4);
    const p = g.attributes.position;
    const c = e.depth / 2 + e.bevel_thickness;   // 擠出半寬（端面所在的 |z|）
    const tapers = (conf.taper || []).filter((t) => t.axis !== 'z');
    const S = conf.sculpt || {};
    // 擠出座標 → 參考座標的完整變換
    /** 橫向縮放係數：收窄與輪拱外鼓。 */
    const kOf = (x, y) => {
      let k = 1;
      for (const t of tapers) k *= 1 - t.amount * taperCurve(t, t.axis === 'x' ? x : y);
      for (const b of S.bulge || []) {
        k *= 1 + b.amount * Math.exp(-(((x - b.x[0]) / b.x[1]) ** 2) - (((y - b.y[0]) / b.y[1]) ** 2));
      }
      return k;
    };
    const T = (x, y, z) => {
      const zn = Math.min(1, Math.abs(z) / c);
      const k = kOf(x, y);
      let X = x, Y = y;
      for (const s of S.sweep || []) X -= Math.sign(s.to - s.from) * s.amount * zn * zn * ss(s.from, s.to, x);
      for (const s of S.crest || []) {
        const w = ss(s.x[0], s.x[1], x) * (1 - ss(s.x[2], s.x[3], x)) * ss(s.y[0], s.y[1], y);
        if (w > 0) Y += s.amount * w * Math.exp(-(((zn - s.at) / s.width) ** 2));
      }
      return [X, Y, z * k];
    };
    // 側面（擠出的兩個端面）是一大片細長三角形，平滑法向量會把輪拱邊緣的傾斜帶進來，出現斜向亮紋。
    // 端面頂點改用曲面的精確法向量：端面 (x, y) ↦ T(x, y, ±c) 對 x、y 偏微分的外積。
    // 倒角從端面的切線方向開始，所以交界處不會出現折線。
    const capN = new Float32Array(p.count * 3), h = 1e-4;
    const zn = new Float32Array(p.count);   // 橫向位置（有正負號）：0 = 中央、±1 = 側面（端面），收窄前的正規化值
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      zn[i] = Math.max(-1, Math.min(1, z / c));
      if (Math.abs(Math.abs(z) - c) < 1e-5) {
        const s = Math.sign(z);
        const a1 = T(x + h, y, z), a0 = T(x - h, y, z), b1 = T(x, y + h, z), b0 = T(x, y - h, z);
        const dx = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]], dy = [b1[0] - b0[0], b1[1] - b0[1], b1[2] - b0[2]];
        capN.set([s * (dx[1] * dy[2] - dx[2] * dy[1]), s * (dx[2] * dy[0] - dx[0] * dy[2]), s * (dx[0] * dy[1] - dx[1] * dy[0])], i * 3);
      }
      const r = T(x, y, z);
      p.setXYZ(i, r[0], r[1], r[2]);
    }
    g.setAttribute('aRef', new THREE.BufferAttribute(Float32Array.from(p.array), 3));
    g.setAttribute('aZn', new THREE.BufferAttribute(zn, 1));
    g.userData.capNormals = capN;
    // 參考座標上的點在橫向的位置 |zn|。頂面與圓角精確（玻璃罩沒有 sweep / crest）；
    // 側面（端面）只有外框有頂點、內部是平面內插，算出來會略小於 1，要用三角形頂點判斷（見 znHit）
    g.userData.znOf = (r) => Math.min(1, Math.abs(r.z) / (c * kOf(r.x, r.y)));
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
    // 端面頂點：參考座標的法向量經映射（各軸縮放）後，以反轉置換算 = 各分量除以該軸的縮放率
    const capN = g.userData.capNormals, ref = g.attributes.aRef, nrm = g.attributes.normal;
    if (capN) {
      const ky = map.fy(1) - map.fy(0), v = new THREE.Vector3();
      for (let i = 0; i < nrm.count; i++) {
        const nz = capN[i * 3 + 2];
        if (!nz) continue;
        const x = ref.getX(i), dfx = (map.fx(x + 1e-4) - map.fx(x - 1e-4)) / 2e-4;
        v.set(capN[i * 3] / dfx, capN[i * 3 + 1] / ky, nz / map.kz).normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
      nrm.needsUpdate = true;
    }
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

  /**
   * 外殼表面細節：玻璃罩上的側窗開口、車柱、車頂縱樑與窗框；車身上的輪拱。都畫在著色器裡，
   * 所以車門、尾門開啟時會跟著動。glassRegion 是著色器判斷的 JS 版本（點選用），兩邊要一起改。
   *   greenhouse.detail：
   *     rail_zn  頂面橫向位置 zn 超過此值為車身色：A 柱、車頂縱樑、尾門兩側
   *     headers  頂面的車身色橫樑 [[x0, x1], ...]（最多 2 個）：前擋上緣、尾門鉸鏈處
   *     frits    頂面的黑色霧面橫帶 [[x0, x1], ...]（最多 2 個）：前擋與天窗交界的黑邊
   *     dlo      側面的車窗開口多邊形 [[x, y], ...]（最多 16 點），開口外為車身色
   *     frame    窗框飾條寬度
   *     pillars  開口內的黑色直柱 [[x0, x1], ...]（最多 2 個）：B 柱、後三角窗分隔
   *     belt_y   側面開口外、低於此高度的車身色屬於車門上緣，隨車門開啟
   * 開啟件在玻璃罩上帶走的範圍（moves）：車門只帶走側面的車窗與門上緣，A、C 柱留在車身；
   * 尾門只帶走頂面的玻璃與橫樑，兩側縱樑留在車身。
   *   body.detail.wheel_arch：{ y, r } 輪軸中心高度與輪拱飾條外緣半徑，半徑內為深色
   */
  function makeDetail(THREE, params) {
    const gd = params.greenhouse.detail || null;
    const wa = (params.body.detail || {}).wheel_arch || null;
    const poly = gd ? gd.dlo : [];
    if (poly.length > 16) throw new Error('greenhouse.detail.dlo 最多 16 點');
    const ranges = (list) => [0, 1].map((i) => new THREE.Vector2(...((list || [])[i] || [99, -99])));
    const A = [], B = [];
    for (let i = 0; i < 16; i++) {
      A.push(new THREE.Vector2(...(i < poly.length ? poly[i] : [99, 99])));
      B.push(new THREE.Vector2(...(i < poly.length ? poly[(i + 1) % poly.length] : [99, 99])));
    }
    const uniforms = {
      uGP: { value: new THREE.Vector3(gd ? gd.rail_zn : 9, gd ? gd.frame : 0, gd && gd.belt_y != null ? gd.belt_y : -9) },
      uHdr: { value: ranges(gd && gd.headers) }, uPil: { value: ranges(gd && gd.pillars) }, uFrit: { value: ranges(gd && gd.frits) },
      uDA: { value: A }, uDB: { value: B },
      uPaintC: { value: new THREE.Color(0xe9eae7) }, uPaintMR: { value: new THREE.Vector2(0.15, 0.32) },
      uTrimC: { value: new THREE.Color((gd && gd.trim_color) || 0x14161a) },
      uArch: { value: new THREE.Vector4(params.reference.axle_x, wa ? wa.y : 0, wa ? wa.r : 0, 0) }
    };
    /** 玻璃罩上的點屬於：glass 玻璃、paint 車身色、trim 窗框、pillar 黑色直柱。 */
    function glassRegion(ref, znv) {
      if (!gd) return 'glass';
      const x = ref.x, y = ref.y;
      if (znv > 0.995) {
        let inside = false, dmin = 1e3;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
          const abx = b[0] - a[0], aby = b[1] - a[1];
          const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (y - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-8)));
          dmin = Math.min(dmin, Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t));
        }
        if (!inside) return 'paint';
        if (dmin < gd.frame) return 'trim';
        return (gd.pillars || []).some((r) => x > r[0] && x < r[1]) ? 'pillar' : 'glass';
      }
      if (znv > gd.rail_zn) return 'paint';
      return (gd.headers || []).some((r) => x > r[0] && x < r[1]) ? 'paint' : 'glass';   // 黑邊仍算玻璃
    }
    const SIDE = 0.995;   // JS 端判斷側面的門檻（射線交點有浮點誤差）
    /** kind：1 = 車門（範圍整個在車的一側）、2 = 尾門（橫跨中線）、0 = 無條件。 */
    const boxKind = (b) => (!gd ? 0 : b.max[2] <= 0 || b.min[2] >= 0 ? 1 : 2);
    function moves(kind, ref, znv) {
      if (!gd || !kind) return true;
      if (kind === 1) return znv > SIDE && (glassRegion(ref, 1) !== 'paint' || ref.y < gd.belt_y);
      return znv <= SIDE && znv <= gd.rail_zn;
    }
    return { uniforms, glassRegion, boxKind, moves, SIDE, glassOn: !!gd, archOn: !!wa };
  }

  function shellMaterial(THREE, tint, surface, keep, cuts, detail) {
    const m = surface === 'body'
      ? new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 })
      : new THREE.MeshPhysicalMaterial({ color: 0x0b0e12, metalness: 0.6, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 });
    m.side = THREE.DoubleSide;
    const cmin = [], cmax = [], ckind = [];
    for (let i = 0; i < 8; i++) {
      const b = cuts && cuts[i];
      cmin.push(new THREE.Vector3(...(b ? b.min : [9, 9, 9])));
      cmax.push(new THREE.Vector3(...(b ? b.max : [-9, -9, -9])));
      ckind.push(b && b.kind ? b.kind : 0);
    }
    const own = {
      uMode: { value: keep ? 1 : 0 },
      uKMin: { value: new THREE.Vector3(...(keep ? keep.min : [0, 0, 0])) },
      uKMax: { value: new THREE.Vector3(...(keep ? keep.max : [0, 0, 0])) },
      uCMin: { value: cmin }, uCMax: { value: cmax }, uCKind: { value: ckind }, uKKind: { value: keep && keep.kind ? keep.kind : 0 },
      uGOn: { value: surface === 'glass' && detail.glassOn ? 1 : 0 },
      uArchOn: { value: surface === 'body' && detail.archOn ? 1 : 0 }
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, tint, detail.uniforms, own);
      sh.vertexShader = 'attribute vec3 aRef;\nattribute float aZn;\nvarying vec3 vLoc;\nvarying float vZn;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = aRef; vZn = aZn;');
      sh.fragmentShader = [
        'varying vec3 vLoc;',
        'uniform vec3 uHMin, uHMax, uSMin, uSMax, uH2Min, uH2Max, uS2Min, uS2Max, uTint, uKMin, uKMax, uDoorX, uSeamY;',
        'uniform vec4 uSeamA;',
        'uniform float uHOn, uSOn, uSeam, uMode;',
        'uniform vec3 uCMin[8];', 'uniform vec3 uCMax[8];',
        'varying float vZn;',
        'uniform float uGOn, uArchOn, uKKind;', 'uniform float uCKind[8];', 'uniform vec3 uGP;', 'uniform vec2 uPaintMR;', 'uniform vec3 uPaintC, uTrimC;', 'uniform vec4 uArch;',
        'uniform vec2 uHdr[2];', 'uniform vec2 uPil[2];', 'uniform vec2 uFrit[2];', 'uniform vec2 uDA[16];', 'uniform vec2 uDB[16];',
        'float gPaint = 0.0, gTrim = 0.0, gDark = 0.0;',   // 車身色、黑色飾條、輪拱的遮罩，後面用來調整粗糙度與金屬度
        'float inBox(vec3 a, vec3 b){ vec3 s = step(a, vLoc) * step(vLoc, b); return s.x*s.y*s.z; }',
        'float line(float v, float at){ return 1.0 - smoothstep(0.0, 0.006, abs(v - at)); }',
        ''
      ].join('\n') + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse, opacity );
        float zn = abs(vZn);   // 內插後才取絕對值，頂面不細分也正確
        bool gSide = zn > 0.999, gInside = false; float gDmin = 1000.0;
        if (uGOn > 0.5 && gSide) {
          // 側面：點是否在車窗開口多邊形內，以及到開口邊緣的距離
          for (int i = 0; i < 16; i++) {
            vec2 a = uDA[i], b = uDB[i];
            if (((a.y > vLoc.y) != (b.y > vLoc.y)) && (vLoc.x < (b.x - a.x) * (vLoc.y - a.y) / (b.y - a.y) + a.x)) gInside = !gInside;
            vec2 ab = b - a; float t = clamp(dot(vLoc.xy - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
            gDmin = min(gDmin, length(vLoc.xy - a - ab * t));
          }
        }
        // 開啟件帶走的範圍：車門（kind 1）只帶走側面的車窗與門上緣；尾門（kind 2）只帶走頂面的玻璃與橫樑
        float mvDoor = (uGOn < 0.5 || (gSide && (gInside || vLoc.y < uGP.z))) ? 1.0 : 0.0;
        float mvGate = (uGOn < 0.5 || (!gSide && zn <= uGP.x)) ? 1.0 : 0.0;
        if (uMode < 0.5) {
          for (int i = 0; i < 8; i++) {
            float mv = uCKind[i] < 0.5 ? 1.0 : (uCKind[i] < 1.5 ? mvDoor : mvGate);
            if (inBox(uCMin[i], uCMax[i]) * mv > 0.5) discard;
          }
        } else {
          float mv = uKKind < 0.5 ? 1.0 : (uKKind < 1.5 ? mvDoor : mvGate);
          if (inBox(uKMin, uKMax) * mv < 0.5) discard;
        }
        if (uSeam > 0.5) {
          float side = step(uSeamA.z, abs(vLoc.z)) * step(uSeamY.x, vLoc.y) * step(vLoc.y, uSeamY.y);
          float sm = max(max(line(vLoc.x, uDoorX.x), line(vLoc.x, uDoorX.y)), line(vLoc.x, uDoorX.z));
          float hood = line(vLoc.x, uSeamA.x) * step(uSeamA.w, vLoc.y) * step(abs(vLoc.z), uSeamA.z);
          float gate = line(vLoc.x, uSeamA.y) * step(uSeamY.z, vLoc.y);
          diffuseColor.rgb *= 1.0 - 0.75 * max(max(sm * side, hood), gate);
        }
        if (uGOn > 0.5) {
          if (gSide) {
            // 側面：車窗開口外為車身色，沿開口內緣一圈窗框，再加黑色直柱
            vec2 p = vLoc.xy;
            float sd = gInside ? gDmin : -gDmin, aa = max(length(fwidth(p)), 1e-4);
            gPaint = 1.0 - smoothstep(-aa, aa, sd);
            gTrim = 1.0 - smoothstep(uGP.y - aa, uGP.y + aa, sd);
            for (int i = 0; i < 2; i++) gTrim = max(gTrim, smoothstep(uPil[i].x - aa, uPil[i].x + aa, p.x) * (1.0 - smoothstep(uPil[i].y - aa, uPil[i].y + aa, p.x)));
            gTrim *= 1.0 - gPaint;
          } else {
            // 頂面與圓角：兩側縱樑與橫樑為車身色
            float az = max(fwidth(zn), 1e-4), ax = max(fwidth(vLoc.x), 1e-4);
            gPaint = smoothstep(uGP.x - az, uGP.x + az, zn);
            for (int i = 0; i < 2; i++) {
              gPaint = max(gPaint, smoothstep(uHdr[i].x - ax, uHdr[i].x + ax, vLoc.x) * (1.0 - smoothstep(uHdr[i].y - ax, uHdr[i].y + ax, vLoc.x)));
              gTrim = max(gTrim, smoothstep(uFrit[i].x - ax, uFrit[i].x + ax, vLoc.x) * (1.0 - smoothstep(uFrit[i].y - ax, uFrit[i].y + ax, vLoc.x)));
            }
            gTrim *= 1.0 - gPaint;
          }
          diffuseColor.rgb = mix(mix(diffuseColor.rgb, uPaintC, gPaint), uTrimC, gTrim);
        }
        if (uArchOn > 0.5) {
          float ra = min(distance(vLoc.xy, vec2(uArch.x, uArch.y)), distance(vLoc.xy, vec2(-uArch.x, uArch.y)));
          float aw = max(fwidth(ra), 1e-4);
          gDark = (1.0 - smoothstep(uArch.z - aw, uArch.z + aw, ra)) * smoothstep(0.78, 0.84, zn);   // 只畫在車側
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.012, 0.013, 0.015), gDark);
        }
        float h = uHOn * max(inBox(uHMin, uHMax), inBox(uH2Min, uH2Max));
        float s = uSOn * max(inBox(uSMin, uSMax), inBox(uS2Min, uS2Max));
        diffuseColor.rgb = mix(diffuseColor.rgb, uTint, max(s * 0.6, h * 0.32) * (1.0 - gPaint));
        if (!gl_FrontFacing) diffuseColor.rgb = vec3(0.045);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        roughnessFactor = mix(mix(mix(roughnessFactor, uPaintMR.y, gPaint), 0.85, gTrim), 0.9, gDark);
        metalnessFactor = mix(mix(mix(metalnessFactor, uPaintMR.x, gPaint), 1.0, gTrim), 0.0, gDark);   // 黑邊：金屬度拉滿讓反射率跟著底色變暗`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef CLEARCOAT
          material.clearcoat *= 1.0 - max(gDark, gTrim);   // 窗框與黑邊是霧面，不要映出天空
        #endif`);
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
    const detail = makeDetail(THREE, params);
    const znOf = glassGeo.userData.znOf;
    // 玻璃罩上的開啟範圍加上種類（車門／尾門），決定帶走玻璃罩的哪一部分
    const ops = openings.map((o) => ({ ...o, glassRegion: o.glassRegion ? { ...o.glassRegion, kind: detail.boxKind(o.glassRegion) } : o.glassRegion }));
    const bodyCuts = ops.filter((o) => o.bodyRegion).map((o) => o.bodyRegion).concat([params.cabin_cuts.body]);
    const glassCuts = ops.filter((o) => o.glassRegion).map((o) => o.glassRegion).concat([params.cabin_cuts.glass]);
    if (bodyCuts.length > 8 || glassCuts.length > 8) console.warn('開啟件超過 8 個，著色器只會處理前 8 個。');
    /** 射線打到玻璃罩的點在橫向的位置：三個頂點都在端面上就是側面（1），否則用 znOf。 */
    function znHit(o, h, ref) {
      const a = o.geometry.attributes.aZn, f = h.face;
      if (a && f && Math.abs(a.getX(f.a)) > 0.9999 && Math.abs(a.getX(f.b)) > 0.9999 && Math.abs(a.getX(f.c)) > 0.9999) return 1;
      return Math.min(znOf(ref), 0.99);
    }
    /** 只有座標、沒有三角形時的估計（已存的標註點）：側面內部的 znOf 約 0.93 以上。 */
    const znGuess = (ref) => (znOf(ref) > 0.9 ? 1 : znOf(ref));
    /** 參考座標上的點是否屬於這個範圍（玻璃罩上還要看開啟件實際帶走的部分，znv 為該點的橫向位置）。 */
    const inRegion = (ref, b, surface, znv) => inBox(ref, b) && (surface !== 'glass' || detail.moves(b.kind, ref, znv));
    const bodyTopY = params.cabin_cuts.glass.max[1];   // 玻璃罩從這個高度以上才看得到
    function shell(geo, surface, keep, cuts) {
      const mat = shellMaterial(THREE, tint[surface], surface, keep, cuts, detail);
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
      const [y0, y1] = Array.isArray(y) ? y : [y, y];   // y 可為 [z0 端高度, z1 端高度]
      for (let i = 0; i <= 32; i++) {
        const h = hitBody(map.fwd(end * 4, y0 + ((y1 - y0) * i) / 32, z0 + ((z1 - z0) * i) / 32), dir);
        if (h) pts.push(h.p.addScaledVector(h.n, lift));
      }
      return pts.length >= 2 ? new THREE.CatmullRomCurve3(pts) : null;
    }
    /**
     * 貼合車身表面的薄片（飾板、水箱罩、燈殼）。face：front / rear 時 u = z、v = y；
     * left / right 時 u = x、v = y。射線打不到的欄位會略過，所以範圍略超出車身也不會壞。
     */
    const outerX = params.reference.axle_x + 0.5;   // 輪拱以外才算車頭／車尾面
    function surfacePatch(face, u, v, lift, nu = 40, nv = 4) {
      const cols = [];
      // v：[v0, v1] 固定高度範圍，或 [[u, v0, v1], ...] 沿 u 線性內插的外形（楔形頭燈、梯形進氣口）
      const stops = Array.isArray(v[0]) ? [...v].sort((a, b) => a[0] - b[0]) : null;
      const vAt = (uu) => {
        if (!stops) return v;
        if (uu <= stops[0][0]) return [stops[0][1], stops[0][2]];
        for (let k = 1; k < stops.length; k++) {
          if (uu <= stops[k][0]) {
            const a = stops[k - 1], b = stops[k], t = (uu - a[0]) / (b[0] - a[0]);
            return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          }
        }
        const l = stops[stops.length - 1];
        return [l[1], l[2]];
      };
      for (let i = 0; i <= nu; i++) {
        const uu = u[0] + ((u[1] - u[0]) * i) / nu;
        const vr = vAt(uu);
        let col = [];
        for (let j = 0; j <= nv; j++) {
          const vv = vr[0] + ((vr[1] - vr[0]) * j) / nv;
          let o, d;
          if (face === 'front' || face === 'rear') {
            const e = face === 'front' ? 1 : -1;
            o = map.fwd(e * 4, vv, uu); d = new THREE.Vector3(-e, 0, 0);
          } else {
            const s = face === 'right' ? 1 : -1;
            o = map.fwd(uu, vv, s * 4); d = new THREE.Vector3(0, 0, -s);
          }
          const h = hitBody(o, d);
          // 只接受真的打在這一面的點：射線擦過側面（法向量幾乎垂直於射線），或從收窄的車尾旁穿過、
          // 打到前輪拱內側，都不算，否則薄片會被拉成橫跨車身的長條
          let ok = h && -h.n.dot(d) >= 0.35;
          if (ok) {
            const r = map.inv(h.p);
            ok = face === 'front' || face === 'rear' ? Math.abs(r.x) > outerX : Math.abs(r.z) > 0.6;
          }
          if (!ok) { col = null; break; }
          col.push(h.p.addScaledVector(h.n, lift));
        }
        cols.push(col);
      }
      const pos = [], idx = [], base = [];
      cols.forEach((c, i) => { if (c) { base[i] = pos.length / 3; for (const p of c) pos.push(p.x, p.y, p.z); } });
      for (let i = 0; i < nu; i++) {
        if (!cols[i] || !cols[i + 1]) continue;
        for (let j = 0; j < nv; j++) {
          const a = base[i] + j, b = base[i + 1] + j;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
      if (!idx.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    }
    /** 薄片零件：key 有對應車項時可點選；沒有對應時不攔截點擊，點到的是底下車身的部位範圍。 */
    function panel(key, face, u, v, mat, lift = 0.004) {
      const g = surfacePatch(face, u, v, lift);
      if (!g) return null;
      mat.side = THREE.DoubleSide;
      mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
      const m = key ? partMesh(key, g, mat) : new THREE.Mesh(g, mat);
      if (!key) disposables.push(g, mat);
      m.castShadow = false; m.receiveShadow = true;
      return m;
    }
    /** 沿表面的管狀零件（燈條、進氣口），兩端加圓帽。 */
    function strip(key, end, conf, mat, mirror) {
      // 鏡像那一側 z 反向，傾斜的 y（[z0 端, z1 端]）也要跟著對調
      const yRev = Array.isArray(conf.y) ? [conf.y[1], conf.y[0]] : conf.y;
      const ranges = mirror ? [[conf.z[0], conf.z[1], conf.y], [-conf.z[1], -conf.z[0], yRev]] : [[conf.z[0], conf.z[1], conf.y]];
      const out = [];
      for (const [z0, z1, y] of ranges) {
        const curve = surfaceCurve(end, y, z0, z1, conf.lift ?? conf.r * 0.35);
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
      const headMat = () => std(0x0b0d10, { emissive: 0x9aa6b8, emissiveIntensity: 0.12, metalness: 0.5, roughness: 0.18 });
      const trimMat = () => std(0x111316, { roughness: 0.6, metalness: 0.15 });

      // 前燈條（Premium / Performance）：深色燈殼包住細發光條，淺色車漆上也看得到
      if (V.front_light_bar && L.front_bar) {
        const fb = L.front_bar;
        strip('lights-front', 1, fb, std(0x0b0c0e, { roughness: 0.3, metalness: 0.4 })).forEach((g) => group.add(g));
        strip('lights-front', 1, { ...fb, r: fb.r * 0.45, lift: fb.r * 0.95 }, lightW()).forEach((g) => group.add(g));
      }
      // 深色飾件：前下巴、後保桿下半部、左右側裙（params.dark_trim 可覆寫範圍）
      const T = params.dark_trim || {};
      const satin = () => std(0x17191c, { roughness: 0.62, metalness: 0.1 });
      const gloss = () => std(0x08090b, { roughness: 0.28, metalness: 0.35 });
      const fl = T.front_lower || { y: [0.225, 0.29], z: [-0.74, 0.74] };
      const rl = T.rear_lower || { y: [0.225, 0.44], z: [-0.86, 0.86] };
      const sk = T.skirts || { x: [-0.97, 0.97], y: [0.225, 0.34] };
      for (const m of [
        panel(null, 'front', fl.z, fl.y, satin()),
        panel(null, 'rear', rl.z, rl.shape || rl.y, satin()),   // shape（選用）：[[z, 下緣 y, 上緣 y], ...]
        panel(null, 'left', sk.x, sk.y, satin()),
        panel(null, 'right', sk.x, sk.y, satin())
      ]) if (m) group.add(m);
      // 前保桿兩側轉角的垂直導流槽
      if (T.front_corner_slots) {
        const cs = T.front_corner_slots;
        for (const z of [[cs.z[0], cs.z[1]], [-cs.z[1], -cs.z[0]]]) {
          const m = panel(null, 'front', z, cs.y, gloss(), 0.006);
          if (m) group.add(m);
        }
      }

      // 主頭燈：深色燈殼 + 上緣細日行燈。Standard 在引擎蓋前緣兩側；Premium / Performance 在前保桿兩側
      // shape（選用）：右側燈殼外形 [[z, 下緣 y, 上緣 y], ...]，左側自動鏡像；沒有時為 y ± r 的長條
      if (V.headlights) {
        const hl = V.headlights;
        const sh = hl.shape || [[hl.z[0], hl.y - hl.r, hl.y + hl.r], [hl.z[1], hl.y - hl.r, hl.y + hl.r]];
        const zs = sh.map((s) => s[0]), z0 = Math.min(...zs), z1 = Math.max(...zs);
        const mirrored = sh.map((s) => [-s[0], s[1], s[2]]);
        for (const [u, v] of [[[z0, z1], sh], [[-z1, -z0], mirrored]]) {
          const m = panel('lights-front', 'front', u, v, headMat(), 0.006);
          if (m) group.add(m);
        }
        // 日行燈沿燈殼上緣（略往內縮）
        const top = (z) => { const st = [...sh].sort((a, b) => a[0] - b[0]); let a = st[0], b = st[st.length - 1];
          for (let k = 1; k < st.length; k++) if (z <= st[k][0]) { a = st[k - 1]; b = st[k]; break; }
          const t = b[0] === a[0] ? 0 : (z - a[0]) / (b[0] - a[0]); return a[2] + (b[2] - a[2]) * t - 0.008; };
        const dz0 = z0 + 0.02, dz1 = z1 - 0.015;
        strip('lights-front', 1, { y: [top(dz0), top(dz1)], z: [dz0, dz1], r: 0.0045, lift: 0.009 }, lightW(), true)
          .forEach((g) => group.add(g));
      }
      // 前保桿水箱罩與 Performance 兩側導流口：亮黑薄片（參數 y ± r 為高度範圍）
      if (V.lower_intake) {
        const li = V.lower_intake;   // shape（選用）：[[z, 下緣 y, 上緣 y], ...] 梯形等外形
        const m = li.shape
          ? panel(null, 'front', [Math.min(...li.shape.map((s) => s[0])), Math.max(...li.shape.map((s) => s[0]))], li.shape, gloss(), 0.006)
          : panel(null, 'front', li.z, [li.y - li.r, li.y + li.r], gloss(), 0.006);
        if (m) group.add(m);
      }
      if (V.bumper_vents) {
        const bv = V.bumper_vents;
        for (const z of [[bv.z[0], bv.z[1]], [-bv.z[1], -bv.z[0]]]) {
          const m = panel(null, 'front', z, [bv.y - bv.r, bv.y + bv.r], gloss(), 0.006);
          if (m) group.add(m);
        }
      }
      // 尾燈條與兩端燈組（隨尾門開啟）
      if (L.rear_bar) {
        const rb = L.rear_bar;
        const rMat = () => std(0x200000, { emissive: 0xd0101a, emissiveIntensity: 1.2 });
        strip('lights-rear', -1, rb, rMat()).forEach((g) => attachTo(g, openingOf('lights-rear')));
        const lampMat = () => std(0x2a0406, { emissive: 0x7a0a10, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.3 });
        // 兩端燈組：外側較高的楔形，從燈條往外、往下包
        const lz = rb.corner_z || [0.6, 0.8];
        const wedge = (a, b) => [[a, rb.y - 0.03, rb.y - 0.008], [b, rb.y - 0.09, rb.y - 0.004]];
        for (const [z, v] of [[[lz[0], lz[1]], wedge(lz[0], lz[1])], [[-lz[1], -lz[0]], wedge(-lz[0], -lz[1])]]) {
          const m = panel('lights-rear', 'rear', z, v, lampMat(), 0.006);
          if (m) attachTo(m, openingOf('lights-rear'));
        }
        // 後保桿反光片
        for (const z of [[0.6, 0.72], [-0.72, -0.6]]) {
          const m = panel(null, 'rear', z, [rl.y[1] - 0.05, rl.y[1] - 0.03], std(0x300000, { emissive: 0x500006, emissiveIntensity: 0.6 }), 0.008);
          if (m) group.add(m);
        }
      }
      // Performance 尾門擾流板
      if (V.rear_spoiler) {
        const sp = V.rear_spoiler;
        const h = hitBody(map.fwd(sp.x, 3, 0), DOWN);
        if (h) {
          const width = (sp.z[1] - sp.z[0]) * map.kz;
          const m = new THREE.Mesh(box(sp.chord, 0.022, width), std(0x16181b, { roughness: 0.35, metalness: 0.3 }));
          m.position.copy(h.p).addScaledVector(h.n, 0.011);   // 厚度一半，貼齊鴨尾上緣
          m.rotation.z = Math.atan2(-h.n.x, h.n.y);            // 順著鴨尾上緣的斜度
          m.castShadow = true; disposables.push(m.geometry, m.material);
          attachTo(m, 'tail');
        }
      }
    }

    // 後照鏡（隨前門開啟）：車身色鏡殼、朝後的鏡面、黑色底座。fixtures.mirror 可調位置與大小
    {
      const mc = (params.fixtures || {}).mirror || {};
      const at = mc.at || [0.92, 1.085, 1.075], size = mc.size || [0.075, 0.115, 0.2];   // 前後厚、高、寬
      const [dx, hy, wz] = size, r = Math.min(hy, wz) * 0.36, bt = dx * 0.3;
      const sh = new THREE.Shape();   // 鏡殼正面輪廓（寬 × 高的圓角矩形）
      sh.moveTo(-wz / 2 + r, -hy / 2); sh.lineTo(wz / 2 - r, -hy / 2); sh.quadraticCurveTo(wz / 2, -hy / 2, wz / 2, -hy / 2 + r);
      sh.lineTo(wz / 2, hy / 2 - r); sh.quadraticCurveTo(wz / 2, hy / 2, wz / 2 - r, hy / 2);
      sh.lineTo(-wz / 2 + r, hy / 2); sh.quadraticCurveTo(-wz / 2, hy / 2, -wz / 2, hy / 2 - r);
      sh.lineTo(-wz / 2, -hy / 2 + r); sh.quadraticCurveTo(-wz / 2, -hy / 2, -wz / 2 + r, -hy / 2);
      const headGeo = new THREE.ExtrudeGeometry(sh, { depth: dx - bt * 2, bevelEnabled: true, bevelThickness: bt, bevelSize: r * 0.5, bevelSegments: 5, curveSegments: 8 });
      headGeo.center(); headGeo.rotateY(Math.PI / 2);   // 寬度轉到 z、厚度轉到 x
      for (const [key, side] of [['mirror-L', -1], ['mirror-R', 1]]) {
        const mat = new THREE.MeshPhysicalMaterial({ color: 0xe9eae7, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
        paintMats.push(mat);
        const head = partMesh(key, headGeo, mat, [at[0], at[1], side * at[2]]);
        const glassM = partMesh(key, box(0.004, hy * 0.72, wz * 0.8), std(0x20262d, { metalness: 0.9, roughness: 0.08 }), [at[0], at[1], side * at[2]]);
        glassM.position.x -= dx / 2 + 0.001; glassM.castShadow = false;
        const stalk = partMesh(key, box(dx * 0.8, 0.03, wz * 0.75), std(0x15171a, { roughness: 0.55 }), [at[0], at[1], side * at[2]]);
        stalk.position.y -= hy / 2 + 0.012; stalk.position.z -= side * wz * 0.45;
        for (const m of [head, glassM, stalk]) attachTo(m, openingOf(key));
      }
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
      if (wheelV.style === 'aero') {
        // 空力輪框：深色輪面 + 弧形葉片。左輪是同一個輪框繞垂直軸轉 180°，從車外看兩側一致
        const n = wheelV.blades || 5;
        const bladeMat = std(wheelV.blade_color || 0x4a4f55, { metalness: 0.25, roughness: 0.45 });
        const shape = aeroBlade(THREE, 0.07, rimR * 0.93, wheelV.sweep_deg || 48, rimR * 0.2);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2, curveSegments: 6 });
        for (let i = 0; i < n; i++) {
          const b = partMesh('aero-cover', geo, bladeMat, null);
          b.rotation.z = (i / n) * Math.PI * 2;
          b.scale.set(side, 1, side);   // 左側：x、z 反向 = 繞 y 軸轉 180°，葉片朝外擠出
          b.position.z = side * (hw - 0.03);
          w.add(b);
        }
      } else {
        const spokes = wheelV.spokes || (t.rimDiameterIn >= 21 ? 10 : 5);
        for (let i = 0; i < spokes; i++) {
          const a = (i / spokes) * Math.PI * 2;
          const sp = partMesh('rim', box(rimR * 0.82, spokes > 5 ? 0.026 : 0.05, 0.03), rimMat, null);
          sp.position.set(Math.cos(a) * rimR * 0.52, Math.sin(a) * rimR * 0.52, side * (hw - 0.025)); sp.rotation.z = a; w.add(sp);
        }
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
      add('floor', box(3.0, 0.06, 1.6 * map.kz), std(0x17191c), [-0.45, 0.34, 0]);
      for (const z of [-0.38, 0.38]) {
        add('seat-front', box(0.5, 0.14, 0.5), std(0x2c2f34), [0.18, 0.5, z]);
        add('front-seatback', box(0.14, 0.62, 0.48), std(0x2c2f34), [-0.14, 0.86, z], [0, 0, 0.2]);
        add('seat-front', box(0.1, 0.18, 0.28), std(0x2c2f34), [-0.24, 1.26, z], [0, 0, 0.2]);
      }
      add('seat-rear', box(0.5, 0.14, 1.4), std(0x2c2f34), [-0.85, 0.5, 0]);
      add('rear-seatback', box(0.14, 0.6, 1.4), std(0x2c2f34), [-1.17, 0.86, 0], [0, 0, 0.25]);
      for (const z of [-0.45, 0, 0.45]) add('seat-rear', box(0.09, 0.15, 0.26), std(0x2c2f34), [-1.27, 1.24, z], [0, 0, 0.25]);
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
        const sf = o.userData.surface, znv = sf === 'glass' ? znHit(o, h, ref) : 0;
        if (o.userData.keep && !inRegion(ref, o.userData.keep, sf, znv)) continue;
        if (o.userData.cuts && o.userData.cuts.some((b) => inRegion(ref, b, sf, znv))) continue;
        out.push({ h, o, ref, znv });
      }
      return out;
    }
    function classify(surface, ref) {
      const z = zones[surface].find((zz) => inBox(ref, zz));
      return z ? z.code : surface === 'body' ? 'body' : 'roof';
    }
    // 側窗的車項：玻璃罩上範圍整個在車的一側的那個部位（左右各一個範圍、同一個車項）
    const sideGlassCode = (zones.glass.find((z) => z.max[2] <= 0 || z.min[2] >= 0) || {}).code;
    /** 玻璃罩上的點：側面的玻璃 → 側窗；其餘玻璃照部位範圍分類；車頂縱樑與橫樑 → roof-rails 對應的車項；車柱、窗框 → 車身。 */
    function classifyGlass(ref, zn) {
      if (!detail.glassOn) return classify('glass', ref);
      const side = zn > detail.SIDE, region = detail.glassRegion(ref, zn);
      if (region === 'glass') return (side && sideGlassCode) || classify('glass', ref);
      return side ? 'body' : meshKeyToPart['roof-rails'] || 'body';
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
      const zs = zoneByCode[partCode] || [];
      if (!v) return null;
      // 側窗與車頂橫樑不照部位範圍分類（見 classifyGlass），直接看哪個開啟件帶走這個點
      if (detail.glassOn && (partCode === sideGlassCode || partCode === meshKeyToPart['roof-rails'])) {
        const o = ops.find((x) => x.glassRegion && inRegion(v, x.glassRegion, 'glass', znGuess(v)));
        return o ? o.code : null;
      }
      for (const z of zs) {
        if (!inBox(v, z)) continue;
        const key = z.surface === 'body' ? 'bodyRegion' : 'glassRegion';
        // 「車身」也包含玻璃罩上的門上緣，兩種範圍都要找
        const zg = znGuess(v);
        const o = ops.find((x) => x[key] && inRegion(v, x[key], z.surface, zg))
          || (partCode === 'body' && v.y > bodyTopY ? ops.find((x) => x.glassRegion && inRegion(v, x.glassRegion, 'glass', zg)) : null);
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
        const { h, o, ref, znv } = v;
        const part = o.userData.surface === 'glass' ? classifyGlass(ref, znv)
          : o.userData.surface ? classify(o.userData.surface, ref) : o.userData.part;
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
      setPaint(c) {
        for (const m of paintMats) { m.color.set(c.hex); m.metalness = +c.metalness; m.roughness = +c.roughness; }
        // 玻璃罩上的車身色區域（車柱、車頂縱樑）跟著換色
        detail.uniforms.uPaintC.value.set(c.hex); detail.uniforms.uPaintMR.value.set(+c.metalness, +c.roughness);
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
