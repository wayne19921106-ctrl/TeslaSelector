// 前端設定。apiBase 留空或後端無法連線時，改用 js/mock-data.js 的示範資料，
// 配置清單存在瀏覽器 localStorage。
(function () {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  window.APP_CONFIG = {
    // 本機開發連 .NET API；正式環境在後端部署後填入網址，例如 'https://api.example.com/api/v1'
    apiBase: local ? 'http://localhost:5080/api/v1' : '',
    market: 'TW',

    // 網站名稱與 logo（顯示在最上方工具列）。name 未填時用預設名稱；logo 為圖片網址，空字串時用內建圖示。
    site: { name: { 'zh-Hant': '', en: '' }, logo: '' },

    // 導購連結。url 為 '#' 或空字串時按鈕仍會顯示，但點了不會跳轉。
    referrals: {
      tesla: { url: '#' },   // Tesla 推薦連結，例如 https://ts.la/xxxx
      jowua: { url: '#' }    // Jowua 配件推薦連結
    },

    // Google Analytics 4。填入 Measurement ID（G-XXXXXXXXXX）才會載入 gtag。
    analytics: { gaMeasurementId: '' },

    // 廣告版位。enabled = false 時不顯示任何版位。
    // 網址加上 ?ads=preview 可預覽版位位置（顯示灰色佔位框）。
    // panel：網頁版面板底部 320×100；native：配件清單中的贊助卡片；
    // banner：網頁版 3D 區底部 728×90、平板抽屜底部 728×90、手機抽屜底部 320×50。
    // preview = true 時顯示灰色佔位框（等同網址加 ?ads=preview）。
    ads: { enabled: false, preview: false, slots: ['panel', 'native', 'banner'] },

    // 開發測試工具（規格分頁的「模型：參數化／GLB 檔案」切換）。網址加 ?dev=1 也會開啟。
    devTools: false
  };
})();
