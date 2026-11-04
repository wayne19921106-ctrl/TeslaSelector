// 前端設定。apiBase 留空或後端無法連線時，改用 js/mock-data.js 的示範資料，
// 配置清單存在瀏覽器 localStorage。
(function () {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  window.APP_CONFIG = {
    // 本機開發連 .NET API；正式環境在後端部署後填入網址，例如 'https://api.example.com/api/v1'
    apiBase: local ? 'http://localhost:5080/api/v1' : '',
    market: 'TW'
  };
})();
