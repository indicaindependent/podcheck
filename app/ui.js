/* PodCheck ui.js - progressive enhancement layer. app.js owns all logic; this file only
   renders nicer controls that write back into the same inputs, animates the result ring,
   and reads live engine facts from /health. No emoji, inline SVG only. */
(function () {
  "use strict";
  var API = "https://YOUR-WORKER-SUBDOMAIN.workers.dev";
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function fire(el) { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (e) {} }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- segmented controls rendered from <select data-seg>
  function segFor(sel) {
    var mode = sel.getAttribute("data-seg") || "chips";
    var host = document.createElement("div"); host.className = "seg " + (mode === "cards" ? "cards" : "chips"); host.setAttribute("role", "group");
    if (sel.getAttribute("aria-label")) host.setAttribute("aria-label", sel.getAttribute("aria-label"));
    var opts = $$("option", sel);
    opts.forEach(function (o) {
      var b = document.createElement("button"); b.type = "button"; b.textContent = o.textContent.trim(); b.dataset.v = o.value;
      if (o.value === "" || o.value === "unknown" || o.value === "unsure") b.classList.add("neutral");
      b.setAttribute("aria-pressed", String(o.selected));
      b.addEventListener("click", function () { if (sel.value === o.value) return; sel.value = o.value; fire(sel); buzz(6); sync(); });
      host.appendChild(b);
    });
    function sync() { $$("button", host).forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === sel.value)); }); }
    sel.addEventListener("change", sync);
    sel.parentNode.insertBefore(host, sel);
    sync();
  }
  $$("select[data-seg]").forEach(segFor);

  // ---- device tiles -> #check-device
  var devSel = $("#check-device"), tiles = $$("#device-tiles .tile");
  function syncTiles() { tiles.forEach(function (t) { t.setAttribute("aria-checked", String(t.dataset.device === devSel.value)); }); }
  if (devSel && tiles.length) {
    tiles.forEach(function (t) { t.addEventListener("click", function () { devSel.value = (devSel.value === t.dataset.device) ? "" : t.dataset.device; fire(devSel); buzz(8); syncTiles(); }); });
    devSel.addEventListener("change", syncTiles); syncTiles();
  }

  // ---- route highlighting for tab bar + top nav
  function route() { var h = (location.hash || "#home").replace("#", "").split("?")[0]; return h || "home"; }
  function paintNav() {
    var r = route(); var hi = r === "result" || r === "report" ? "check" : r;
    $$("[data-route]").forEach(function (a) { if (a.dataset.route === hi) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  window.addEventListener("hashchange", paintNav); paintNav();

  // ---- stepper: highlight the section in view
  var steps = $$(".stepper a[data-step]");
  if (steps.length && "IntersectionObserver" in window) {
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { seen[e.target.id] = true; steps.forEach(function (s) { s.classList.toggle("on", s.dataset.step === e.target.id); s.classList.toggle("done", !!seen[s.dataset.step] && s.dataset.step !== e.target.id); }); } });
    }, { rootMargin: "-35% 0px -55% 0px" });
    $$(".sec").forEach(function (s) { io.observe(s); });
    steps.forEach(function (s) { s.addEventListener("click", function (ev) { ev.preventDefault(); var t = document.getElementById(s.dataset.step); if (t) t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }); });
  }

  // ---- count-up numbers
  function countUp(el, to) {
    if (reduce) { el.textContent = String(to); return; }
    var t0 = performance.now(), dur = 900, from = 0;
    function tick(now) { var p = Math.min(1, (now - t0) / dur); p = 1 - Math.pow(1 - p, 3); el.textContent = String(Math.round(from + (to - from) * p)); if (p < 1) requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
  }

  // ---- live engine facts from /health (never typed in)
  fetch(API + "/health?ui=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (h) {
    if (!h || !h.ok) return;
    var v = $("#brand-ver"); if (v && h.version) v.textContent = "v" + h.version;
    var p = $("#live-products"); if (p && h.catalog_n) countUp(p, h.catalog_n);
    var u = $("#live-upcs"); if (u && h.upc_n) countUp(u, h.upc_n);
    $$("#about-live [data-h]").forEach(function (el) { var k = el.dataset.h; var val = h[k]; if (k === "dcc_api") val = val === "up" ? "reachable" : "unreachable (" + val + ")"; if (k === "version") val = "v" + val; if (val != null) el.textContent = String(val); });
    var upcHint = $("#check-upc ~ .hint"); if (upcHint && h.upc_n) upcHint.textContent = "Looked up against the " + h.upc_n + " barcodes turn publishes for its own products.";
  }).catch(function () { $$("#about-live [data-h]").forEach(function (el) { el.textContent = "unreachable"; }); });

  // ---- animate the score ring + number whenever a result renders
  var ri = $("#screen-result .result-inner");
  if (ri && "MutationObserver" in window) {
    new MutationObserver(function () {
      var fg = $(".score-ring-fg", ri), num = $(".score-num", ri);
      if (!fg || fg.dataset.anim) return; fg.dataset.anim = "1";
      var target = fg.getAttribute("stroke-dashoffset"), full = fg.getAttribute("stroke-dasharray");
      if (!reduce && target != null && full != null) { fg.setAttribute("stroke-dashoffset", full); void fg.getBoundingClientRect(); requestAnimationFrame(function () { requestAnimationFrame(function () { fg.setAttribute("stroke-dashoffset", target); }); }); }
      if (num) { var to = parseInt(num.textContent, 10); if (!isNaN(to)) countUp(num, to); }
      $$(".factor-bar-fill", ri).forEach(function (b) { var w = b.style.width; if (!reduce) { b.style.width = "0%"; requestAnimationFrame(function () { requestAnimationFrame(function () { b.style.width = w; }); }); } });
      buzz([10, 30, 10]);
    }).observe(ri, { childList: true });
  }
})();
