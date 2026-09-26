// Receipt scanning: on-device OCR (Tesseract.js, no API key, no server) +
// heuristic line parsing, then a manual review step before anything is
// written to Firestore. OCR on a phone photo is never perfect, so nothing
// here is final until the person reviews and taps "Add checked items" —
// and what's on screen in each row is always exactly what gets saved
// (every field is read straight from the DOM at commit time, not from a
// separate JS copy that could drift out of sync with what's visible).
(function () {
  var fileInput = document.getElementById("scan-file");
  var progressWrap = document.getElementById("scan-progress");
  var progressFill = document.getElementById("scan-progress-fill");
  var progressText = document.getElementById("scan-progress-text");
  var errorEl = document.getElementById("scan-error");
  var reviewWrap = document.getElementById("scan-review");
  var rowsEl = document.getElementById("scan-rows");
  var storeInput = document.getElementById("scan-store");
  var dateInput = document.getElementById("scan-date");
  var addRowBtn = document.getElementById("scan-add-row");
  var commitBtn = document.getElementById("scan-commit");

  if (!fileInput) return;

  var rowSeq = 0;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var STORE_HINTS = [
    "ALDI", "COSTCO", "WALMART", "TARGET", "KROGER", "SAFEWAY", "ALBERTSONS",
    "TRADER JOE'S", "WHOLE FOODS", "SPROUTS", "FRY'S", "PUBLIX", "MEIJER",
    "SAM'S CLUB", "H-E-B", "WINCO", "FOOD 4 LESS", "VONS", "RALPHS"
  ];

  var REJECT_WORDS = [
    "subtotal", "total", "tax", "balance", "change due", "cash", "visa", "mastercard",
    "amex", "discover", "approved", "auth #", "auth#", "trace #", "trace#", "ref/seq",
    "trans", "tvr", "iad", "tsi ", "arc ", "entrymode", "aid a0", "cashier", "store #",
    "phone", "www.", "http", "thank you", "survey", "receipt#", "card #", "account",
    "*** ", "savings", "coupon", "tender", "purchase", "items sold", "your cashier"
  ];

  var CATEGORY_KEYWORDS = [
    [/apple|banana|orange|grape|berry|lettuce|spinach|kale|tomato|onion|potato|carrot|cucumber|pepper|avocado|cabbage|cauliflower|broccoli|mushroom|cilantro|parsley|celery|lemon|lime|melon|mango|peach|pear|plum|corn|squash|zucchini|produce/i, "Produce"],
    [/chicken|beef|turkey|pork|ham|bacon|sausage|steak|ground|deli|salami|pepperoni|fish|salmon|shrimp|tilapia|meat/i, "Meat & Deli"],
    [/milk|cheese|yogurt|butter|cream|egg|parmesan|mozzarella|cheddar|dairy/i, "Dairy & Cheese"],
    [/soda|juice|cider|water|tea|coffee|beer|wine|cola|sparkling|drink/i, "Beverages"],
    [/bread|bagel|muffin|pancake|waffle|cereal|granola|oat|chip|cracker|cookie|pretzel|snack|bar /i, "Breakfast & Snacks"],
    [/tissue|paper towel|napkin|detergent|soap|cleaner|trash bag|foil|wrap|battery|bath/i, "Household"],
    [/sauce|salsa|ketchup|mustard|mayo|dressing|marinara|syrup|honey|jam|jelly/i, "Sauces & Condiments"],
    [/vinegar|\boil\b/i, "Oils & Vinegar"],
    [/rice|pasta|noodle|flour|quinoa|cornstarch|spaghetti|penne/i, "Grains & Starches"],
    [/dal|lentil|bean|chana|rajma/i, "Lentils & Legumes"],
    [/cashew|almond|peanut|walnut|pistachio|coconut/i, "Nuts & Seeds"],
    [/masala|turmeric|cumin|jeera|cinnamon|clove|cardamom|spice|chilli powder|chili powder/i, "Ground Spices & Masalas"],
    [/garlic|ginger|onion powder/i, "Aromatics"]
  ];

  function guessCategory(name) {
    for (var i = 0; i < CATEGORY_KEYWORDS.length; i++) {
      if (CATEGORY_KEYWORDS[i][0].test(name)) return CATEGORY_KEYWORDS[i][1];
    }
    return "Other";
  }

  function guessStore(fullText) {
    var head = fullText.slice(0, 400).toUpperCase();
    for (var i = 0; i < STORE_HINTS.length; i++) {
      if (head.indexOf(STORE_HINTS[i]) !== -1) return STORE_HINTS[i];
    }
    return "";
  }

  function titleCase(s) {
    return s.replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  function parseReceiptText(text) {
    var lines = text.split(/\r?\n/);
    var candidates = [];
    var priceLine = /^(?:\d{3,8}\s+)?(.{2,40}?)\s+\$?(\d{1,4}\.\d{2})(?:\s*[A-Za-z]{1,3})?\s*$/;

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (/^\(?[GNT]\)?\s/i.test(line)) return; // weight breakdown continuation lines
      var lower = line.toLowerCase();
      for (var i = 0; i < REJECT_WORDS.length; i++) {
        if (lower.indexOf(REJECT_WORDS[i]) !== -1) return;
      }
      if (/^\d+$/.test(line.replace(/\s/g, ""))) return;

      var m = line.match(priceLine);
      if (!m) return;
      var name = m[1].replace(/[^\w\s/&'.-]/g, "").replace(/\s{2,}/g, " ").trim();
      var price = parseFloat(m[2]);
      if (!name || name.length < 2) return;
      if (isNaN(price) || price <= 0 || price > 500) return;

      candidates.push({ name: titleCase(name), price: price });
    });

    var merged = [];
    var index = {};
    candidates.forEach(function (c) {
      var key = c.name.toLowerCase();
      if (index.hasOwnProperty(key)) {
        merged[index[key]].price = Math.round((merged[index[key]].price + c.price) * 100) / 100;
      } else {
        index[key] = merged.length;
        merged.push({ name: c.name, price: c.price });
      }
    });
    return merged;
  }

  function findExistingItem(name) {
    var items = window.PantryApp.getItems();
    var lower = name.trim().toLowerCase();
    if (!lower) return null;
    var exact = items.find(function (it) { return (it.name || "").toLowerCase() === lower; });
    if (exact) return exact;
    return items.find(function (it) {
      var n = (it.name || "").toLowerCase();
      return n.length > 2 && (n.indexOf(lower) !== -1 || lower.indexOf(n) !== -1);
    }) || null;
  }

  function rowHtml(seq, name, category, price) {
    var existing = findExistingItem(name);
    var tagHtml = existing
      ? '<span class="scan-match-tag" title="Adds a purchase to your existing item">matches existing</span>'
      : '<span class="scan-match-tag new" title="Creates a new pantry item">new item</span>';
    return (
      '<div class="scan-row" data-seq="' + seq + '">' +
        '<input type="checkbox" class="scan-check" checked />' +
        '<input type="text" class="scan-name" value="' + esc(name) + '" placeholder="Item name" />' +
        '<input type="text" class="scan-cat" list="cat-options" value="' + esc(existing ? existing.category : category) + '" placeholder="Category" ' + (existing ? "disabled" : "") + ' />' +
        '<input type="number" step="0.01" min="0" class="scan-price" value="' + price.toFixed(2) + '" />' +
        tagHtml +
        '<button type="button" class="p-del scan-row-del" aria-label="Remove row"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
      '</div>'
    );
  }

  function renderInitialRows(parsed) {
    rowsEl.innerHTML = parsed.length
      ? parsed.map(function (p) { return rowHtml(++rowSeq, p.name, guessCategory(p.name), p.price); }).join("")
      : '<p class="no-purchases">No lines matched automatically — use "+ Add a row" below.</p>';
  }

  // keep each row's match-tag / category field in sync as its name changes
  rowsEl.addEventListener("input", function (e) {
    if (!e.target.classList.contains("scan-name")) return;
    var rowEl = e.target.closest(".scan-row");
    var existing = findExistingItem(e.target.value);
    var tag = rowEl.querySelector(".scan-match-tag");
    var catInput = rowEl.querySelector(".scan-cat");
    if (existing) {
      tag.textContent = "matches existing";
      tag.className = "scan-match-tag";
      catInput.value = existing.category;
      catInput.disabled = true;
    } else {
      tag.textContent = "new item";
      tag.className = "scan-match-tag new";
      if (catInput.disabled) catInput.value = "Other";
      catInput.disabled = false;
    }
  });

  rowsEl.addEventListener("click", function (e) {
    var delBtn = e.target.closest(".scan-row-del");
    if (!delBtn) return;
    var rowEl = delBtn.closest(".scan-row");
    rowEl.remove();
    if (!rowsEl.querySelector(".scan-row")) {
      rowsEl.innerHTML = '<p class="no-purchases">No rows left — use "+ Add a row" below.</p>';
    }
  });

  addRowBtn.addEventListener("click", function () {
    var placeholder = rowsEl.querySelector(".no-purchases");
    if (placeholder) placeholder.remove();
    rowsEl.insertAdjacentHTML("beforeend", rowHtml(++rowSeq, "", "Other", 0));
  });

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function resetPanels() {
    errorEl.hidden = true;
    progressWrap.hidden = true;
    reviewWrap.hidden = true;
  }

  function downscale(file, maxDim) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error("Couldn't process that image."));
        }, "image/jpeg", 0.92);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Couldn't load that image."));
      };
      img.src = url;
    });
  }

  fileInput.addEventListener("change", function () {
    var file = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!file) return;

    if (typeof Tesseract === "undefined") {
      resetPanels();
      showError("The on-device text reader didn't load (probably no internet connection right now). You can still use \"Add an item\" manually.");
      return;
    }

    resetPanels();
    progressWrap.hidden = false;
    progressFill.style.width = "4%";
    progressText.textContent = "Preparing photo…";

    downscale(file, 1800)
      .then(function (blob) {
        return Tesseract.recognize(blob, "eng", {
          logger: function (m) {
            if (m.status && typeof m.progress === "number") {
              var pct = Math.round(m.progress * 100);
              progressFill.style.width = Math.max(4, pct) + "%";
              progressText.textContent =
                (m.status === "recognizing text" ? "Reading receipt… " + pct + "%" : titleCase(m.status.replace(/_/g, " ")) + "…");
            }
          }
        });
      })
      .then(function (result) {
        var text = (result && result.data && result.data.text) || "";
        var parsed = parseReceiptText(text);
        storeInput.value = guessStore(text);
        dateInput.value = window.PantryApp.todayISO();
        progressWrap.hidden = true;
        reviewWrap.hidden = false;
        renderInitialRows(parsed);
        if (!parsed.length) {
          showError("Couldn't confidently read any line items from that photo — try a straighter, well-lit shot, or add rows manually below.");
        }
      })
      .catch(function (err) {
        progressWrap.hidden = true;
        showError("Something went wrong reading that photo: " + (err && err.message ? err.message : "unknown error") + ". Try again or add items manually.");
      });
  });

  commitBtn.addEventListener("click", function () {
    var db = window.PantryApp.getDb();
    if (!db) {
      showError("Not connected to your database right now, so nothing was saved — check your connection.");
      return;
    }
    var store = storeInput.value.trim();
    var date = dateInput.value || window.PantryApp.todayISO();

    var rows = [];
    rowsEl.querySelectorAll(".scan-row").forEach(function (rowEl) {
      var checked = rowEl.querySelector(".scan-check").checked;
      var name = rowEl.querySelector(".scan-name").value.trim();
      var category = rowEl.querySelector(".scan-cat").value.trim() || "Other";
      var price = parseFloat(rowEl.querySelector(".scan-price").value);
      if (checked && name && !isNaN(price) && price > 0) {
        rows.push({ name: name, category: category, price: price });
      }
    });

    if (!rows.length) {
      showError("Nothing checked to add — tick at least one row first.");
      return;
    }

    var groups = {};
    rows.forEach(function (row) {
      var existing = findExistingItem(row.name);
      var entry = {
        id: "p" + Date.now() + Math.random().toString(36).slice(2, 7),
        price: row.price, store: store, date: date
      };
      var key = existing ? "e:" + existing.id : "n:" + row.name.toLowerCase();
      if (!groups[key]) {
        groups[key] = existing
          ? { existingId: existing.id, entries: [] }
          : { name: row.name, category: row.category, entries: [] };
      }
      groups[key].entries.push(entry);
    });

    var items = window.PantryApp.getItems();
    var batch = db.batch();
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      if (g.existingId) {
        var current = items.find(function (it) { return it.id === g.existingId; });
        var merged = (current && current.purchases ? current.purchases : []).concat(g.entries);
        batch.update(db.collection("items").doc(g.existingId), { purchases: merged });
      } else {
        var ref = db.collection("items").doc();
        batch.set(ref, {
          name: g.name, category: g.category, stock: "Adequate", location: "",
          purchases: g.entries, createdAt: Date.now()
        });
      }
    });

    commitBtn.disabled = true;
    commitBtn.textContent = "Adding…";
    batch.commit()
      .then(function () {
        window.PantryApp.setStatus("Added " + rows.length + " item" + (rows.length === 1 ? "" : "s") + " from your receipt.", "");
        rowsEl.innerHTML = "";
        reviewWrap.hidden = true;
        if (window.closePanel) window.closePanel();
      })
      .catch(function (err) {
        showError("Couldn't save: " + (err && err.message ? err.message : "unknown error"));
      })
      .finally(function () {
        commitBtn.disabled = false;
        commitBtn.textContent = "Add checked items to pantry";
      });
  });
})();
