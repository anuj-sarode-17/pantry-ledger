(function () {
  var CATEGORY_ORDER = [
    "Grains & Starches", "Lentils & Legumes", "Nuts & Seeds", "Oils & Vinegar",
    "Whole Spices", "Ground Spices & Masalas", "Aromatics", "Sauces & Condiments",
    "Stocks & Broths", "Dairy & Cheese", "Pickled & Jarred", "Baking & Sweeteners", "Other"
  ];
  var STOCK_ORDER = { "Low": 0, "Medium": 1, "Adequate": 2 };
  var STOCK_CLASS = { "Low": "low", "Medium": "med", "Adequate": "ok" };
  var CACHE_KEY = "pantry-ledger-cache-v1";

  var state = { items: [], search: "", stockFilter: "", catFilter: "", expanded: {} };
  var db = null;
  var sectionsEl = document.getElementById("sections");
  var statsEl = document.getElementById("stats");
  var statusEl = document.getElementById("status-line");
  var catFilterRow = document.getElementById("category-filters");
  var catDatalist = document.getElementById("cat-options");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function categorySort(a, b) {
    var ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1) ia = 999;
    if (ib === -1) ib = 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b);
  }

  function fmtMoney(n) {
    if (n === null || n === undefined || isNaN(n)) return "";
    return "$" + Number(n).toFixed(2);
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var d = new Date(iso + "T00:00:00");
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function sortedPurchases(it) {
    return (it.purchases || []).slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
  }

  function lastPurchase(it) {
    var list = sortedPurchases(it);
    return list.length ? list[0] : null;
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function cacheSave() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.items)); } catch (e) {}
  }

  function cacheLoad() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }

  function render() {
    var items = state.items.slice();
    var q = state.search.trim().toLowerCase();
    if (q) {
      items = items.filter(function (it) {
        return (it.name || "").toLowerCase().indexOf(q) !== -1 ||
               (it.location || "").toLowerCase().indexOf(q) !== -1;
      });
    }
    if (state.stockFilter) items = items.filter(function (it) { return it.stock === state.stockFilter; });
    if (state.catFilter) items = items.filter(function (it) { return it.category === state.catFilter; });

    var total = state.items.length;
    var low = state.items.filter(function (it) { return it.stock === "Low"; }).length;
    statsEl.innerHTML = "<b>" + total + "</b> item" + (total === 1 ? "" : "s") +
      (low ? "  ·  <span class=\"low-count\">" + low + " low</span>" : "");

    var byCat = {};
    items.forEach(function (it) {
      var c = it.category || "Other";
      (byCat[c] = byCat[c] || []).push(it);
    });
    var cats = Object.keys(byCat).sort(categorySort);

    if (!items.length) {
      sectionsEl.innerHTML = '<p class="empty-state">' +
        (state.items.length ? "Nothing matches your filters." : "No items yet — add your first one below.") +
        '</p>';
      return;
    }

    var html = cats.map(function (cat) {
      var list = byCat[cat].slice().sort(function (a, b) {
        var s = STOCK_ORDER[a.stock] - STOCK_ORDER[b.stock];
        return s !== 0 ? s : (a.name || "").localeCompare(b.name || "");
      });
      var rows = list.map(function (it) {
        var loc = it.location ? esc(it.location) : "";
        var last = lastPurchase(it);
        var subtitle = last
          ? esc(fmtMoney(last.price)) + (last.store ? " · " + esc(last.store) : "") + " · " + esc(fmtDate(last.date))
          : "";
        var purchCount = (it.purchases || []).length;
        var expanded = !!state.expanded[it.id];

        var mainRow = '<div class="item-row" data-id="' + esc(it.id) + '">' +
          '<span class="item-name-wrap">' +
            '<button type="button" class="item-name" data-action="edit-name" title="Edit name">' + esc(it.name) + '</button>' +
            (subtitle ? '<span class="item-last-buy">' + subtitle + '</span>' : '') +
          '</span>' +
          '<button class="item-loc-btn' + (loc ? "" : " empty") + '" data-action="edit-loc" title="Edit location">' +
            (loc || "+ location") +
          '</button>' +
          '<button class="stock-btn ' + STOCK_CLASS[it.stock] + '" data-action="cycle-stock">' + esc(it.stock) + '</button>' +
          '<button class="hist-btn' + (purchCount ? " has-history" : "") + '" data-action="toggle-history" title="Purchase history" aria-label="Purchase history for ' + esc(it.name) + '" aria-expanded="' + (expanded ? "true" : "false") + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg>' +
          '</button>' +
          '<button class="del-btn" data-action="delete" title="Remove item" aria-label="Remove ' + esc(it.name) + '">' +
            '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m2 0-1 13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7"/></svg>' +
          '</button>' +
        '</div>';

        var panel = "";
        if (expanded) {
          var log = sortedPurchases(it);
          var logHtml = log.length
            ? '<div class="purchase-log">' + log.map(function (p) {
                return '<div class="purchase-entry" data-pid="' + esc(p.id) + '">' +
                  '<span class="p-price">' + esc(fmtMoney(p.price)) + '</span>' +
                  '<span class="p-store">' + esc(p.store || "—") + '</span>' +
                  '<span class="p-date">' + esc(fmtDate(p.date)) + '</span>' +
                  '<button class="p-del" data-action="delete-purchase" aria-label="Remove this purchase">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
                  '</button>' +
                '</div>';
              }).join("") + '</div>'
            : '<p class="no-purchases">No purchases logged yet.</p>';

          panel = '<div class="purchase-panel">' + logHtml +
            '<form class="purchase-form" data-action="add-purchase">' +
              '<input type="number" step="0.01" min="0" placeholder="Price" data-field="price" required />' +
              '<input type="text" placeholder="Store (e.g. Costco)" maxlength="50" data-field="store" />' +
              '<input type="date" data-field="date" value="' + todayISO() + '" required />' +
              '<button type="submit">Log</button>' +
            '</form>' +
          '</div>';
        }

        return '<div class="item-block" data-id="' + esc(it.id) + '">' + mainRow + panel + '</div>';
      }).join("");
      return '<section class="category-section">' +
        '<h2>' + esc(cat) + ' <span class="count">' + list.length + '</span></h2>' +
        '<div class="item-list">' + rows + '</div>' +
      '</section>';
    }).join("");
    sectionsEl.innerHTML = html;
  }

  function renderCategoryChips() {
    var cats = Array.from(new Set(state.items.map(function (it) { return it.category || "Other"; }))).sort(categorySort);
    var chips = '<button class="chip" data-cat="" aria-pressed="' + (state.catFilter === "" ? "true" : "false") + '">All categories</button>' +
      cats.map(function (c) {
        return '<button class="chip" data-cat="' + esc(c) + '" aria-pressed="' + (state.catFilter === c ? "true" : "false") + '">' + esc(c) + '</button>';
      }).join("");
    catFilterRow.innerHTML = chips;
    catDatalist.innerHTML = cats.map(function (c) { return '<option value="' + esc(c) + '"></option>'; }).join("");
  }

  function cycleStock(cur) {
    return cur === "Adequate" ? "Medium" : cur === "Medium" ? "Low" : "Adequate";
  }

  // ---- quick-action panel toggles (Add item / Scan receipt) ----
  // Each button "becomes" its panel: the button row hides, the panel takes
  // its place, and "Back" reverses it. Exposed as openPanel/closePanel so
  // scan.js can return to the button row after a successful scan too.
  var quickActions = document.getElementById("quick-actions");
  var addToggleBtn = document.getElementById("add-toggle-btn");
  var scanToggleBtn = document.getElementById("scan-toggle-btn");
  var addPanel = document.getElementById("add-panel");
  var scanPanel = document.getElementById("scan-panel");
  var addBackBtn = document.getElementById("add-back-btn");
  var scanBackBtn = document.getElementById("scan-back-btn");

  function openPanel(panel) {
    quickActions.hidden = true;
    addPanel.hidden = panel !== addPanel;
    scanPanel.hidden = panel !== scanPanel;
  }
  function closePanel() {
    addPanel.hidden = true;
    scanPanel.hidden = true;
    quickActions.hidden = false;
  }
  window.closePanel = closePanel; // used by app.js's own add-form handler below and by scan.js

  addToggleBtn.addEventListener("click", function () { openPanel(addPanel); document.getElementById("f-name").focus(); });
  scanToggleBtn.addEventListener("click", function () { openPanel(scanPanel); });
  addBackBtn.addEventListener("click", closePanel);
  scanBackBtn.addEventListener("click", closePanel);

  // ---- events ----
  document.getElementById("search").addEventListener("input", function (e) {
    state.search = e.target.value;
    render();
  });

  document.getElementById("stock-filters").addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.stockFilter = btn.getAttribute("data-stock");
    Array.from(this.querySelectorAll(".chip")).forEach(function (c) {
      c.setAttribute("aria-pressed", c === btn ? "true" : "false");
    });
    render();
  });

  catFilterRow.addEventListener("click", function (e) {
    var btn = e.target.closest(".chip");
    if (!btn) return;
    state.catFilter = btn.getAttribute("data-cat");
    renderCategoryChips();
    render();
  });

  sectionsEl.addEventListener("click", function (e) {
    var block = e.target.closest(".item-block");
    if (!block) return;
    var id = block.getAttribute("data-id");
    var item = state.items.find(function (it) { return it.id === id; });
    if (!item) return;
    var action = e.target.closest("[data-action]");
    if (!action) return;
    var kind = action.getAttribute("data-action");

    if (kind === "cycle-stock") {
      var next = cycleStock(item.stock);
      item.stock = next;
      render();
      cacheSave();
      if (db) db.collection("items").doc(id).update({ stock: next }).catch(function () {});
    } else if (kind === "delete") {
      if (!confirm('Remove "' + item.name + '" from the pantry?')) return;
      state.items = state.items.filter(function (it) { return it.id !== id; });
      render();
      cacheSave();
      if (db) db.collection("items").doc(id).delete().catch(function () {});
    } else if (kind === "edit-name") {
      var nameInput = document.createElement("input");
      nameInput.className = "name-input";
      nameInput.value = item.name || "";
      nameInput.maxLength = 60;
      action.replaceWith(nameInput);
      nameInput.focus();
      nameInput.select();
      var commitName = function () {
        var val = nameInput.value.trim();
        if (!val) { render(); return; }
        item.name = val;
        render();
        cacheSave();
        if (db) db.collection("items").doc(id).update({ name: val }).catch(function () {});
      };
      nameInput.addEventListener("blur", commitName);
      nameInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); nameInput.blur(); }
        if (ev.key === "Escape") { ev.preventDefault(); render(); }
      });
    } else if (kind === "edit-loc") {
      var input = document.createElement("input");
      input.className = "loc-input";
      input.value = item.location || "";
      input.placeholder = "Where is it?";
      action.replaceWith(input);
      input.focus();
      input.select();
      var commit = function () {
        var val = input.value.trim();
        item.location = val;
        render();
        cacheSave();
        if (db) db.collection("items").doc(id).update({ location: val }).catch(function () {});
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        if (ev.key === "Escape") { ev.preventDefault(); render(); }
      });
    } else if (kind === "toggle-history") {
      if (state.expanded[id]) delete state.expanded[id];
      else state.expanded[id] = true;
      render();
    } else if (kind === "delete-purchase") {
      var entry = e.target.closest(".purchase-entry");
      var pid = entry && entry.getAttribute("data-pid");
      if (!pid) return;
      var updated = (item.purchases || []).filter(function (p) { return p.id !== pid; });
      item.purchases = updated;
      render();
      cacheSave();
      if (db) db.collection("items").doc(id).update({ purchases: updated }).catch(function () {});
    }
  });

  sectionsEl.addEventListener("submit", function (e) {
    var form = e.target.closest('[data-action="add-purchase"]');
    if (!form) return;
    e.preventDefault();
    var block = form.closest(".item-block");
    var id = block.getAttribute("data-id");
    var item = state.items.find(function (it) { return it.id === id; });
    if (!item) return;

    var price = parseFloat(form.querySelector('[data-field="price"]').value);
    var store = form.querySelector('[data-field="store"]').value.trim();
    var date = form.querySelector('[data-field="date"]').value || todayISO();
    if (isNaN(price)) return;

    var entry = { id: "p" + Date.now() + Math.random().toString(36).slice(2, 7), price: price, store: store, date: date };
    var updated = (item.purchases || []).concat([entry]);
    item.purchases = updated;
    render();
    cacheSave();
    if (db) db.collection("items").doc(id).update({ purchases: updated }).catch(function () {
      statusEl.textContent = "Couldn't save that purchase — check your connection and try again.";
      statusEl.className = "status-line offline";
    });
  });

  document.getElementById("add-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = document.getElementById("f-name").value.trim();
    var category = document.getElementById("f-category").value.trim() || "Other";
    var stock = document.getElementById("f-stock").value;
    var location = document.getElementById("f-location").value.trim();
    var priceRaw = document.getElementById("f-price").value;
    var store = document.getElementById("f-store").value.trim();
    var buyDate = document.getElementById("f-buy-date").value;
    if (!name) return;

    var purchases = [];
    if (priceRaw !== "") {
      var price = parseFloat(priceRaw);
      if (!isNaN(price)) {
        purchases.push({
          id: "p" + Date.now() + Math.random().toString(36).slice(2, 7),
          price: price,
          store: store,
          date: buyDate || todayISO()
        });
      }
    }

    var tempId = "temp-" + Date.now();
    var newItem = { id: tempId, name: name, category: category, stock: stock, location: location, purchases: purchases };
    state.items.push(newItem);
    render();
    renderCategoryChips();
    cacheSave();
    e.target.reset();
    document.getElementById("f-stock").value = "Adequate";
    closePanel(document.getElementById("add-panel"));

    if (db) {
      db.collection("items").add({ name: name, category: category, stock: stock, location: location, purchases: purchases, createdAt: Date.now() })
        .then(function (ref) {
          newItem.id = ref.id;
          render();
          cacheSave();
        })
        .catch(function () {
          statusEl.textContent = "Couldn't save that item — check your connection and try again.";
          statusEl.className = "status-line offline";
        });
    }
  });

  // ---- boot ----
  function showConfigNeeded() {
    statusEl.textContent = "Not connected yet — add your Firebase project's keys to firebase-config.js (see README.md).";
    statusEl.className = "status-line error";
  }

  function maybeSeed() {
    var items = state.items;
    if (items.length || !db || !window.PANTRY_SEED || !window.PANTRY_SEED.length) return;
    var batch = db.batch();
    window.PANTRY_SEED.forEach(function (it) {
      var ref = db.collection("items").doc(it.id);
      batch.set(ref, {
        name: it.name, category: it.category, stock: it.stock,
        location: it.location || "", purchases: [], createdAt: Date.now()
      });
    });
    batch.commit().catch(function () {});
  }

  function boot() {
    state.items = cacheLoad();
    render();
    renderCategoryChips();

    var cfg = window.firebaseConfig;
    if (!cfg || cfg.apiKey === "YOUR_API_KEY" || !cfg.projectId) {
      showConfigNeeded();
      return;
    }

    try {
      firebase.initializeApp(cfg);
      db = firebase.firestore();
    } catch (err) {
      statusEl.textContent = "Couldn't connect to Firebase: " + err.message;
      statusEl.className = "status-line error";
      return;
    }

    var seeded = false;
    db.collection("items").onSnapshot(function (snap) {
      state.items = snap.docs.map(function (d) {
        var v = d.data() || {};
        return {
          id: d.id,
          name: v.name || "Untitled item",
          category: v.category || "Other",
          stock: (v.stock === "Low" || v.stock === "Medium") ? v.stock : "Adequate",
          location: v.location || "",
          purchases: Array.isArray(v.purchases) ? v.purchases : []
        };
      });
      cacheSave();
      statusEl.textContent = "Synced.";
      statusEl.className = "status-line";
      render();
      renderCategoryChips();
      if (!seeded) { seeded = true; maybeSeed(); }
    }, function (err) {
      statusEl.textContent = "Sync error (" + err.code + ") — showing the last saved copy on this device. Check your Firestore security rules if this persists.";
      statusEl.className = "status-line offline";
    });
  }

  boot();

  // Small bridge for scan.js (receipt OCR import), kept separate so the
  // core list/CRUD logic above stays simple. Always reflects live state.
  window.PantryApp = {
    getDb: function () { return db; },
    getItems: function () { return state.items; },
    getCategories: function () {
      return Array.from(new Set(state.items.map(function (it) { return it.category || "Other"; }))).sort(categorySort);
    },
    setStatus: function (text, kind) {
      statusEl.textContent = text;
      statusEl.className = "status-line" + (kind ? " " + kind : "");
    },
    refresh: function () { cacheSave(); render(); renderCategoryChips(); },
    todayISO: todayISO
  };
})();
