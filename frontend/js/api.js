// API 用戶端：HttpClient 呼叫 .NET Web API；MockClient 使用匯出的示範資料，介面與規則相同。
(function () {
  const AV = (window.AV = window.AV || {});

  class ApiError extends Error {
    constructor(status, problem) {
      const detail = problem && problem.errors ? Object.values(problem.errors).flat().join(' ') : '';
      super(detail || (problem && problem.title) || `伺服器回應 ${status}`);
      this.status = status;
      this.problem = problem;
    }
  }

  class HttpClient {
    constructor(base, market) {
      this.base = base.replace(/\/$/, '');
      this.market = market || 'TW';
      this.mode = 'api';
    }
    async req(method, path, body) {
      const res = await fetch(this.base + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
      });
      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data);
      return data;
    }
    catalog() { return this.req('GET', `/catalog?market=${encodeURIComponent(this.market)}`); }
    trim(id) { return this.req('GET', `/trims/${id}`); }
    asset(id) { return this.req('GET', `/assets/${id}`); }
    parts() { return this.req('GET', '/parts'); }
    brands() { return this.req('GET', '/brands'); }
    accessoryCategories() { return this.req('GET', '/accessory-categories'); }
    createBuild(body) { return this.req('POST', '/builds', body); }
    getBuild(id) { return this.req('GET', `/builds/${id}`); }
    updateBuild(id, body) { return this.req('PATCH', `/builds/${id}`, body); }
    addAccessory(b, body) { return this.req('POST', `/builds/${b}/accessories`, body); }
    updateAccessory(b, a, body) { return this.req('PATCH', `/builds/${b}/accessories/${a}`, body); }
    deleteAccessory(b, a) { return this.req('DELETE', `/builds/${b}/accessories/${a}`); }
    addCandidate(b, a, body) { return this.req('POST', `/builds/${b}/accessories/${a}/products`, body); }
    updateCandidate(b, a, c, body) { return this.req('PATCH', `/builds/${b}/accessories/${a}/products/${c}`, body); }
    deleteCandidate(b, a, c) { return this.req('DELETE', `/builds/${b}/accessories/${a}/products/${c}`); }
  }

  // ---- 離線示範：規則比照 API，配置清單存在 localStorage ----------------------
  const MOCK_KEY = 'av.mock.builds.v2';
  const LEGACY_KEY = 'av.mock.builds.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const now = () => new Date().toISOString();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));
  const STATUSES = ['purchased', 'installed'];
  const INTERIORS = ['black', 'white'];
  const trimOrNull = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

  class MockClient {
    constructor(data) {
      this.data = data;
      this.mode = 'mock';
      this.builds = {};
      try { this.builds = JSON.parse(localStorage.getItem(MOCK_KEY) || 'null') || this.migrateLegacy(); }
      catch (e) { this.builds = {}; }
    }
    persist() { try { localStorage.setItem(MOCK_KEY, JSON.stringify(this.builds)); } catch (e) { /* 無痕視窗等情況 */ } }
    notFound(title) { return Promise.reject(new ApiError(404, { title })); }
    conflict(title) { return Promise.reject(new ApiError(409, { title })); }
    invalid(msg) { return Promise.reject(new ApiError(400, { title: '資料驗證失敗', errors: { field: [msg] } })); }
    part(code) { return this.data.parts.find((p) => p.code === code); }
    colorFits(colorId, trimId) { const t = this.data.trims[trimId]; return !!t && t.paintColors.some((c) => c.id === colorId); }
    acc(buildId, accId) { const b = this.builds[buildId]; return b && b.accessories.find((x) => x.id === accId); }
    nextId(b) { b.seq = (b.seq || 0) + 1; return -b.seq; }   // 自訂配件／產品用負數 id，與內建 id 不衝突
    touch(b, a) { const t = now(); b.updatedAt = t; if (a) a.updatedAt = t; this.persist(); }

    /** 舊版（v1）配置清單：名稱轉為自訂配件，選過的產品轉為選定的候選，評估中／準備購買的狀態移除。 */
    migrateLegacy() {
      let old = {};
      try { old = JSON.parse(localStorage.getItem(LEGACY_KEY) || '{}') || {}; } catch (e) { old = {}; }
      const partMap = { 'wheel-FL': 'rim', 'wheel-FR': 'rim', 'wheel-RL': 'rim', 'wheel-RR': 'rim',
        'mirror-L': 'mirror', 'mirror-R': 'mirror', 'sidewin-L': 'side-glass', 'sidewin-R': 'side-glass' };
      const out = {};
      for (const ob of Object.values(old)) {
        const b = { id: ob.id, name: ob.name, trimId: ob.trimId, paintColorId: ob.paintColorId ?? null, interiorColor: ob.interiorColor || 'black',
          createdAt: ob.createdAt, updatedAt: ob.updatedAt, accessories: [], customTypes: [], customProducts: [], seq: 0 };
        out[b.id] = b;
        for (const oa of ob.accessories || []) {
          const part = this.part(partMap[oa.partCode] || oa.partCode);
          if (!part) continue;
          // 舊資料有配件 id 就用它；只有名稱時，名稱與這個車項的內建配件相同也歸到內建配件
          let type = (part.accessoryTypes || []).find((t) => (oa.accessoryTypeId ? t.id === oa.accessoryTypeId : t.name === oa.name));
          let typeRef;
          if (type) typeRef = { id: type.id, name: type.name, isCustom: false, category: type.category || null };
          else {
            const name = String(oa.name || '配件').slice(0, 40);
            let ct = b.customTypes.find((t) => t.name === name);
            if (!ct) { ct = { id: this.nextId(b), name }; b.customTypes.push(ct); }
            typeRef = { id: ct.id, name: ct.name, isCustom: true, category: null };
          }
          if (b.accessories.some((x) => x.partCode === part.code && x.accessoryType.id === typeRef.id)) continue;
          const products = [];
          const pr = type && oa.productId && type.products.find((x) => x.id === oa.productId);
          if (pr) products.push({ id: uuid(), isSelected: true, product: clone(pr) });
          b.accessories.push({ id: oa.id || uuid(), partCode: part.code, partName: part.name, assetId: oa.assetId ?? null,
            accessoryType: typeRef, status: pr && STATUSES.includes(oa.status) ? oa.status : null,
            note: oa.note ?? null, position: oa.position ?? null, isExample: !!oa.isExample, products,
            createdAt: oa.createdAt || now(), updatedAt: oa.updatedAt || now() });
        }
      }
      this.builds = out;
      this.persist();
      return out;
    }

    // ---- 目錄 ----
    async catalog() { return clone(this.data.catalog); }
    async trim(id) { const t = this.data.trims[id]; return t ? clone(t) : this.notFound('找不到這個版本。'); }
    async asset(id) { const a = this.data.assets[id]; return a ? clone(a) : this.notFound('找不到這個模型資源。'); }
    async parts() { return clone(this.data.parts); }
    async brands() { return clone(this.data.brands || []); }
    async accessoryCategories() { return clone(this.data.accessoryCategories || []); }

    // ---- 配置清單 ----
    view(b) {   // 回傳給介面的 BuildDto（不含內部欄位）
      const { customTypes, customProducts, seq, ...dto } = b;
      dto.interiorColor = dto.interiorColor || 'black';   // 舊版存檔沒有內裝欄位
      return clone(dto);
    }
    async createBuild({ name, trimId, paintColorId, interiorColor }) {
      if (!this.data.trims[trimId]) return this.invalid('找不到這個版本。');
      if (paintColorId != null && !this.colorFits(paintColorId, trimId)) return this.invalid('這個車漆不適用於所選版本。');
      if (interiorColor != null && !INTERIORS.includes(interiorColor)) return this.invalid('內裝顏色只能是 black 或 white。');
      const t = now();
      const b = { id: uuid(), name: (name || '我的 Model Y').trim(), trimId, paintColorId: paintColorId ?? null,
        interiorColor: interiorColor || 'black',
        createdAt: t, updatedAt: t, accessories: [], customTypes: [], customProducts: [], seq: 0 };
      this.builds[b.id] = b; this.persist();
      return this.view(b);
    }
    async getBuild(id) { const b = this.builds[id]; return b ? this.view(b) : this.notFound('找不到這個配置清單。'); }
    async updateBuild(id, body) {
      const b = this.builds[id]; if (!b) return this.notFound('找不到這個配置清單。');
      const trimId = body.trimId ?? b.trimId;
      if (!this.data.trims[trimId]) return this.invalid('找不到這個版本。');
      const colorId = body.paintColorId ?? b.paintColorId;
      if (colorId != null && !this.colorFits(colorId, trimId)) return this.invalid('這個車漆不適用於所選版本。');
      if (body.interiorColor != null && !INTERIORS.includes(body.interiorColor)) return this.invalid('內裝顏色只能是 black 或 white。');
      if (body.name) b.name = body.name.trim();
      b.trimId = trimId; b.paintColorId = colorId; this.touch(b);
      if (body.interiorColor) b.interiorColor = body.interiorColor;
      return this.view(b);
    }

    // ---- 配件 ----
    async addAccessory(buildId, req) {
      const b = this.builds[buildId]; if (!b) return this.notFound('找不到這個配置清單。');
      const part = this.part(req.partCode); if (!part) return this.invalid('找不到這個車項。');
      const custom = trimOrNull(req.customAccessoryName);
      if ((req.accessoryTypeId == null) === (custom == null)) return this.invalid('請選擇一個配件，或輸入自訂配件名稱（二擇一）。');
      let typeRef;
      if (custom == null) {
        const t = (part.accessoryTypes || []).find((x) => x.id === req.accessoryTypeId);
        if (!t) return this.invalid('這個車項沒有這項配件。');
        typeRef = { id: t.id, name: t.name, isCustom: false, category: t.category || null };
      } else {
        if (custom.length > 40) return this.invalid('自訂配件名稱最多 40 字。');
        let ct = b.customTypes.find((x) => x.name === custom);
        if (!ct) { ct = { id: this.nextId(b), name: custom }; b.customTypes.push(ct); }
        typeRef = { id: ct.id, name: ct.name, isCustom: true, category: null };
      }
      if (b.accessories.some((x) => x.partCode === part.code && x.accessoryType.id === typeRef.id))
        return this.conflict('這個車項已經加過這項配件。');
      const t = now();
      const a = { id: uuid(), partCode: part.code, partName: part.name, assetId: req.assetId ?? null,
        accessoryType: typeRef, status: null, note: trimOrNull(req.note), position: req.position ?? null,
        isExample: !!req.isExample, products: [], createdAt: t, updatedAt: t };
      b.accessories.push(a); this.touch(b);
      return clone(a);
    }
    async updateAccessory(buildId, accId, req) {
      const b = this.builds[buildId]; const a = this.acc(buildId, accId);
      if (!a) return this.notFound('找不到這個配件。');
      if (req.status != null) {
        if (!STATUSES.includes(req.status)) return this.invalid('狀態只能是已購買或已安裝。');
        if (!a.products.some((x) => x.isSelected)) return this.invalid('請先選定產品，再設定已購買或已安裝。');
        a.status = req.status;
      }
      if (req.note !== undefined) a.note = trimOrNull(req.note);
      if (req.position !== undefined) a.position = req.position;
      for (const k of req.clear || []) if (['status', 'note', 'position'].includes(k)) a[k] = null;
      this.touch(b, a);
      return clone(a);
    }
    async deleteAccessory(buildId, accId) {
      const b = this.builds[buildId]; if (!b || !this.acc(buildId, accId)) return this.notFound('找不到這個配件。');
      b.accessories = b.accessories.filter((x) => x.id !== accId);
      this.cleanup(b); this.touch(b);
      return null;
    }

    // ---- 候選產品 ----
    async addCandidate(buildId, accId, req) {
      const b = this.builds[buildId]; const a = this.acc(buildId, accId);
      if (!a) return this.notFound('找不到這個配件。');
      if ((req.productId == null) === (req.custom == null)) return this.invalid('請選擇內建產品，或輸入自訂產品（二擇一）。');
      let product;
      if (req.productId != null) {
        const t = a.accessoryType.isCustom ? null : (this.part(a.partCode).accessoryTypes || []).find((x) => x.id === a.accessoryType.id);
        product = t && t.products.find((x) => x.id === req.productId);
        if (!product) return this.invalid('這個產品不適用於這個車項的這項配件。');
        product = clone(product);
      } else {
        const c = req.custom;
        const name = trimOrNull(c.name);
        if (!name || name.length > 60) return this.invalid('產品名稱需為 1–60 字。');
        if (c.rating != null && !(c.rating >= 1 && c.rating <= 5)) return this.invalid('推薦指數需為 1–5。');
        if (c.suggestedPriceTwd != null && !(c.suggestedPriceTwd >= 0)) return this.invalid('建議售價不能是負數。');
        if (c.brandId != null && trimOrNull(c.brandName)) return this.invalid('品牌請擇一：選既有品牌或輸入品牌名稱。');
        const brand = c.brandId != null ? (this.data.brands || []).find((x) => x.id === c.brandId) : null;
        if (c.brandId != null && !brand) return this.invalid('找不到這個品牌。');
        const brandName = brand ? brand.name : trimOrNull(c.brandName);
        const model = trimOrNull(c.model);
        product = { id: this.nextId(b), source: 'custom',
          brand: brand ? { id: brand.id, code: brand.code, name: brand.name, logoUrl: brand.logoUrl } : null,
          brandName, name, model, suggestedPriceTwd: c.suggestedPriceTwd ?? null, rating: c.rating ?? null,
          url: trimOrNull(c.url), displayName: [brandName, name, model].filter(Boolean).join(' ') };
        b.customProducts.push(product);
      }
      if (a.products.some((x) => x.product.id === product.id)) return this.conflict('這個產品已經在候選清單中。');
      const cand = { id: uuid(), isSelected: false, product };
      a.products.push(cand);
      if (req.select) this.select(a, cand.id);
      this.touch(b, a);
      return clone(a);
    }
    select(a, candId) {
      for (const x of a.products) x.isSelected = x.id === candId;
      a.status = null;   // 換選定產品時狀態清空
    }
    async updateCandidate(buildId, accId, candId, req) {
      const b = this.builds[buildId]; const a = this.acc(buildId, accId);
      const c = a && a.products.find((x) => x.id === candId);
      if (!c) return this.notFound('找不到這個候選產品。');
      if (req.isSelected) { if (!c.isSelected) this.select(a, candId); }
      else { c.isSelected = false; a.status = null; }
      this.touch(b, a);
      return clone(a);
    }
    async deleteCandidate(buildId, accId, candId) {
      const b = this.builds[buildId]; const a = this.acc(buildId, accId);
      const c = a && a.products.find((x) => x.id === candId);
      if (!c) return this.notFound('找不到這個候選產品。');
      a.products = a.products.filter((x) => x !== c);
      if (c.isSelected) a.status = null;
      this.cleanup(b); this.touch(b, a);
      return clone(a);
    }
    /** 刪除已不再使用的自訂產品與自訂配件。 */
    cleanup(b) {
      const usedProducts = new Set(b.accessories.flatMap((a) => a.products.map((x) => x.product.id)));
      b.customProducts = b.customProducts.filter((p) => usedProducts.has(p.id));
      const usedTypes = new Set(b.accessories.map((a) => a.accessoryType.id));
      b.customTypes = b.customTypes.filter((t) => usedTypes.has(t.id));
    }
  }

  /** 有設定 apiBase 且連得上就用 API，否則改用示範資料。 */
  AV.createClient = async function createClient() {
    const cfg = window.APP_CONFIG || {};
    if (cfg.apiBase) {
      const http = new HttpClient(cfg.apiBase, cfg.market);
      try {
        await http.catalog();
        return http;
      } catch (e) {
        console.warn('API 無法連線，改用示範資料：', e);
      }
    }
    return new MockClient(window.MOCK_DATA);
  };
  AV.ApiError = ApiError;
})();
