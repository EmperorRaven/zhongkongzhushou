// bridge-inject.js — 在页面上下文中创建 window.__ZKB__ 全局 API
// 任何标签页的 JS 都能通过 window.__ZKB__.explain(0) 等方法调用中控页功能

(function () {
  "use strict";

  if (window.__ZKB__) return; // 防止重复注入

  var reqCounter = 0;

  function call(action, params) {
    return new Promise(function (resolve) {
      var id = "zkb_" + (++reqCounter) + "_" + Date.now();

      function onResp(e) {
        if (e.data && e.data.source === "zkb-response" && e.data.id === id) {
          window.removeEventListener("message", onResp);
          resolve(e.data.result);
        }
      }
      window.addEventListener("message", onResp);

      // 15 秒超时
      setTimeout(function () {
        window.removeEventListener("message", onResp);
        resolve({ success: false, error: "timeout (15s)" });
      }, 15000);

      window.postMessage(
        { source: "zkb-call", id: id, action: action, params: params || {} },
        "*"
      );
    });
  }

  window.__ZKB__ = {
    // 获取商品列表 → Promise<{success, count, products: [{index, id, name, price, stock}]}>
    listProducts: function () {
      return call("list_products");
    },

    // 讲解指定商品 → Promise<{success, index, name, action}>
    explain: function (index) {
      return call("explain", { index: index });
    },

    // 取消讲解指定商品
    cancelExplain: function (index) {
      return call("cancel_explain", { index: index });
    },

    // 发送弹幕 → Promise<{success, text}>
    comment: function (text) {
      return call("comment", { text: text });
    },

    // 获取运行状态 → Promise<{success, autoExplainRunning, autoCommentRunning, ...}>
    getStatus: function () {
      return call("get_status");
    },
  };

  console.log("[中控助手] 跨标签页 API 已就绪: window.__ZKB__");
})();
