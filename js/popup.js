document.addEventListener("DOMContentLoaded", function () {
  var status = document.getElementById("status");
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs[0]) return;
    var url = tabs[0].url || "";
    if (url.indexOf("buyin.jinritemai.com/dashboard/live/control") !== -1) {
      status.textContent = "✅当前在抖音直播中控台，面板已注入";
      status.style.color = "#52c41a";
    } else {
      status.textContent = "⚠️请打开抖音直播中控台";
      status.style.color = "#faad14";
    }
  });
  document.getElementById("reload").onclick = function () {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) { chrome.tabs.reload(tabs[0].id); window.close(); }
    });
  };
});
