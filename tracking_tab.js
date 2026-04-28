// ═══════════════════════════════════════════════════════════
//  tracking_tab.js — 顏色追蹤擴充（對應文件「影片操作進階」段落）
//  使用方式：在 index.html 中於 sketch.js 之後再載入此檔
//  <script src="tracking_tab.js"></script>
//
//  追蹤顏色：yellow、magenta、cyan
// ═══════════════════════════════════════════════════════════

// 動態載入 tracking.js 函式庫
var s = document.createElement("script");
s.type = "text/javascript";
s.src = "https://cdnjs.cloudflare.com/ajax/libs/tracking.js/1.1.3/tracking-min.js";
document.head.appendChild(s);

// 等 tracking.js 載入完成後初始化
s.onload = function () {

  // 建立 p5.js 攝影機，並給定 id 供 tracking.js 綁定
  // ⚠️ 這裡的 capture 須為全域變數（在 sketch.js 的 setup 裡建立）
  capture.position(0, 0);
  capture.id("myVideo");

  // 建立顏色追蹤器，指定要追蹤的顏色
  window.colors = new tracking.ColorTracker(['yellow', 'magenta', 'cyan']);

  // 綁定 DOM 影片元素
  tracking.track("#myVideo", window.colors);

  // 每次偵測更新時儲存資料
  window.trackData = null;
  window.colors.on('track', function (event) {
    window.trackData = event.data;
  });
};

// ── 在 sketch.js 的 draw() 最後加入以下程式碼即可顯示色塊 ──
//
// if (window.trackData) {
//   for (var i = 0; i < window.trackData.length; i++) {
//     let d = window.trackData[i];
//     fill(d.color);
//     noStroke();
//     rect(d.x, d.y, d.width, d.height);
//   }
// }
