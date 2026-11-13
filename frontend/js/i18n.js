// 多語系：介面字串與資料名稱對照。預設繁體中文，選擇存在 localStorage，網址可用 ?lang=en 指定。
// 資料名稱（車項、版本、車漆…）目前資料庫只有中文，英文先依 code 在這裡對照；找不到就顯示原本的中文。
(function () {
  const AV = (window.AV = window.AV || {});
  const LANGS = ['zh-Hant', 'en'];
  const KEY = 'av.lang';

  const UI = {
    'zh-Hant': {
      'title': 'Model Y 配件檢視器',
      'brand.sub': '配件檢視器',
      'hint': '拖曳旋轉 · 點擊車項新增配件 · 雙擊車門或前後廂開關',
      'mode': '離線示範資料',
      'mode.title': '後端未連線，資料只存在這個瀏覽器',
      'loading': '正在載入車型資料…',
      'loadFail': '無法載入車型資料。',
      'disclaimer': '3D 車輛外觀為改色與配件位置示意模型，已移除原廠商標並微調細節；本平台與 Tesla, Inc. 無任何官方合作或授權關係。',
      'views': '視角', 'view.front': '前', 'view.left': '左側', 'view.right': '右側', 'view.rear': '後', 'view.top': '俯視', 'view.reset': '重設',
      'trim': '版本',
      'tab.specs': '規格', 'tab.acc': '配件', 'tab.doors': '車門', 'tab.paint': '車漆',
      'sheet.expand': '展開面板', 'sheet.collapse': '收合面板',
      'part': '車項', 'part.choose': '選擇車項…',
      'doors': '車門與車廂', 'openAll': '全部開啟', 'closeAll': '全部關閉', 'open': '開啟', 'closed': '關閉',
      'paint': '車漆', 'interior': '內裝', 'interior.black': '黑色', 'interior.white': '白色',
      'all': '全部配件', 'copy': '複製清單', 'copyBuf': '配件清單（Tab 分隔）',
      'ref.nav': '推薦連結', 'ref.tesla': 'Tesla 推薦連結訂購', 'ref.teslaShort': 'Tesla 推薦', 'ref.jowua': 'Jowua 配件', 'ref.jowuaShort': 'Jowua',
      'ref.jowuaPanel': '到 Jowua 選購 Model Y 配件',
      'ad': '廣告', 'ad.sponsored': '贊助', 'ad.slot': '廣告位',
      'gen': '{model} {gen} · {year} 年式 · {market}',
      'spec.length': '車長', 'spec.height': '車高', 'spec.width': '車寬（不含後照鏡）', 'spec.widthFolded': '車寬（後照鏡收折）',
      'spec.wheelbase': '軸距', 'spec.clearance': '離地高', 'spec.track': '輪距 前／後', 'spec.weight': '車重', 'spec.tires': '輪胎',
      'spec.tiresFR': '前 {f}／後 {r}',
      'spec.verified': '已與官網核對。資料來源：{src}',
      'spec.unverifiedFlag': '待核對', 'spec.unverified': '尚未與 Tesla 官網逐項核對。資料來源：{src}',
      'spec.summary': '{l} × {w} × {h} mm · 軸距 {wb}',
      'status.none': '尚未購買', 'status.purchased': '已購買', 'status.installed': '已安裝', 'status.unselected': '尚未選定',
      'p.model': '型號 {m}', 'p.rating': '推薦指數 {n}／5', 'custom': '自訂', 'customAcc': '自訂配件', 'example': '範例',
      'item.candidates': '尚未選定 · {n} 個候選產品', 'item.noProducts': '尚未加入產品',
      'del': '刪除 {name}', 'delAcc': '刪除配件 {name}', 'products': '{name}的產品', 'remove': '移除 {name}',
      'noProducts': '還沒有產品。從下方選單加入，或新增自訂產品。',
      'statusOf': '{name} 的狀態', 'status': '狀態', 'clearSel': '取消選定',
      'addProduct': '加入產品', 'addProduct.menu': '加入產品…', 'customProduct': '＋ 自訂產品', 'customProduct.cancel': '取消自訂產品',
      'f.brand': '品牌', 'f.brandPh': '選擇或輸入', 'f.name': '名稱', 'f.model': '型號', 'f.price': '建議售價', 'f.rating': '推薦指數', 'f.noRating': '不評分', 'f.stars': '{n} 星',
      'sel.empty': '點擊車上任一部位，或從上方清單選擇車項。打開車門或前後廂後，也能點選座椅、螢幕、行李箱等車內位置。',
      'sel.nopos': '這個車項在模型上沒有位置，配件只會列在清單中。',
      'sel.acc': '配件', 'sel.addMore': '再加一項配件', 'sel.add': '新增配件',
      'sel.customPh': '自訂配件名稱，例如雨刷', 'sel.customAria': '自訂配件名稱',
      'all.empty': '還沒有配件。點擊車身部位或選擇車項開始標註。',
      't.added': '已在「{part}」加入「{acc}」', 't.deleted': '已刪除「{name}」', 't.productAdded': '已加入產品',
      't.selected': '已選定「{name}」', 't.unselected': '已取消選定', 't.removed': '已移除「{name}」',
      't.status': '「{name}」改為{status}', 't.trim': '已切換為 {name}',
      't.opened': '{name}已開啟', 't.closed': '{name}已關閉', 'tip.dbl.open': ' · 雙擊開啟{name}', 'tip.dbl.close': ' · 雙擊關閉{name}',
      't.copyFallback': '已選取清單，請按 Ctrl＋C 或長按複製', 't.copied': '已複製，可直接貼到 Google Sheets',
      'copy.head': '編號\t車項\t配件\t分類\t品牌\t產品名稱\t型號\t建議售價\t推薦指數\t狀態\t候選產品數', 'copy.custom': '（自訂）',
      'err.generic': '發生錯誤，請稍後再試。', 'err.noFree': '這個版本沒有可用的免費模型。', 'err.generator': '前端不支援這個模型產生器：{g}',
      'err.noTrims': '目錄中沒有可用的 Model Y 版本。',
      'ex.ppf': '犀牛皮 PPF', 'ex.shade': '天窗遮陽簾', 'ex.rim': '輪框保護圈', 'ex.spoiler': '尾翼',
      'site.name': '配件檢視器', 'menu': '選單', 'menu.builds': '我的配置清單', 'menu.language': '語言', 'menu.theme': '主題', 'soon': '即將推出',
      'member.guest': '訪客', 'member.guestNote': '登入後可在不同裝置保存配置清單。', 'member.signIn': '登入／註冊', 'member.account': '帳號：{name}',
      'theme.auto': '跟隨系統', 'theme.lightTitle': '淺色', 'theme.darkTitle': '深色', 'loading.model': '正在載入車型…', 'panel.collapse': '收合面板', 'panel.expand': '展開面板',
      'sep': '、'
    },
    en: {
      'title': 'Model Y Accessory Viewer',
      'brand.sub': 'Accessory Viewer',
      'hint': 'Drag to rotate · Click a part to add accessories · Double-click a door, frunk or tailgate to open it',
      'mode': 'Offline demo data',
      'mode.title': 'Backend not connected — data is kept in this browser only',
      'loading': 'Loading vehicle data…',
      'loadFail': 'Couldn’t load vehicle data.',
      'disclaimer': 'The 3D vehicle is an illustrative model for paint and accessory placement, with manufacturer logos removed and details adjusted. This site has no official partnership with or authorization from Tesla, Inc.',
      'views': 'View', 'view.front': 'Front', 'view.left': 'Left', 'view.right': 'Right', 'view.rear': 'Rear', 'view.top': 'Top', 'view.reset': 'Reset',
      'trim': 'Trim',
      'tab.specs': 'Specs', 'tab.acc': 'Accessories', 'tab.doors': 'Doors', 'tab.paint': 'Paint',
      'sheet.expand': 'Expand panel', 'sheet.collapse': 'Collapse panel',
      'part': 'Part', 'part.choose': 'Choose a part…',
      'doors': 'Doors & trunks', 'openAll': 'Open all', 'closeAll': 'Close all', 'open': 'Open', 'closed': 'Closed',
      'paint': 'Paint', 'interior': 'Interior', 'interior.black': 'Black', 'interior.white': 'White',
      'all': 'All accessories', 'copy': 'Copy list', 'copyBuf': 'Accessory list (tab-separated)',
      'ref.nav': 'Referral links', 'ref.tesla': 'Order with Tesla referral', 'ref.teslaShort': 'Tesla referral', 'ref.jowua': 'Jowua accessories', 'ref.jowuaShort': 'Jowua',
      'ref.jowuaPanel': 'Shop Model Y accessories at Jowua',
      'ad': 'Ad', 'ad.sponsored': 'Sponsored', 'ad.slot': 'Ad slot',
      'gen': '{model} {gen} · MY{year} · {market}',
      'spec.length': 'Length', 'spec.height': 'Height', 'spec.width': 'Width (excl. mirrors)', 'spec.widthFolded': 'Width (mirrors folded)',
      'spec.wheelbase': 'Wheelbase', 'spec.clearance': 'Ground clearance', 'spec.track': 'Track F / R', 'spec.weight': 'Curb weight', 'spec.tires': 'Tires',
      'spec.tiresFR': 'Front {f} / Rear {r}',
      'spec.verified': 'Verified against the official site. Sources: {src}',
      'spec.unverifiedFlag': 'Unverified', 'spec.unverified': 'Not yet checked item by item against Tesla’s official site. Sources: {src}',
      'spec.summary': '{l} × {w} × {h} mm · Wheelbase {wb}',
      'status.none': 'Not purchased', 'status.purchased': 'Purchased', 'status.installed': 'Installed', 'status.unselected': 'Not selected',
      'p.model': 'Model {m}', 'p.rating': 'Rating {n}/5', 'custom': 'Custom', 'customAcc': 'Custom accessory', 'example': 'Example',
      'item.candidates': 'Not selected · {n} candidates', 'item.noProducts': 'No products yet',
      'del': 'Delete {name}', 'delAcc': 'Delete accessory {name}', 'products': 'Products for {name}', 'remove': 'Remove {name}',
      'noProducts': 'No products yet. Add one from the menu below, or create a custom product.',
      'statusOf': 'Status of {name}', 'status': 'Status', 'clearSel': 'Clear selection',
      'addProduct': 'Add product', 'addProduct.menu': 'Add product…', 'customProduct': '+ Custom product', 'customProduct.cancel': 'Cancel custom product',
      'f.brand': 'Brand', 'f.brandPh': 'Choose or type', 'f.name': 'Name', 'f.model': 'Model', 'f.price': 'Suggested price', 'f.rating': 'Rating', 'f.noRating': 'No rating', 'f.stars': '{n} stars',
      'sel.empty': 'Click any part of the car, or choose a part from the list above. Open a door, the frunk or the tailgate to reach seats, screens and the trunk.',
      'sel.nopos': 'This part has no position on the model, so its accessories appear only in the list.',
      'sel.acc': 'Accessories', 'sel.addMore': 'Add another accessory', 'sel.add': 'Add accessory',
      'sel.customPh': 'Custom accessory, e.g. wipers', 'sel.customAria': 'Custom accessory name',
      'all.empty': 'No accessories yet. Click a part of the car or choose one to start.',
      't.added': 'Added “{acc}” to {part}', 't.deleted': 'Deleted “{name}”', 't.productAdded': 'Product added',
      't.selected': 'Selected “{name}”', 't.unselected': 'Selection cleared', 't.removed': 'Removed “{name}”',
      't.status': '“{name}” set to {status}', 't.trim': 'Switched to {name}',
      't.opened': '{name} opened', 't.closed': '{name} closed', 'tip.dbl.open': ' · Double-click to open', 'tip.dbl.close': ' · Double-click to close',
      't.copyFallback': 'List selected — press Ctrl+C or long-press to copy', 't.copied': 'Copied — paste it straight into Google Sheets',
      'copy.head': 'No.\tPart\tAccessory\tCategory\tBrand\tProduct\tModel\tSuggested price\tRating\tStatus\tCandidates', 'copy.custom': ' (custom)',
      'err.generic': 'Something went wrong. Please try again.', 'err.noFree': 'No free model is available for this trim.', 'err.generator': 'Unsupported model generator: {g}',
      'err.noTrims': 'No Model Y trims are available in the catalog.',
      'ex.ppf': 'Paint protection film (PPF)', 'ex.shade': 'Glass roof sunshade', 'ex.rim': 'Rim protector', 'ex.spoiler': 'Rear spoiler',
      'site.name': 'Accessory Viewer', 'menu': 'Menu', 'menu.builds': 'My builds', 'menu.language': 'Language', 'menu.theme': 'Theme', 'soon': 'Coming soon',
      'member.guest': 'Guest', 'member.guestNote': 'Sign in to keep your builds across devices.', 'member.signIn': 'Sign in / Sign up', 'member.account': 'Account: {name}',
      'theme.auto': 'System', 'theme.lightTitle': 'Light', 'theme.darkTitle': 'Dark', 'loading.model': 'Loading the model…', 'panel.collapse': 'Collapse panel', 'panel.expand': 'Expand panel',
      'sep': ', '
    }
  };

  // 資料名稱的英文對照（以 code 為鍵；配件類型與車項分組目前沒有 code，以中文名稱為鍵）
  const DATA_EN = {
    part: {
      'front-bumper': 'Front bumper', 'rear-bumper': 'Rear bumper', 'frunk': 'Frunk lid', 'tailgate': 'Tailgate',
      'ffender-L': 'Front left fender', 'ffender-R': 'Front right fender', 'rfender-L': 'Rear left quarter panel', 'rfender-R': 'Rear right quarter panel',
      'skirt-L': 'Left side skirt', 'skirt-R': 'Right side skirt', 'charge-port': 'Charge port', 'body': 'Whole body',
      'fdoor-L': 'Front left door', 'handle-FL': 'Front left door handle', 'fdoor-R': 'Front right door', 'handle-FR': 'Front right door handle',
      'rdoor-L': 'Rear left door', 'handle-RL': 'Rear left door handle', 'rdoor-R': 'Rear right door', 'handle-RR': 'Rear right door handle',
      'mirror': 'Side mirrors', 'windshield': 'Windshield', 'side-glass': 'Side windows', 'rearglass': 'Rear window',
      'roof': 'Panoramic glass roof', 'roof-top': 'Roof', 'tire': 'Tires', 'rim': 'Wheels', 'aero-cover': 'Aero covers',
      'lights-front': 'Headlights / light bar', 'lights-rear': 'Taillights', 'screen': 'Front touchscreen', 'rear-screen': 'Rear touchscreen',
      'steer': 'Steering wheel', 'dash': 'Dashboard', 'console': 'Center console', 'seat-front': 'Front seats',
      'front-seatback': 'Front seatback protectors', 'seat-rear': 'Rear seats', 'rear-seatback': 'Rear seatback protectors',
      'floor': 'Floor', 'sill': 'Door sills', 'frunk-tub': 'Frunk', 'trunk': 'Trunk',
      'trunk-pocket-L': 'Trunk left side pocket', 'trunk-pocket-R': 'Trunk right side pocket', 'underbody': 'Underbody'
    },
    partGroup: {
      '外觀鈑件': 'Exterior panels', '車門與後照鏡': 'Doors & mirrors', '玻璃與車頂': 'Glass & roof', '輪胎與輪框': 'Tires & wheels',
      '燈具': 'Lights', '車內': 'Interior', '行李箱': 'Storage', '其他': 'Other'
    },
    accCategory: { exterior: 'Exterior', interior: 'Interior', safety: 'Safety', handling: 'Handling' },
    accType: { '隔熱紙': 'Window tint film', '玻璃鍍膜': 'Glass coating' },
    trim: { 'rwd': 'Rear-Wheel Drive', 'long-range-awd': 'Long Range AWD', 'performance': 'Performance AWD' },
    trimShort: { 'rwd': 'RWD', 'long-range-awd': 'Long Range', 'performance': 'Performance' },
    paint: {
      'stealth-grey': 'Stealth Grey', 'pearl-white': 'Pearl White', 'diamond-black': 'Diamond Black',
      'glacier-blue': 'Glacier Blue', 'quicksilver': 'Quicksilver', 'ultra-red': 'Ultra Red'
    },
    opening: { fdL: 'Front left door', fdR: 'Front right door', rdL: 'Rear left door', rdR: 'Rear right door', frunk: 'Frunk', tail: 'Tailgate' },
    generation: { juniper: 'Juniper' }
  };
  // 中文的短版本名稱（頂部分段鈕用）
  const DATA_ZH = {
    trimShort: { 'rwd': '後輪驅動', 'long-range-awd': 'Long Range', 'performance': 'Performance' },
    generation: { juniper: '煥新版（Juniper）' }
  };

  let lang = 'zh-Hant';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    const saved = localStorage.getItem(KEY);
    if (q === 'en' || q === 'zh-Hant') lang = q; else if (LANGS.includes(saved)) lang = saved;
  } catch (e) { /* 無法使用 storage 時維持預設 */ }

  const listeners = [];
  const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m)) : s);

  const i18n = {
    langs: LANGS,
    get lang() { return lang; },
    /** 介面字串 */
    t(key, vars) {
      const s = (UI[lang] && UI[lang][key]) ?? UI['zh-Hant'][key] ?? key;
      return fill(s, vars);
    },
    /** 資料名稱：kind = part / partGroup / accCategory / accType / trim / trimShort / paint / opening / generation */
    d(kind, key, fallback) {
      if (lang === 'en') { const v = DATA_EN[kind] && DATA_EN[kind][key]; if (v) return v; }
      else { const v = DATA_ZH[kind] && DATA_ZH[kind][key]; if (v) return v; }
      return fallback != null ? fallback : key;
    },
    setLang(next) {
      if (!LANGS.includes(next) || next === lang) return;
      lang = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* 只在本頁有效 */ }
      i18n.apply();
      listeners.forEach((fn) => fn(lang));
    },
    onChange(fn) { listeners.push(fn); },
    /** 套用到靜態 HTML：data-i18n（文字）、data-i18n-aria、data-i18n-title、data-i18n-ph */
    apply(root) {
      const r = root || document;
      document.documentElement.lang = lang;
      document.title = i18n.t('title');
      r.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = i18n.t(e.dataset.i18n); });
      r.querySelectorAll('[data-i18n-aria]').forEach((e) => e.setAttribute('aria-label', i18n.t(e.dataset.i18nAria)));
      r.querySelectorAll('[data-i18n-title]').forEach((e) => e.setAttribute('title', i18n.t(e.dataset.i18nTitle)));
      r.querySelectorAll('[data-i18n-tip]').forEach((e) => e.setAttribute('data-tip', i18n.t(e.dataset.i18nTip)));
      r.querySelectorAll('[data-i18n-ph]').forEach((e) => e.setAttribute('placeholder', i18n.t(e.dataset.i18nPh)));
    }
  };
  AV.i18n = i18n;
})();
