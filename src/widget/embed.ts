export function widgetEmbedScript(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  return `(function(){
  var script = document.currentScript;
  var token = script && script.getAttribute("data-token");
  var api = (script && script.getAttribute("data-api")) || ${JSON.stringify(base)};
  if (!token) { return; }
  var thread = localStorage.getItem("eab-thread-" + token) || (Date.now() + "-" + Math.random().toString(36).slice(2));
  localStorage.setItem("eab-thread-" + token, thread);
  var root = document.createElement("div");
  root.style.cssText = "position:fixed;bottom:16px;right:16px;width:320px;font-family:system-ui,sans-serif;z-index:9999";
  root.innerHTML = '<div style="background:#fff;border:1px solid #e7e5e4;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08);overflow:hidden"><div style="background:#f59e0b;color:#1c1917;padding:10px 12px;font-weight:600;font-size:14px">Chat</div><div id="eab-log" style="height:240px;overflow:auto;padding:8px;font-size:13px;color:#1c1917"></div><form id="eab-form" style="display:flex;border-top:1px solid #e7e5e4"><input id="eab-input" style="flex:1;border:0;padding:10px;font-size:13px" placeholder="Message"/><button style="border:0;background:#f59e0b;padding:0 12px;font-weight:600">Send</button></form></div>';
  document.body.appendChild(root);
  var log = root.querySelector("#eab-log");
  function add(role, text) {
    var p = document.createElement("div");
    p.style.margin = "6px 0";
    p.textContent = (role === "bot" ? "Bot: " : "You: ") + text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }
  async function poll() {
    try {
      var res = await fetch(api + "/widget/messages?token=" + encodeURIComponent(token) + "&thread=" + encodeURIComponent(thread));
      var data = await res.json();
      log.innerHTML = "";
      (data.messages || []).forEach(function(m){ add(m.role, m.text); });
    } catch (e) {}
  }
  root.querySelector("#eab-form").addEventListener("submit", async function(ev){
    ev.preventDefault();
    var input = root.querySelector("#eab-input");
    var text = input.value.trim();
    if (!text) return;
    input.value = "";
    await fetch(api + "/widget/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token, text: text, thread: thread }) });
    await poll();
  });
  poll();
  setInterval(poll, 4000);
})();`;
}
