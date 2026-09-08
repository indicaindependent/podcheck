/* PodCheck app logic — vanilla JS, hash routing, no frameworks. */
(function () {
  "use strict";

  var BASE = "https://YOUR-WORKER-SUBDOMAIN.workers.dev";
  var LINKS = {
    ios: "https://apps.apple.com/us/app/turn-app/id6667101755",
    android: "https://play.google.com/store/apps/details?id=com.batchsys.turn",
    site: "https://turn.me"
  };
  var DCC_URL = "https://www.cannabis.ca.gov/resources/file-complaint/";

  // ---------- state ----------
  var state = {
    photos: { front: null, back: null, panel: null, code: null }, // {dataUrl, base64, blobForDownload}
    qrText: "",
    seller: { channel: "unknown", name: "", license: "", price_usd: null, city: "", product: "" },
    checks: { device: "", state: "", size: "", upc: "", window: "", inside: "", sticker: "", flavor: "", tags: "", effect: "" },
    analysis: null,
    registry: null,
    reportResult: null,
    contactOk: false,
    storeConsent: false,
    turnappResult: ""
  };

  // ---------- utils ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "html") e.innerHTML = attrs[k];
      else if (k === "text") e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }

  function toast(message, type) {
    var host = $("#toast-host");
    if (!host) return;
    var t = el("div", { class: "toast " + (type || "") });
    var iconName = type === "error" ? "x" : type === "warn" ? "bell" : "check";
    t.innerHTML = icon(iconName, 18) + '<span>' + message + '</span>';
    host.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 250);
    }, 3200);
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function isAndroid() { return /Android/.test(navigator.userAgent); }

  // ---------- age gate ----------
  function checkAgeGate() {
    var ok = localStorage.getItem("podcheck_age_ok");
    if (ok === "yes") return;
    showAgeGate();
  }
  function showAgeGate() {
    var modal = $("#age-gate");
    modal.classList.add("show");
  }
  function hideAgeGate() {
    $("#age-gate").classList.remove("show");
  }

  // ---------- image handling ----------
  function downscaleToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("Could not read file")); };
      reader.onload = function () {
        var img = new Image();
        img.onload = function () {
          var maxEdge = 1600;
          var w = img.width, h = img.height;
          var scale = Math.min(1, maxEdge / Math.max(w, h));
          var cw = Math.round(w * scale), ch = Math.round(h * scale);
          var canvas = document.createElement("canvas");
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          var dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          var base64 = dataUrl.split(",")[1];
          resolve({ dataUrl: dataUrl, base64: base64, canvas: canvas });
        };
        img.onerror = function () { reject(new Error("Could not decode image")); };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function decodeQrFromCanvas(canvas) {
    try {
      if (typeof jsQR !== "function") return null;
      var ctx = canvas.getContext("2d");
      var imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      var res = jsQR(imgData.data, imgData.width, imgData.height);
      return res ? res.data : null;
    } catch (e) { return null; }
  }

  var SLOTS = [
    { key: "inside", label: "Inside of the pouch", hint: "Open it and shoot the inside foil" },
    { key: "back", label: "Back label / sticker", hint: "The state compliance sticker, flat and lit" },
    { key: "code", label: "Code / QR", hint: "The QR code, close up" },
    { key: "front", label: "Front of package", hint: "Full front, flat and lit" }
  ];

  function slotCardHtml(slot) {
    var p = state.photos[slot.key];
    return (
      '<label class="photo-slot" for="file-' + slot.key + '" data-slot="' + slot.key + '">' +
        '<div class="photo-slot-thumb' + (p ? " has-image" : "") + '" id="thumb-' + slot.key + '">' +
          (p ? '<img src="' + p.dataUrl + '" alt="' + slot.label + ' preview">' :
            '<span class="photo-slot-icon">' + icon("edit", 22) + '</span>') +
        '</div>' +
        '<div class="photo-slot-meta">' +
          '<span class="photo-slot-title">' + slot.label + (p ? ' <span class="chip chip-success">Added</span>' : "") + '</span>' +
          '<span class="photo-slot-hint">' + slot.hint + '</span>' +
        '</div>' +
        '<input type="file" accept="image/*" capture="environment" id="file-' + slot.key + '" class="visually-hidden">' +
      '</label>'
    );
  }

  function wireSlotInputs() {
    SLOTS.forEach(function (slot) {
      var input = $("#file-" + slot.key);
      if (!input) return;
      input.addEventListener("change", function (e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        downscaleToBase64(file).then(function (result) {
          state.photos[slot.key] = result;
          if (slot.key === "code") {
            var decoded = decodeQrFromCanvas(result.canvas);
            if (decoded) {
              state.qrText = decoded;
              var destInput = $("#code-destination");
              if (destInput) destInput.value = decoded;
              toast("QR code decoded", "success");
            }
          }
          renderCheckSlots();
          updateRunCheckState();
          toast(slot.label + " added", "success");
        }).catch(function (err) {
          toast("Could not process photo: " + err.message, "error");
        });
      });
    });
  }

  function isPouchDevice(dev) { return !dev || dev === "podpak" || dev === "disposable" || dev === "hemp_podpak" || dev === "hemp_disposable"; }
  function applyDeviceToggle() {
    var dev = ($("#check-device") || {}).value || "";
    var podOnly = isPouchDevice(dev);
    var box = $("#pod-only-checks"), note = $("#pod-only-note");
    if (box) box.hidden = !podOnly;
    if (note) note.hidden = podOnly;
  }
  function renderCheckSlots() {
    var host = $("#photo-slots");
    if (!host) return;
    host.innerHTML = SLOTS.map(slotCardHtml).join("");
    wireSlotInputs();
  }

  function updateRunCheckState() {
    var btn = $("#run-check-btn");
    if (!btn) return;
    var hasPhoto = Object.keys(state.photos).some(function (k) { return !!state.photos[k]; });
    var hasCode = !!(state.qrText || ($("#code-destination") && $("#code-destination").value.trim()));
    var hasCheck = ["check-inside", "check-sticker", "seller-product", "check-tags"].some(function (id) { var el = $("#" + id); return !!(el && el.value && el.value.trim()); });
    btn.disabled = !(hasPhoto || hasCode || hasCheck);
  }

  // ---------- routing ----------
  var routes = ["home", "scan", "check", "result", "report", "stats", "about"];
  function currentRoute() {
    var h = location.hash.replace("#", "");
    return routes.indexOf(h) >= 0 ? h : "home";
  }
  function navigate(route) {
    location.hash = "#" + route;
  }
  function onHashChange() {
    var route = currentRoute();
    $all(".screen").forEach(function (s) { s.classList.remove("active"); });
    var target = $("#screen-" + route);
    if (target) target.classList.add("active");
    if (route === "result" && !state.analysis) { navigate("check"); return; }
    if (route === "report" && !state.analysis) { navigate("check"); return; }
    if (route !== "scan") stopScanner();
    if (route === "scan") startScanner();
    if (route === "check") { renderCheckSlots(); updateRunCheckState(); renderRegistryNote(); ["check-device", "check-state", "check-size", "check-upc", "check-window", "check-inside", "check-sticker", "seller-product", "check-tags", "check-effect", "code-destination"].forEach(function (id) { var el = $("#" + id); if (el && !el._pcWired) { el._pcWired = true; el.addEventListener("input", updateRunCheckState); el.addEventListener("change", updateRunCheckState); } }); var dev = $("#check-device"); if (dev && !dev._pcDevWired) { dev._pcDevWired = true; dev.addEventListener("change", applyDeviceToggle); } applyDeviceToggle(); }
    if (route === "result") renderResult();
    if (route === "report") renderReportScreen();
    if (route === "stats") loadStats();
    window.scrollTo(0, 0);
  }

  // ---------- HOME ----------
  function renderHome() {
    var ios = isIOS(), android = isAndroid();
    var showBoth = !ios && !android;
    var host = $("#screen-home .home-links");
    if (host) {
      host.innerHTML =
        '<a class="btn-open-turnapp" href="' + (ios ? LINKS.ios : android ? LINKS.android : LINKS.ios) + '" target="_blank" rel="noopener">' +
          icon("chevronRight", 16) + ' Open turnapp' + (ios ? " (iOS)" : android ? " (Android)" : " (iOS)") +
        '</a>' +
        (showBoth ? '<a class="btn-open-turnapp secondary-link" href="' + LINKS.android + '" target="_blank" rel="noopener">' +
          icon("chevronRight", 16) + ' Open turnapp (Android)</a>' : "");
    }
  }

  // ---------- seller form ----------
  function readSellerForm() {
    state.seller.channel = $("#seller-channel").value;
    state.seller.name = $("#seller-name").value.trim();
    state.seller.license = $("#seller-license").value.trim();
    var price = parseFloat($("#seller-price").value);
    state.seller.price_usd = isNaN(price) ? null : price;
    state.seller.city = $("#seller-city").value.trim();
    state.seller.product = $("#seller-product").value.trim();
    state.checks.device = ($("#check-device") || {}).value || "";
    state.checks.state = ($("#check-state") || {}).value || "";
    state.checks.size = ($("#check-size") || {}).value || "";
    state.checks.upc = (($("#check-upc") || {}).value || "").replace(/\D/g, "");
    var pouch = isPouchDevice(state.checks.device);
    state.checks.window = pouch ? (($("#check-window") || {}).value || "") : "";
    state.checks.inside = pouch ? (($("#check-inside") || {}).value || "") : "";
    state.checks.sticker = pouch ? (($("#check-sticker") || {}).value || "") : "";
    state.checks.flavor = state.seller.product;
    state.checks.tags = (($("#check-tags") || {}).value || "").trim();
    state.checks.effect = ($("#check-effect") || {}).value || "";
    var dest = $("#code-destination");
    if (dest) state.qrText = dest.value.trim() || null;
  }

  // ---------- run check ----------
  var FACTOR_STEPS = [
    { id: "code", label: "Code destination" },
    { id: "inside", label: "Inside of the pouch" },
    { id: "sticker", label: "Compliance sticker" },
    { id: "catalog", label: "Flavor vs turn's catalog" },
    { id: "panel", label: "State compliance label" },
    { id: "seller", label: "Seller licence" }
  ];

  function buildImagesPayload() {
    var images = [];
    SLOTS.forEach(function (slot) {
      var p = state.photos[slot.key];
      if (p) images.push({ kind: slot.key, data: p.base64 });
    });
    return images;
  }

  function runCheck() {
    readSellerForm();
    var btn = $("#run-check-btn");
    btn.disabled = true;
    var progressHost = $("#check-progress");
    progressHost.classList.add("show");
    progressHost.innerHTML =
      '<div class="progress-title">Running pre-screen<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>' +
      '<div class="progress-steps">' +
        FACTOR_STEPS.map(function (f, i) {
          return '<div class="progress-step" id="pstep-' + f.id + '" style="animation-delay:' + (i * 0.6) + 's">' +
            '<span class="progress-step-dot"></span><span>' + f.label + '</span></div>';
        }).join("") +
      '</div>';
    var stepEls = FACTOR_STEPS.map(function (f) { return $("#pstep-" + f.id); });
    var idx = 0;
    var lightInterval = setInterval(function () {
      if (idx < stepEls.length && stepEls[idx]) stepEls[idx].classList.add("lit");
      idx++;
      if (idx > stepEls.length) clearInterval(lightInterval);
    }, 900);

    var body = {
      qr_text: state.qrText || null,
      images: buildImagesPayload(),
      seller: state.seller,
      checks: state.checks
    };

    fetch(BASE + "/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 429) {
        throw { rateLimited: true };
      }
      if (!res.ok) throw new Error("Server returned " + res.status);
      return res.json();
    }).then(function (data) {
      clearInterval(lightInterval);
      stepEls.forEach(function (s) { if (s) s.classList.add("lit"); });
      setTimeout(function () {
        progressHost.classList.remove("show");
        state.analysis = data;
        btn.disabled = false;
        navigate("result");
      }, 500);
    }).catch(function (err) {
      clearInterval(lightInterval);
      progressHost.classList.remove("show");
      btn.disabled = false;
      if (err && err.rateLimited) {
        showCheckError("Rate limit reached. Please wait an hour and try again.");
      } else {
        showCheckError("Could not complete the check. " + (err && err.message ? err.message : "Network error") + ".");
      }
    });
  }

  function showCheckError(msg) {
    var host = $("#check-error");
    host.innerHTML =
      '<div class="inline-error">' +
        '<span>' + icon("x", 18) + '</span>' +
        '<span>' + msg + '</span>' +
        '<button class="btn-retry" id="check-retry-btn">Retry</button>' +
      '</div>';
    host.classList.add("show");
    $("#check-retry-btn").addEventListener("click", function () {
      host.classList.remove("show");
      runCheck();
    });
    toast(msg, "error");
  }

  // ---------- RESULT ----------
  // API returns band KEYS (likely_authentic / could_not_verify / signs_of_counterfeit) and a human label.
  var BAND_META = {
    "likely_authentic": { cls: "band-green", color: "var(--success)", label: "Likely authentic" },
    "could_not_verify": { cls: "band-amber", color: "var(--warn)", label: "Could not verify" },
    "signs_of_counterfeit": { cls: "band-red", color: "var(--danger)", label: "Signs of counterfeit" }
  };
  // API factor status keys -> chip label + class
  var STATUS_META = {
    "measured": { cls: "chip-success", label: "Measured" },
    "not_read": { cls: "chip-muted", label: "Not read" },
    "not_checked": { cls: "chip-muted", label: "Not checked" },
    "not_supplied": { cls: "chip-muted", label: "Not supplied" },
    "not_applicable": { cls: "chip-muted", label: "Skipped - not applicable" },
    "unavailable": { cls: "chip-muted", label: "Unavailable" },
    "capped": { cls: "chip-warn", label: "Capped" }
  };

  function renderResult() {
    var a = state.analysis;
    if (!a) return;
    var host = $("#screen-result .result-inner");
    var meta = BAND_META[a.band] || BAND_META["could_not_verify"];
    var bandLabel = meta.label || a.label || "Could not verify";
    var denom = a.denominator || 0;
    var score = Math.max(0, Math.min(100, a.score || 0));
    var circumference = 2 * Math.PI * 54;
    var dash = (score / 100) * circumference;

    var factorsHtml = (a.factors || []).map(function (f) {
      var sm = STATUS_META[f.status] || { cls: "chip-muted", label: String(f.status || "").replace(/_/g, " ") };
      var pct = f.weight ? Math.max(0, Math.min(100, (f.points / f.weight) * 100)) : 0;
      return (
        '<div class="factor-row">' +
          '<div class="factor-row-top">' +
            '<span class="factor-name">' + f.name + '</span>' +
            '<span class="chip ' + sm.cls + '">' + sm.label + '</span>' +
          '</div>' +
          '<div class="factor-bar-track"><div class="factor-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="factor-row-bottom">' +
            '<span class="factor-points">' + f.points + ' / ' + f.weight + (f.cap ? ' (cap ' + f.cap + ')' : '') + '</span>' +
          '</div>' +
          (f.detail ? '<div class="factor-detail">' + f.detail + '</div>' : '') +
        '</div>'
      );
    }).join("");

    var ios = isIOS(), android = isAndroid();
    var deepLink = ios ? LINKS.ios : android ? LINKS.android : LINKS.ios;

    host.innerHTML =
      '<div class="score-ring-wrap">' +
        '<svg viewBox="0 0 120 120" class="score-ring">' +
          '<circle cx="60" cy="60" r="54" class="score-ring-bg"/>' +
          '<circle cx="60" cy="60" r="54" class="score-ring-fg ' + meta.cls + '" ' +
            'stroke-dasharray="' + circumference + '" stroke-dashoffset="' + (circumference - dash) + '"/>' +
        '</svg>' +
        '<div class="score-ring-center">' +
          '<span class="score-num">' + score + '</span>' +
          '<span class="score-denom">/ 100</span>' +
        '</div>' +
      '</div>' +
      '<div class="band-label ' + meta.cls + '">' + bandLabel + '</div>' +
      (denom && denom < 100
        ? '<div class="band-sublabel">Scored on ' + denom + ' of 100 available weight - factors that could not be measured were left out, not counted against the package.</div>'
        : '') +
      (a.lean === "genuine" ? '<div class="band-sublabel"><strong>Leaning genuine.</strong> turn\'s own checks all pass, but no state code was verified - scan the QR (or check in turnapp) to close it out.</div>' :
       a.lean === "counterfeit" ? '<div class="band-sublabel"><strong>Leaning counterfeit.</strong> Not enough measured to call it, but what was measured points the wrong way.</div>' : '') +
      '<div class="next-step-box"><strong>What happens next</strong><p>' + (a.next_step || "") + '</p></div>' +
      '<div class="verify-note">' + icon("bell", 16) + ' The only verification is a scan inside the official turnapp.</div>' +
      '<div class="factor-list">' + factorsHtml + '</div>' +
      (a.caps_applied && a.caps_applied.length
        ? '<div class="caps-note">' + icon("tag", 14) + ' Score capped at ' + Math.min.apply(null, a.caps_applied) + ' by a hard signal - see the factor marked with a cap below.</div>'
        : '') +
      (a.vision_note ? '<div class="vision-note">' + a.vision_note + '</div>' : '') +
      '<div class="wont-scan-note"><strong>Won\'t scan in turnapp?</strong> A genuine unit that fails to scan is a support case for turn — not proof of a counterfeit. Contact turn support before assuming the worst.</div>' +
      '<div class="result-actions">' +
        '<a class="btn primary big-tap" href="' + deepLink + '" target="_blank" rel="noopener">' + icon("chevronRight", 18) + ' Verify in turnapp</a>' +
        '<button class="btn big-tap" id="retake-btn">' + icon("edit", 18) + ' Retake photos</button>' +
        (a.band !== "likely_authentic"
          ? '<button class="btn big-tap btn-report" id="build-report-btn">' + icon("inbox", 18) + ' Build a report</button>'
          : '<a class="secondary-link" href="#report" id="build-report-link">Build a report anyway</a>') +
      '</div>' +
      '<div class="disclaimer-box">' + (a.disclaimer || "Independent pre-screen. Not a substitute for official verification.") + '</div>';

    var retakeBtn = $("#retake-btn");
    if (retakeBtn) retakeBtn.addEventListener("click", function () { navigate("check"); });
    var reportBtn = $("#build-report-btn");
    if (reportBtn) reportBtn.addEventListener("click", function () { navigate("report"); });
  }

  // ---------- REPORT ----------
  function renderReportScreen() {
    var host = $("#screen-report .report-inner");
    if (state.reportResult) {
      renderReportResult(host);
      return;
    }
    host.innerHTML =
      '<p class="report-intro">Nothing is sent automatically. We draft the message for you to review and send yourself.</p>' +
      '<label class="checkbox-row">' +
        '<input type="checkbox" id="consent-store">' +
        '<span>Store my photos (metadata removed) so they can be attached to this report. Required to continue.</span>' +
      '</label>' +
      '<div class="field">' +
        '<label class="field-label" for="turnapp-result">What happened in turnapp?</label>' +
        '<textarea id="turnapp-result" rows="3" style="width:100%;box-sizing:border-box" placeholder="e.g. Code would not scan, or scanned as already redeemed"></textarea>' +
      '</div>' +
      '<label class="checkbox-row">' +
        '<input type="checkbox" id="consent-contact">' +
        '<span>Turn or the state regulator may contact me about this report.</span>' +
      '</label>' +
      '<button class="btn primary big-tap" id="build-report-btn2">' + icon("check", 18) + ' Build report</button>' +
      '<div id="report-error"></div>';

    $("#build-report-btn2").addEventListener("click", function () {
      var consentEl = $("#consent-store");
      if (!consentEl.checked) {
        toast("Please check the storage consent box to continue", "warn");
        return;
      }
      state.storeConsent = true;
      state.contactOk = $("#consent-contact").checked;
      state.turnappResult = $("#turnapp-result").value.trim();
      submitReport();
    });
  }

  function submitReport() {
    var btn = $("#build-report-btn2");
    btn.disabled = true;
    btn.innerHTML = icon("check", 18) + ' Building...';
    var body = {
      analysis: state.analysis,
      images: buildImagesPayload(),
      seller: state.seller,
      contact: { ok_to_contact: state.contactOk },
      turnapp_result: state.turnappResult,
      consent_store: true
    };
    fetch(BASE + "/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (res.status === 429) throw { rateLimited: true };
      if (!res.ok) throw new Error("Server returned " + res.status);
      return res.json();
    }).then(function (data) {
      state.reportResult = data;
      toast("Report drafted", "success");
      renderReportScreen();
    }).catch(function (err) {
      btn.disabled = false;
      btn.innerHTML = icon("check", 18) + ' Build report';
      var msg = err && err.rateLimited
        ? "Rate limit reached. Please wait an hour and try again."
        : "Could not build report. " + (err && err.message ? err.message : "Network error") + ".";
      var errHost = $("#report-error");
      errHost.innerHTML =
        '<div class="inline-error"><span>' + icon("x", 18) + '</span><span>' + msg + '</span>' +
        '<button class="btn-retry" id="report-retry-btn">Retry</button></div>';
      $("#report-retry-btn").addEventListener("click", submitReport);
      toast(msg, "error");
    });
  }

  function renderReportResult(host) {
    var r = state.reportResult;
    host.innerHTML =
      '<div class="report-success-badge">' + icon("check", 18) + ' Report drafted</div>' +
      '<label class="field-label" for="narrative-box">Narrative</label>' +
      '<textarea id="narrative-box" rows="8" readonly>' + String(r.narrative || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</textarea>' +
      '<button class="btn" id="copy-narrative-btn">' + icon("edit", 16) + ' Copy</button>' +
      '<div class="report-channels">' +
        (r.channels && r.channels.turn
          ? '<a class="btn primary big-tap" href="' + r.channels.turn.mailto + '">' + icon("chevronRight", 18) + ' Email Turn</a>'
          : "") +
        (r.channels && r.channels.dcc
          ? '<a class="btn big-tap" href="' + r.channels.dcc.url + '" target="_blank" rel="noopener">' + icon("chevronRight", 18) + ' Open CA DCC complaint form</a>' +
            '<div class="dcc-guidance">' + (r.channels.dcc.guidance || "") + '</div>'
          : "") +
        '<button class="btn big-tap" id="download-photos-btn">' + icon("chevronDown", 18) + ' Download photos</button>' +
      '</div>' +
      '<div class="pack-id">Report ID: ' + (r.pack_id || "—") + '</div>' +
      (r.note ? '<div class="report-note">' + r.note + '</div>' : "");

    $("#copy-narrative-btn").addEventListener("click", function () {
      var box = $("#narrative-box");
      box.select();
      navigator.clipboard && navigator.clipboard.writeText(box.value).then(function () {
        toast("Copied to clipboard", "success");
      }).catch(function () {
        document.execCommand("copy");
        toast("Copied to clipboard", "success");
      });
    });
    var dlBtn = $("#download-photos-btn");
    if (dlBtn) dlBtn.addEventListener("click", downloadAllPhotos);
  }

  function downloadAllPhotos() {
    var any = false;
    SLOTS.forEach(function (slot, i) {
      var p = state.photos[slot.key];
      if (!p) return;
      any = true;
      setTimeout(function () {
        var a = document.createElement("a");
        a.href = p.dataUrl;
        a.download = "podcheck-" + slot.key + ".jpg";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 300);
    });
    if (any) toast("Downloading photos", "success");
    else toast("No photos to download", "warn");
  }

  // ---------- STATS ----------
  function shimmerBars(n) {
    var html = "";
    for (var i = 0; i < n; i++) {
      html += '<div class="skeleton-bar shimmer"></div>';
    }
    return html;
  }
  function loadStats() {
    var host = $("#screen-stats .stats-inner");
    host.innerHTML =
      '<div class="stats-skel">' + shimmerBars(3) + '</div>' +
      '<div class="stats-skel">' + shimmerBars(3) + '</div>';
    fetch(BASE + "/stats").then(function (res) {
      if (!res.ok) throw new Error("Server returned " + res.status);
      return res.json();
    }).then(function (data) {
      renderStats(host, data);
    }).catch(function (err) {
      host.innerHTML =
        '<div class="inline-error"><span>' + icon("x", 18) + '</span>' +
        '<span>Could not load stats. ' + err.message + '</span>' +
        '<button class="btn-retry" id="stats-retry-btn">Retry</button></div>';
      $("#stats-retry-btn").addEventListener("click", loadStats);
    });
  }

  function bandBarsHtml(bandObj) {
    // /stats keys bands by API key (likely_authentic ...), not by label
    var bands = ["likely_authentic", "could_not_verify", "signs_of_counterfeit"];
    var max = Math.max(1, bands.reduce(function (m, b) { return Math.max(m, (bandObj && bandObj[b]) || 0); }, 0));
    return bands.map(function (b) {
      var v = (bandObj && bandObj[b]) || 0;
      var pct = Math.max(4, (v / max) * 100);
      var bm = BAND_META[b];
      return '<div class="stat-bar-row">' +
        '<span class="stat-bar-label">' + bm.label + '</span>' +
        '<div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%;background:' + bm.color + '"></div></div>' +
        '<span class="stat-bar-val">' + v + '</span>' +
      '</div>';
    }).join("");
  }

  var SCAN_META = [
    ["verified", "Verified in the state registry", "var(--success)"],
    ["not_found", "State code, no registry record", "var(--danger)"],
    ["not_state_registry", "Not a state registry code", "var(--warn)"],
    ["malformed_retail_id", "Registry code, unreadable", "var(--warn)"],
    ["registry_error", "Registry unavailable (not counted either way)", "var(--muted)"],
    ["fetch_error", "Could not reach registry", "var(--muted)"],
    ["signet_unresolved", "Short link did not resolve", "var(--muted)"]
  ];
  function scanBarsHtml(obj) {
    obj = obj || {};
    var rows = SCAN_META.filter(function (m) { return (obj[m[0]] || 0) > 0; });
    if (!rows.length) return '<p class="muted small stats-empty">No scans counted yet.</p>';
    var max = rows.reduce(function (m, r) { return Math.max(m, obj[r[0]] || 0); }, 1);
    return rows.map(function (m) {
      var v = obj[m[0]] || 0, pct = Math.max(4, (v / max) * 100);
      return '<div class="stat-bar-row"><span class="stat-bar-label">' + m[1] + '</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + pct + '%;background:' + m[2] + '"></div></div><span class="stat-bar-val">' + v + '</span></div>';
    }).join("");
  }
  function statTile(num, label, cls) { return '<div class="stats-meta-item"><span class="stats-meta-num' + (cls ? " " + cls : "") + '">' + num + '</span><span>' + label + '</span></div>'; }
  function renderStats(host, data) {
    var sc = data.scans || {}, ch = data.checks || { all_time: data.all_time || {}, last_7_days: data.last_7_days || {}, total: 0 };
    var byState = sc.verified_units_by_state || sc.verified_by_state || {};
    var stateRows = Object.keys(byState).sort().map(function (k) { return '<div class="fact"><span class="fact-k">' + esc(k) + '</span><span class="fact-v">' + esc(byState[k]) + ' unit' + (byState[k] === 1 ? "" : "s") + (sc.verified_by_state && sc.verified_by_state[k] !== byState[k] ? ' · ' + esc(sc.verified_by_state[k]) + ' scans' : "") + '</span></div>'; }).join("");
    var matchTotal = (sc.matched_in_hand || 0) + (sc.mismatched_in_hand || 0);
    var since = sc.since ? new Date(sc.since) : null;
    host.innerHTML =
      '<div class="stats-meta-row">' +
        statTile(sc.verified_units != null ? sc.verified_units : "—", "Units verified with a state", "") +
        statTile(sc.total != null ? sc.total : "—", "Codes scanned", "num-neutral") +
      '</div>' +
      '<div class="card stats-card"><h3>Scan outcomes</h3><p class="muted small">Every code scanned, by what the state registry said. All time.</p>' + scanBarsHtml(sc.all_time) + '</div>' +
      '<div class="card stats-card"><h3>Last 7 days</h3>' + scanBarsHtml(sc.last_7_days) + '</div>' +
      (stateRows ? '<div class="card stats-card"><h3>Verified units by state</h3><div class="facts">' + stateRows + '</div></div>' : "") +
      '<div class="card stats-card"><h3>Did the registry match the package in hand?</h3>' +
        (matchTotal ? '<div class="facts"><div class="fact"><span class="fact-k">Matched</span><span class="fact-v">' + sc.matched_in_hand + '</span></div><div class="fact"><span class="fact-k">Did not match</span><span class="fact-v">' + sc.mismatched_in_hand + '</span></div>' + (sc.recalled_units_seen ? '<div class="fact"><span class="fact-k">On state recall</span><span class="fact-v">' + sc.recalled_units_seen + '</span></div>' : "") + '</div>' : '<p class="muted small stats-empty">No answers yet. After a verified scan, users are asked whether the registry record matches the package in hand.</p>') +
      '</div>' +
      '<div class="card stats-card"><h3>Evidence checks</h3><p class="muted small">Photo walkthroughs run when a code could not be verified.</p>' + (ch.total ? bandBarsHtml(ch.all_time) : '<p class="muted small stats-empty">No evidence checks yet.</p>') + '</div>' +
      '<div class="stats-meta-row">' +
        statTile(data.reports_drafted != null ? data.reports_drafted : "—", "Reports drafted", "num-neutral") +
        statTile(data.licence_lookups ? Object.keys(data.licence_lookups).reduce(function (t, k) { return t + (data.licence_lookups[k] || 0); }, 0) : 0, "Licence lookups", "num-neutral") +
      '</div>' +
      '<p class="stats-note">Anonymous counts only. Test traffic is excluded.' + (since ? ' Counting since ' + since.toISOString().slice(0, 10) + '.' : '') + '</p>';
  }

  // ---------- init ----------
  function bindStaticUI() {
    $("#age-yes").addEventListener("click", function () {
      localStorage.setItem("podcheck_age_ok", "yes");
      hideAgeGate();
    });
    $("#age-no").addEventListener("click", function () {
      $("#age-gate .age-gate-body").innerHTML =
        '<h2>Come back later</h2><p>PodCheck is for adults 21 and older in legal state markets. Please check back when you meet the age requirement.</p>';
    });

    $all("[data-nav]").forEach(function (btn) {
      btn.addEventListener("click", function () { navigate(btn.getAttribute("data-nav")); });
    });

    var runBtn = $("#run-check-btn");
    if (runBtn) runBtn.addEventListener("click", runCheck);

    var destInput = document.getElementById("code-destination");
    if (destInput) destInput.addEventListener("input", function () {
      state.qrText = destInput.value.trim();
      updateRunCheckState();
    });

    var priceInput = $("#seller-price");
    if (priceInput) priceInput.addEventListener("input", function () { });

    window.addEventListener("hashchange", onHashChange);
  }


  // ======================================================================
  // SCAN-FIRST FLOW (v2, Sep 7 2026) - state track-and-trace lookup
  // The QR on a legal NY/CA unit opens app.1a4.com/landingpage/<id> (Metrc Retail ID).
  // We decode it live, ask our API to resolve it in the state registry, then branch:
  // verified -> celebrate + registry facts + "does this match?" ; not found -> evidence flow.
  // ======================================================================
  var scan = { stream: null, track: null, raf: null, busy: false, active: false, detector: null, lastTick: 0, frames: 0, result: null, text: "", zx: null };

  function scanStatus(msg, cls) {
    var el = $("#scan-status"); if (!el) return;
    el.textContent = msg; el.className = "scan-status" + (cls ? " " + cls : "");
  }

  function scannerSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  function getDetector() {
    if (scan.detector) return scan.detector;
    if ("BarcodeDetector" in window) {
      try { scan.detector = new window.BarcodeDetector({ formats: ["qr_code"] }); return scan.detector; } catch (e) { }
    }
    return null;
  }

  // Decode an ImageData / canvas region with whatever engine exists: BarcodeDetector -> zxing-wasm -> jsQR
  function decodeCanvasAsync(canvas) {
    var det = getDetector();
    if (det) {
      return det.detect(canvas).then(function (codes) { return codes && codes.length ? codes[0].rawValue : null; }).catch(function () { return decodeCanvasFallback(canvas); });
    }
    return decodeCanvasFallback(canvas);
  }
  // Contrast-stretch to grayscale (2nd..98th percentile) - the single biggest win for dim, glossy labels.
  function stretchContrast(img) {
    var d = img.data, n = d.length / 4, hist = new Uint32Array(256), i, y;
    var gray = new Uint8ClampedArray(n);
    for (i = 0; i < n; i++) { y = (d[i * 4] * 77 + d[i * 4 + 1] * 151 + d[i * 4 + 2] * 28) >> 8; gray[i] = y; hist[y]++; }
    var lo = 0, hi = 255, acc = 0, cut = n * 0.02;
    for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= cut) { lo = i; break; } }
    acc = 0; for (i = 255; i >= 0; i--) { acc += hist[i]; if (acc >= cut) { hi = i; break; } }
    if (hi - lo < 8) return { img: img, mean: lo };
    var scale = 255 / (hi - lo), sum = 0;
    for (i = 0; i < n; i++) { y = (gray[i] - lo) * scale; y = y < 0 ? 0 : y > 255 ? 255 : y; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = y; sum += gray[i]; }
    return { img: img, mean: sum / n, lo: lo, hi: hi };
  }
  function zxingOpts() { return { formats: ["QRCode"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, binarizer: "LocalAverage", maxNumberOfSymbols: 1 }; }
  function decodeCanvasFallback(canvas) {
    var ctx = canvas.getContext("2d");
    var raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
    var pre = stretchContrast(ctx.getImageData(0, 0, canvas.width, canvas.height));
    scan.lastMean = pre.mean;
    var img = pre.img;
    if (typeof window.__zxingRead === "function") {
      return Promise.resolve().then(function () { return window.__zxingRead(raw, zxingOpts()); })
        .then(function (r) { if (r && r.length && r[0].text) return r[0].text; return jsqrOn(raw) || window.__zxingRead(img, zxingOpts()); })
        .then(function (r) { if (typeof r === "string") return r; return r && r.length && r[0].text ? r[0].text : jsqrOn(img); })
        .catch(function () { return jsqrOn(raw) || jsqrOn(img); });
    }
    return Promise.resolve(jsqrOn(raw) || jsqrOn(img));
  }
  function jsqrOn(img) {
    try { if (typeof jsQR !== "function") return null; var r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" }); return r ? r.data : null; } catch (e) { return null; }
  }

  // Draw a crop of the video (fraction of the shorter side) scaled to `out` px square. Small codes need the upscale.
  function cropFrame(video, frac, out) {
    var vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
    var side = Math.floor(Math.min(vw, vh) * frac);
    var sx = Math.floor((vw - side) / 2), sy = Math.floor((vh - side) / 2);
    var c = document.createElement("canvas"); c.width = out; c.height = out;
    var g = c.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(video, sx, sy, side, side, 0, 0, out, out);
    return c;
  }

  var SELFTEST_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHQAAAB0CAAAAABx8Un7AAABnUlEQVR4nO1ayw7DIAwz0/7/l7vLkGhIQpAqQmV8aVdKkOzlBS0X1uOTsOZZ9Cz64kW/9aY4L13/8dani/PcswMw0ZurKXDXpqI0Y62O3hzPDsBEb76mgK+X9EvLV0d2eOjdQ1MLWkyVPhsFD717awrcNZRaar5qgYfePTSN6CL11PzVs8NDb76m0Thq1UtROzz05moa9c9RDo3Y4aE3vz+1+s8Kre6FmCMha2SAid6URYu2X2D5mtRZ01Y+02zx0PsOP23vNR+Wc7V6mIfe/BqpxSWu3ntyrwno/xMn9i5DF3ut/aDI3mA0BvPQm6tpJJfKcasnHdnioXePXmamT4nM0cBD7175FOg18+KwVT+d2Lsc3fmpzJfa2Yum58z5Kw+9+TWS++L/qu0hWLnW8mMeevfwUw1WLez1MHK8BQ+9+fk08p0DxG+rbtLmVPDQm68pEO89Z89jTj5dhvCZuOWn1lm4dx7HQ+/emgJ9vJ3dN6zgoXcPTT2dRv0MoNdKEjz05ms6yoftdfb7spNPlyHcnz4JHnrPomfRR/ADEKd3CvajieYAAAAASUVORK5CYII=";
  function engineSelfTest() {
    if (scan.engineLabel) return Promise.resolve(scan.engineLabel);
    return new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () {
        var c = document.createElement("canvas"); c.width = 348; c.height = 348;
        var g = c.getContext("2d"); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, 348, 348);
        var eng = getDetector() ? "native" : (typeof window.__zxingRead === "function" ? "zxing" : (typeof jsQR === "function" ? "jsqr" : "none"));
        decodeCanvasAsync(c).then(function (t) {
          scan.engineLabel = (t === "podcheck-selftest") ? eng + " ok" : eng + " FAILED";
          resolve(scan.engineLabel);
        }).catch(function () { scan.engineLabel = eng + " FAILED"; resolve(scan.engineLabel); });
      };
      im.onerror = function () { scan.engineLabel = "selftest image error"; resolve(scan.engineLabel); };
      im.src = SELFTEST_PNG;
    });
  }
  function startScanner() {
    var video = $("#scan-video"); if (!video) return;
    engineSelfTest().then(function (lbl) { var h = $("#scan-hint"); if (h) h.setAttribute("data-engine", lbl); var e = $("#scan-engine"); if (e) e.textContent = "Decoder: " + lbl; });
    $("#scan-result").innerHTML = ""; scan.result = null; scan.text = "";
    if (!scannerSupported()) { scanStatus("Live camera is not available in this browser. Use the photo button below.", "warn"); return; }
    scan.active = true;
    scanStatus("Starting camera...");
    var constraints = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } } };
    scan.startedAt = performance.now(); scan.autoZoomStep = 0; scan.torchAuto = false; scan.lastMean = 128;
    navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
      if (!scan.active) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = stream; scan.track = stream.getVideoTracks()[0];
      video.srcObject = stream;
      return video.play().catch(function () { });
    }).then(function () {
      if (!scan.active) return;
      setupTrackControls();
      scanStatus("Looking for a code. Fill the frame, hold still.");
      scan.frames = 0; scan.lastTick = 0;
      scanLoop();
    }).catch(function (err) {
      scanStatus("Camera blocked or unavailable (" + (err && err.name || "error") + "). Use the photo button below, or paste the link.", "warn");
    });
  }

  function setupTrackControls() {
    var caps = {}; try { caps = scan.track.getCapabilities ? scan.track.getCapabilities() : {}; } catch (e) { }
    var torch = $("#scan-torch"), zoom = $("#scan-zoom");
    if (torch) {
      if (caps.torch) {
        torch.hidden = false; torch.onclick = function () {
          var on = torch.getAttribute("data-on") === "1";
          scan.track.applyConstraints({ advanced: [{ torch: !on }] }).then(function () { torch.setAttribute("data-on", on ? "0" : "1"); torch.textContent = on ? "Light" : "Light off"; }).catch(function () { });
        };
      } else torch.hidden = true;
    }
    if (zoom) {
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        zoom.hidden = false; zoom.min = caps.zoom.min; zoom.max = Math.min(caps.zoom.max, caps.zoom.min * 4 || 4); zoom.step = caps.zoom.step || 0.1;
        var settings = scan.track.getSettings ? scan.track.getSettings() : {}; zoom.value = settings.zoom || caps.zoom.min;
        zoom.oninput = function () { scan.userZoomed = true; scan.track.applyConstraints({ advanced: [{ zoom: parseFloat(zoom.value) }] }).catch(function () { }); };
      } else zoom.hidden = true;
    }
    try { if (caps.focusMode && caps.focusMode.indexOf("continuous") >= 0) scan.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(function () { }); } catch (e) { }
  }

  function scanLoop() {
    if (!scan.active) return;
    scan.raf = requestAnimationFrame(scanLoop);
    var now = performance.now();
    if (scan.busy || now - scan.lastTick < 140) return;
    scan.lastTick = now; scan.busy = true; scan.frames++;
    var video = $("#scan-video");
    // rotate three crops: tight centre (small codes, upscaled), mid, near-full frame
    var k = scan.frames % 3;
    var c = cropFrame(video, k === 0 ? 0.36 : k === 1 ? 0.6 : 0.92, k === 2 ? 1200 : 1000);
    if (!c) { scan.busy = false; return; }
    decodeCanvasAsync(c).then(function (text) {
      scan.busy = false;
      if (text && scan.active) { onCodeDecoded(text, "camera"); return; }
      autoAssist();
      if (scan.frames === 45) scanStatus("Still looking. Move closer so the code fills the box - or tap the photo button for a full-resolution read.", "");
      else if (scan.frames === 140) scanStatus("Small or glossy codes are hard live. The photo button reads at full resolution and works in dim light.", "warn");
    }).catch(function () { scan.busy = false; });
  }

  // Behave like the phone camera app: light up when it is dark, zoom in when nothing decodes.
  function autoAssist() {
    if (!scan.track || !scan.active) return;
    var caps = {}; try { caps = scan.track.getCapabilities ? scan.track.getCapabilities() : {}; } catch (e) { }
    var elapsed = performance.now() - (scan.startedAt || 0);
    var torch = $("#scan-torch");
    if (scan.lastMean < 70 && !scan.torchAuto) {
      scan.torchAuto = true;
      if (caps.torch) {
        scan.track.applyConstraints({ advanced: [{ torch: true }] }).then(function () { if (torch) { torch.setAttribute("data-on", "1"); torch.textContent = "Light off"; } scanStatus("Low light - turned the light on.", "ok"); }).catch(function () { });
      } else scanStatus("Low light and this camera has no light. Move under a lamp, or use the photo button with flash.", "warn");
    }
    if (caps.zoom && caps.zoom.max > caps.zoom.min) {
      var zoom = $("#scan-zoom");
      var targets = [Math.min(caps.zoom.max, 2), Math.min(caps.zoom.max, 3)];
      var due = [2500, 5500];
      if (scan.autoZoomStep < targets.length && elapsed > due[scan.autoZoomStep] && !scan.userZoomed) {
        var z = targets[scan.autoZoomStep++];
        scan.track.applyConstraints({ advanced: [{ zoom: z }] }).then(function () { if (zoom) zoom.value = z; scanStatus("Zoomed to " + z + "x for a small code. Keep the code inside the box.", ""); }).catch(function () { });
      }
    }
  }

  function stopScanner() {
    scan.active = false;
    if (scan.raf) cancelAnimationFrame(scan.raf); scan.raf = null;
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
    scan.stream = null; scan.track = null;
    var video = $("#scan-video"); if (video) video.srcObject = null;
  }

  // Full-resolution still photo -> multi-crop, multi-scale decode. No 1600px downscale here.
  function decodePhotoFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file); var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var W = img.naturalWidth, H = img.naturalHeight;
        var attempts = [];
        // whole image at up to 1800px, then centre crops 60% / 40% / 28% upscaled to 1000px
        var scale = Math.min(1, 2200 / Math.max(W, H));
        attempts.push({ sx: 0, sy: 0, sw: W, sh: H, out: Math.round(Math.max(W, H) * scale) });
        [0.65, 0.45, 0.3, 0.2].forEach(function (f) { var side = Math.floor(Math.min(W, H) * f); attempts.push({ sx: (W - side) / 2, sy: (H - side) / 2, sw: side, sh: side, out: 1100 }); });
        // off-centre thirds at 45% - the code is rarely dead centre in a hand-held photo
        var side3 = Math.floor(Math.min(W, H) * 0.45);
        [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8], [0.5, 0.25], [0.5, 0.75]].forEach(function (pt) {
          var cx = W * pt[0], cy = H * pt[1]; var sx = Math.max(0, Math.min(W - side3, cx - side3 / 2)), sy = Math.max(0, Math.min(H - side3, cy - side3 / 2));
          attempts.push({ sx: sx, sy: sy, sw: side3, sh: side3, out: 1100 });
        });
        var i = 0;
        function next() {
          if (i >= attempts.length) return resolve(null);
          var a = attempts[i++]; var c = document.createElement("canvas");
          var ratio = a.sh / a.sw; c.width = a.out; c.height = Math.round(a.out * ratio);
          c.getContext("2d").drawImage(img, a.sx, a.sy, a.sw, a.sh, 0, 0, c.width, c.height);
          decodeCanvasAsync(c).then(function (t) { if (t) resolve(t); else next(); }).catch(next);
        }
        next();
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("Could not read that photo")); };
      img.src = url;
    });
  }

  function onCodeDecoded(text, via) {
    stopScanner();
    scan.text = text;
    scanStatus("Code read. Asking the state registry...", "ok");
    fetch(BASE + "/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: text, via: via }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (!d || !d.ok) throw new Error(d && d.error || "resolve failed"); scan.result = d; renderScanResult(d); })
      .catch(function (e) { scanStatus("Could not reach PodCheck's server (" + e.message + "). Try again.", "warn"); renderRetry(); });
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }

  function renderRetry() {
    $("#scan-result").innerHTML = '<div class="card"><button class="btn primary big-tap block" id="scan-again">Scan again</button></div>';
    $("#scan-again").onclick = startScanner;
  }

  function renderScanResult(d) {
    var r = d.result || {}; var host = $("#scan-result");
    if (d.next === "celebrate" || d.next === "recall") { renderVerified(d); return; }
    if (d.next === "retry") {
      scanStatus(r.detail || "The registry did not answer. Try again in a moment.", "warn");
      host.innerHTML = '<div class="card"><p class="muted">' + esc(r.detail || "") + '</p><button class="btn primary big-tap block" id="scan-again">Try again</button></div>';
      $("#scan-again").onclick = function () { onCodeDecoded(scan.text, "retry"); };
      return;
    }
    // evidence path
    scanStatus("The state registry could not confirm this code.", "warn");
    var why;
    if (r.reason === "not_found" && r.subreason === "unit_not_issued") {
      why = "The code decodes to state package tag <strong>" + esc(r.decoded_package) + "</strong>, unit <strong>#" + esc(r.decoded_index) + "</strong>. That package is real, but the state says <strong>this unit number was never issued</strong>. Genuine units only carry issued numbers - a copied code with a changed number lands exactly here.";
    } else if (r.reason === "not_found") {
      why = "The code points at the state track-and-trace registry, but the registry has <strong>no record of it</strong>" + (r.decoded_package ? " (it decodes to package tag " + esc(r.decoded_package) + ", which the state has never seen)" : "") + ". A genuine unit's code resolves to its product, lab results and licence.";
    } else if (r.reason === "malformed_retail_id") {
      why = "The code looks like a state-registry link, but the registry says the code text itself is <strong>not a valid Retail ID</strong>. Most often that is a misread or damaged print - try once more in good light, filling the frame. A code that only imitates the pattern also lands here.";
    } else if (r.reason === "not_state_registry") {
      why = "This code does not point at a state registry (it opens <strong>" + esc(r.host || "no web address") + "</strong>). Legal New York and California units carry a Metrc Retail ID code that opens the state registry. A unit sold in Arizona or Florida uses a different state system, so landing here is expected there - turn's three checks and the flavor catalog still apply.";
    } else {
      why = esc(r.detail || "Could not verify from this code.");
    }
    host.innerHTML =
      '<div class="card verdict-unverified">' +
        '<div class="verdict-icon" aria-hidden="true">' + icon("alertTriangle", 40) + '</div>' +
        '<h2>Could not verify with the state</h2>' +
        '<p>' + why + '</p>' +
        '<p class="muted small">This is not proof of a counterfeit on its own. Codes on genuine product can be misprinted or damaged, and registries have outages. The next step gathers the evidence that settles it.</p>' +
        '<button class="btn primary big-tap block" id="scan-to-evidence">Start the evidence walkthrough</button>' +
        '<button class="btn big-tap block" id="scan-again">Scan again</button>' +
      '</div>';
    $("#scan-again").onclick = startScanner;
    $("#scan-to-evidence").onclick = function () {
      state.qrText = scan.text; state.registry = d;
      var destInput = $("#code-destination"); if (destInput) destInput.value = scan.text;
      navigate("check");
    };
  }

  function fmtPct(v) { if (v == null || v === "") return null; var n = parseFloat(v); return isFinite(n) ? (Math.round(n * 100) / 100) + "%" : String(v); }

  function renderVerified(d) {
    var r = d.result; var host = $("#scan-result");
    var stateName = r.state_name || "the state";
    var recall = !!r.is_on_recall;
    scanStatus(recall ? "Registered, but this unit is on a state recall." : "Registered with " + stateName + ".", recall ? "warn" : "ok");
    var fmtDate = function (v) { if (!v) return null; var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[1] + "-" + m[2] + "-" + m[3] : String(v); };
    var labStatus = r.lab && r.lab.status ? (/pass/i.test(r.lab.status) ? "Passed" : /fail/i.test(r.lab.status) ? "FAILED" : r.lab.status) : null;
    var cannab = (r.lab && r.lab.cannabinoids || []).filter(function (c) { return c.percent != null && c.percent > 0; }).slice(0, 4).map(function (c) { var p = fmtPct(c.percent); return p ? '<span class="chip">' + esc(c.name) + ' ' + esc(p) + '</span>' : ""; }).join("");
    var terps = (r.lab && r.lab.terpenes || []).filter(function (t) { return t.percent > 0 && !/^total/i.test(t.name); }).slice(0, 4).map(function (t) { return '<span class="chip chip-terp">' + esc(t.name) + ' ' + esc(fmtPct(t.percent) || "") + '</span>'; }).join("");
    var thcPkg = r.product && r.product.thc_content ? esc(r.product.thc_content) + " " + esc((r.product.thc_content_unit || "").replace(/^Milligrams$/, "mg").replace(/^Grams$/, "g")) : null;
    var rows = [
      ["Product", r.product && r.product.name], ["Brand", r.brand && r.brand.name], ["Strain", r.product && r.product.strain], ["Type", r.product && r.product.category],
      ["Size", r.product && r.product.weight ? esc(r.product.weight) + " " + esc(String(r.product.weight_unit || "").replace(/^Grams$/, "g")) : null],
      ["THC per package", thcPkg],
      ["Package tag", r.package_label], ["Batch", r.batch && r.batch.number], ["Producer", r.facility && r.facility.name], ["Licence", r.facility && r.facility.license],
      ["Packaged", fmtDate(r.dates && r.dates.packaged)], ["Expires", fmtDate(r.dates && r.dates.expiration)], ["Lab tested", fmtDate(r.dates && r.dates.tested)],
      ["Lab", r.lab && r.lab.name], ["Lab licence", r.lab && r.lab.license], ["Lab result", labStatus]
    ].filter(function (x) { return x[1]; });
    var facts = rows.map(function (x) { return '<div class="fact"><span class="fact-k">' + esc(x[0]) + '</span><span class="fact-v">' + (x[0] === "Size" || x[0] === "THC per package" ? x[1] : esc(x[1])) + '</span></div>'; }).join("");
    var unsupported = r.state_supported === false || (r.state && r.state !== "NY" && r.state !== "CA");
    var unsupportedHtml = unsupported ? '<div class="recall-banner untested-banner">' + icon("alertTriangle", 20) + ' <strong>Untested state.</strong> The registry answered for ' + esc(r.state || "an unlisted state") + ', but the PodCheck registry reading has only been built and tested on New York and California units. Read this card as unconfirmed.</div>' : "";
    var recallHtml = recall ? '<div class="recall-banner">' + icon("alertTriangle", 20) + ' <strong>State recall.</strong> ' + stateName + ' has recalled this unit. Do not use it. ' + (r.regulator && r.regulator.recalls_url ? '<a href="' + esc(r.regulator.recalls_url) + '" target="_blank" rel="noopener">Recall notice</a>' : "") + '</div>' : "";
    host.innerHTML =
      '<div class="card verdict-verified' + (recall ? " has-recall" : "") + '">' +
        (recall ? "" : '<div class="celebrate" aria-hidden="true"><svg class="tick" viewBox="0 0 72 72"><circle class="tick-ring" cx="36" cy="36" r="32"/><path class="tick-mark" d="M22 37l9 9 19-20"/></svg>' + confettiHtml() + '</div>') +
        '<h2>' + (recall ? "Registered, but recalled" : "It is in the books") + '</h2>' +
        '<p class="lead-sm">' + esc(stateName) + "'s track-and-trace registry recognises this exact unit. Here is what the state says is in it.</p>" +
        recallHtml + unsupportedHtml +
        '<div class="facts">' + facts + '</div>' +
        (cannab ? '<p class="muted small chips-label">Cannabinoids (state lab)</p><div class="chips">' + cannab + '</div>' : "") +
        (terps ? '<p class="muted small chips-label">Top terpenes</p><div class="chips">' + terps + '</div>' : "") +
        (r.lab && r.lab.coa_url ? '<a class="secondary-link" href="' + esc(r.lab.coa_url) + '" target="_blank" rel="noopener">Open the lab certificate (PDF)</a>' : "") +
        (r.regulator && r.regulator.links && r.regulator.links.length ? '<p class="muted small reg-links">' + r.regulator.links.slice(0, 3).map(function (l) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.label) + '</a>'; }).join(' · ') + '</p>' : "") +
        '<div class="match-q"><h3>Does this match the package in your hand?</h3>' +
          '<p class="muted small">A copied code can be printed on a fake package. If the product name, brand or size do not match what you are holding, say so.</p>' +
          '<div class="match-btns"><button class="btn primary big-tap" id="match-yes">Yes, it matches</button><button class="btn big-tap" id="match-no">No, something is off</button></div>' +
        '</div>' +
        '<p class="muted small">Registry: ' + esc(r.registry) + ' (' + esc(r.state || "") + '). Independent lookup by PodCheck; not affiliated with the state or the brand.</p>' +
      '</div>';
    var doneHtml = '<div class="card"><h3>Logged</h3><p>Thanks. This scan now counts in the public stats as a state-registered unit that matched its package.</p><a class="btn primary big-tap block" href="#stats">See the stats</a><button class="btn big-tap block" id="scan-again">Scan another</button></div>';
    $("#match-yes").onclick = function () {
      confirmMatch(d.scan_id, true);
      host.innerHTML = doneHtml; $("#scan-again").onclick = startScanner;
    };
    $("#match-no").onclick = function () {
      confirmMatch(d.scan_id, false);
      state.qrText = scan.text; state.registry = d;
      var destInput = $("#code-destination"); if (destInput) destInput.value = scan.text;
      toast("Recorded a mismatch. Gathering evidence next.", "success");
      navigate("check");
    };
  }

  function confettiHtml() {
    var out = ""; for (var i = 0; i < 14; i++) out += '<i class="cf cf' + (i % 7) + '" style="left:' + (6 + i * 6.5) + '%;animation-delay:' + (i * 0.07) + 's"></i>'; return out;
  }

  function confirmMatch(scanId, match) {
    if (!scanId) return;
    fetch(BASE + "/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scan_id: scanId, match: !!match }) }).catch(function () { });
  }

  function renderRegistryNote() {
    var host = $("#check-registry-note"); if (!host) return;
    var d = state.registry; if (!d) { host.innerHTML = ""; return; }
    var r = d.result || {};
    var txt = r.verified ? "The state registry recognised the code, but you said the record does not match the package. That mismatch is recorded and is a strong signal on its own." :
      r.reason === "not_found" ? "The state registry has no record of this code (looked up " + new Date().toLocaleTimeString() + "). Carried into this check." :
      "The code did not resolve to a state registry (" + esc(r.reason || "unknown") + "). Carried into this check.";
    host.innerHTML = '<div class="registry-note">' + icon("alertTriangle", 18) + ' ' + txt + '</div>';
  }

  function bindScanUI() {
    var fileIn = $("#scan-file");
    if (fileIn) fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0]; if (!f) return;
      stopScanner(); scanStatus("Reading the photo at full resolution...");
      decodePhotoFile(f).then(function (t) {
        if (t) onCodeDecoded(t, "photo");
        else { scanStatus("No code found in that photo. Get closer, keep it flat, avoid glare - or paste the link.", "warn"); renderRetry(); }
      }).catch(function (e) { scanStatus(e.message, "warn"); renderRetry(); });
      fileIn.value = "";
    });
    var go = $("#scan-manual-go"), man = $("#scan-manual");
    if (go && man) go.addEventListener("click", function () { var v = man.value.trim(); if (!v) return; onCodeDecoded(v, "manual"); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindStaticUI();
    bindScanUI();
    renderHome();
    renderCheckSlots();
    checkAgeGate();
    onHashChange();
  });
})();
