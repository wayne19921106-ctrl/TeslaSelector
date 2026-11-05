// API 用戶端：HttpClient 呼叫 .NET Web API；MockClient 使用匯出的示範資料，介面相同。
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
    accessoryCategories() { return this.req('GET', '/accessory-categories'); }
    createBuild(body) { return this.req('POST', '/builds', body); }
    getBuild(id) { return this.req('GET', `/builds/${id}`); }
    updateBuild(id, body) { return this.req('PATCH', `/builds/${id}`, body); }
    addAccessory(buildId, body) { return this.req('POST', `/builds/${buildId}/accessories`, body); }
    updateAccessory(buildId, accId, body) { return this.req('PATCH', `/builds/${buildId}/accessories/${accId}`, body); }
    deleteAccessory(buildId, accId) { return this.req('DELETE', `/builds/${buildId}/accessories/${accId}`); }
  }

  // ---- 離線示範：行為比照 API，配置清單存在 localStorage --------------------
  const MOCK_KEY = 'av.mock.builds.v1';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16);
    }));
  const STATUSES = ['considering', 'planned', 'purchased', 'installed'];

  class MockClient {
    constructor(data) {
      this.data = data;
      this.mode = 'mock';
      this.builds = {};
      try { this.builds = JSON.parse(localStorage.getItem(MOCK_KEY) || '{}') || {}; } catch (e) { this.builds = {}; }
      this.migrateLegacy();
    }
    /** 舊版的車項代碼（四個輪子、左右後照鏡、左右側窗）改成新的車項。 */
    migrateLegacy() {
      const map = { 'wheel-FL': 'rim', 'wheel-FR': 'rim', 'wheel-RL': 'rim', 'wheel-RR': 'rim',
        'mirror-L': 'mirror', 'mirror-R': 'mirror', 'sidewin-L': 'side-glass', 'sidewin-R': 'side-glass' };
      let changed = false;
      for (const b of Object.values(this.builds)) for (const a of b.accessories || []) {
        const to = map[a.partCode];
        if (to && this.part(to)) { a.partCode = to; a.partName = this.part(to).name; changed = true; }
        else if (this.part(a.partCode) && a.partName !== this.part(a.partCode).name) { a.partName = this.part(a.partCode).name; changed = true; }
        if (!('accessoryTypeId' in a)) Object.assign(a, { accessoryTypeId: null, accessoryTypeName: null, category: null, productId: null, productName: null });
      }
      if (changed) this.persist();
    }
    /** 檢查配件是否為車項可裝、產品是否適用；回傳 { type, product } 或錯誤訊息。 */
    resolveCatalog(part, typeId, productId) {
      if (productId != null && typeId == null) return { error: '選擇產品時也要指定配件。' };
      if (typeId == null) return { type: null, product: null };
      const type = (part.accessoryTypes || []).find((t) => t.id === typeId);
      if (!type) return { error: '這個車項沒有這項配件。' };
      if (productId == null) return { type, product: null };
      const product = type.products.find((x) => x.id === productId);
      return product ? { type, product } : { error: '這個產品不適用於所選的車項與配件。' };
    }
    catalogFields(type, product) {
      return { accessoryTypeId: type ? type.id : null, accessoryTypeName: type ? type.name : null,
        category: type && type.category ? { ...type.category } : null,
        productId: product ? product.id : null, productName: product ? product.displayName : null };
    }
    persist() { try { localStorage.setItem(MOCK_KEY, JSON.stringify(this.builds)); } catch (e) { /* 無痕視窗等情況 */ } }
    notFound(title) { return Promise.reject(new ApiError(404, { title })); }
    invalid(msg) { return Promise.reject(new ApiError(400, { title: '資料驗證失敗', errors: { field: [msg] } })); }
    part(code) { return this.data.parts.find((p) => p.code === code); }
    trimGen(trimId) { const t = this.data.trims[trimId]; return t ? t.generation.id : null; }
    colorFits(colorId, trimId) {
      const t = this.data.trims[trimId];
      return !!t && t.paintColors.some((c) => c.id === colorId);
    }

    async catalog() { return clone(this.data.catalog); }
    async trim(id) { const t = this.data.trims[id]; return t ? clone(t) : this.notFound('找不到這個版本。'); }
    async asset(id) { const a = this.data.assets[id]; return a ? clone(a) : this.notFound('找不到這個模型資源。'); }
    async parts() { return clone(this.data.parts); }
    async accessoryCategories() { return clone(this.data.accessoryCategories || []); }

    async createBuild({ name, trimId, paintColorId }) {
      if (!this.data.trims[trimId]) return this.invalid('找不到這個版本。');
      if (paintColorId != null && !this.colorFits(paintColorId, trimId)) return this.invalid('這個車漆不適用於所選版本。');
      const now = new Date().toISOString();
      const b = { id: uuid(), name: (name || '我的 Model Y').trim(), trimId, paintColorId: paintColorId ?? null,
        createdAt: now, updatedAt: now, accessories: [] };
      this.builds[b.id] = b; this.persist();
      return clone(b);
    }
    async getBuild(id) { const b = this.builds[id]; return b ? clone(b) : this.notFound('找不到這個配置清單。'); }
    async updateBuild(id, body) {
      const b = this.builds[id]; if (!b) return this.notFound('找不到這個配置清單。');
      const trimId = body.trimId ?? b.trimId;
      if (!this.data.trims[trimId]) return this.invalid('找不到這個版本。');
      const colorId = body.paintColorId ?? b.paintColorId;
      if (colorId != null && !this.colorFits(colorId, trimId)) return this.invalid('這個車漆不適用於所選版本。');
      if (body.name) b.name = body.name.trim();
      b.trimId = trimId; b.paintColorId = colorId; b.updatedAt = new Date().toISOString();
      this.persist(); return clone(b);
    }
    async addAccessory(buildId, req) {
      const b = this.builds[buildId]; if (!b) return this.notFound('找不到這個配置清單。');
      const part = this.part(req.partCode); if (!part) return this.invalid('找不到這個車項。');
      const status = req.status || 'considering';
      if (!STATUSES.includes(status)) return this.invalid('狀態不正確。');
      const cat = this.resolveCatalog(part, req.accessoryTypeId ?? null, req.productId ?? null);
      if (cat.error) return this.invalid(cat.error);
      const name = ((req.name || '').trim() || (cat.product && cat.product.displayName) || (cat.type && cat.type.name) || '').slice(0, 40);
      if (!name) return this.invalid('請選擇配件，或輸入自訂的配件名稱。');
      const now = new Date().toISOString();
      const a = { id: uuid(), partCode: part.code, partName: part.name, assetId: req.assetId ?? null,
        ...this.catalogFields(cat.type, cat.product), name, status,
        priceTwd: req.priceTwd ?? null, note: req.note ?? null, position: req.position ?? null,
        isExample: !!req.isExample, createdAt: now, updatedAt: now };
      b.accessories.push(a); b.updatedAt = now; this.persist();
      return clone(a);
    }
    async updateAccessory(buildId, accId, req) {
      const b = this.builds[buildId]; const a = b && b.accessories.find((x) => x.id === accId);
      if (!a) return this.notFound('找不到這個配件。');
      if (req.status && !STATUSES.includes(req.status)) return this.invalid('狀態不正確。');
      const clear = req.clear || [];
      if (req.accessoryTypeId !== undefined || req.productId !== undefined || clear.includes('accessoryType') || clear.includes('product')) {
        const typeId = clear.includes('accessoryType') ? null : (req.accessoryTypeId ?? a.accessoryTypeId);
        const productId = clear.includes('product') || clear.includes('accessoryType') ? null
          : (req.productId ?? (req.accessoryTypeId === undefined ? a.productId : null));
        const cat = this.resolveCatalog(this.part(a.partCode), typeId, productId);
        if (cat.error) return this.invalid(cat.error);
        Object.assign(a, this.catalogFields(cat.type, cat.product));
        if (req.name === undefined && (req.accessoryTypeId !== undefined || req.productId !== undefined))
          a.name = (cat.product && cat.product.displayName) || (cat.type && cat.type.name) || a.name;
      }
      for (const k of ['name', 'status', 'priceTwd', 'note', 'position']) if (req[k] !== undefined) a[k] = req[k];
      for (const k of clear) if (['priceTwd', 'note', 'position'].includes(k)) a[k] = null;
      a.updatedAt = b.updatedAt = new Date().toISOString(); this.persist();
      return clone(a);
    }
    async deleteAccessory(buildId, accId) {
      const b = this.builds[buildId]; if (!b) return this.notFound('找不到這個配置清單。');
      const n = b.accessories.length;
      b.accessories = b.accessories.filter((x) => x.id !== accId);
      if (b.accessories.length === n) return this.notFound('找不到這個配件。');
      this.persist(); return null;
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
