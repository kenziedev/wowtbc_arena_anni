(function () {
  "use strict";

  var BRACKETS = ["2v2", "3v3", "5v5"];
  var DATA_BASE = "data";
  var GITHUB_REPO = "kenziedev/wowtbc_arena_anni";

  var REALM_LABELS = {
    "fengus-ferocity": "펜구스의 흉포",
    "moldars-moxie": "몰다르의 투지",
  };

  var state = {
    bracket: "2v2",
    data: {},
    meta: null,
    search: "",
    sort: { key: null, asc: true },
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  var els = {
    body: function () { return $("#leaderboard-body"); },
    loading: function () { return $("#loading"); },
    empty: function () { return $("#empty-state"); },
    tableWrap: function () { return $(".table-wrap"); },
    metaInfo: function () { return $("#meta-info"); },
    search: function () { return $("#search"); },
  };

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function ratingClass(r) {
    if (r >= 2000) return "rating-high";
    if (r >= 1500) return "rating-mid";
    return "rating-low";
  }

  function winrateClass(wr) {
    if (wr >= 60) return "winrate-high";
    if (wr >= 45) return "winrate-mid";
    return "winrate-low";
  }

  function rankClass(rank) {
    if (rank === 1) return "rank-1";
    if (rank === 2) return "rank-2";
    if (rank === 3) return "rank-3";
    return "";
  }

  function factionClass(f) {
    if (f === "HORDE") return "char-faction-horde";
    if (f === "ALLIANCE") return "char-faction-alliance";
    return "";
  }

  function esc(str) {
    var el = document.createElement("span");
    el.textContent = str || "";
    return el.innerHTML;
  }

  function buildRow(entry) {
    var wr = entry.winrate || 0;
    var tr = document.createElement("tr");
    tr.innerHTML =
      '<td class="col-rank ' + rankClass(entry.rank) + '">' + entry.rank + "</td>" +
      '<td class="col-name ' + factionClass(entry.faction) + '"><a class="char-link char-name" href="detail.html?name=' + encodeURIComponent(entry.name) + '&realm=' + encodeURIComponent(entry.realm) + '">' + esc(entry.name) + "</a></td>" +
      '<td class="col-class"><span class="class-tag">' + esc(entry["class"]) + "</span></td>" +
      '<td class="col-guild"><span class="guild-name">' + esc(entry.guild) + "</span></td>" +
      '<td class="col-rating"><span class="rating-badge ' + ratingClass(entry.rating) + '">' + entry.rating + "</span></td>" +
      '<td class="col-record">' + entry.won + "승 " + entry.lost + "패</td>" +
      '<td class="col-winrate ' + winrateClass(wr) + '">' + wr.toFixed(1) + "%</td>";
    return tr;
  }

  function getFiltered() {
    var entries = state.data[state.bracket] || [];
    var q = state.search.toLowerCase().trim();

    var filtered = entries;
    if (q) {
      filtered = entries.filter(function (e) {
        return (
          (e.name && e.name.toLowerCase().indexOf(q) !== -1) ||
          (e.guild && e.guild.toLowerCase().indexOf(q) !== -1) ||
          (e["class"] && e["class"].toLowerCase().indexOf(q) !== -1) ||
          (e.realm_name && e.realm_name.toLowerCase().indexOf(q) !== -1)
        );
      });
    }

    if (state.sort.key) {
      var dir = state.sort.asc ? 1 : -1;
      filtered = filtered.slice().sort(function (a, b) {
        var va, vb;
        if (state.sort.key === "rating") {
          va = a.rating || 0;
          vb = b.rating || 0;
        } else if (state.sort.key === "winrate") {
          va = a.winrate || 0;
          vb = b.winrate || 0;
        }
        return (va - vb) * dir;
      });
    }

    return filtered;
  }

  function render() {
    var body = els.body();
    var filtered = getFiltered();
    body.innerHTML = "";

    if (filtered.length === 0) {
      els.tableWrap().hidden = true;
      els.empty().hidden = false;
      return;
    }

    els.tableWrap().hidden = false;
    els.empty().hidden = true;

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < filtered.length; i++) {
      fragment.appendChild(buildRow(filtered[i]));
    }
    body.appendChild(fragment);
    updateSortIndicators();
  }

  function updateSortIndicators() {
    var ths = $$(".leaderboard th.sortable");
    for (var i = 0; i < ths.length; i++) {
      var th = ths[i];
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.sort === state.sort.key) {
        th.classList.add(state.sort.asc ? "sort-asc" : "sort-desc");
      }
    }
  }

  function showLoading(show) {
    els.loading().hidden = !show;
    els.tableWrap().hidden = show;
    els.empty().hidden = true;
  }

  function updateMeta() {
    var info = els.metaInfo();
    if (!state.meta) { info.textContent = ""; return; }
    var bm = state.meta.brackets && state.meta.brackets[state.bracket];
    var count = bm ? bm.count : "?";
    var updated = formatDate(state.meta.updated_at);
    var scanned = state.meta.total_characters_scanned || "?";
    info.innerHTML = count + "명 &middot; " + scanned + "명 스캔 &middot; " + updated;
  }

  function fetchJSON(url) {
    return fetch(url).then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    });
  }

  function loadData() {
    showLoading(true);
    var promises = [fetchJSON(DATA_BASE + "/meta.json")];
    BRACKETS.forEach(function (b) {
      promises.push(fetchJSON(DATA_BASE + "/" + b + ".json").catch(function () { return []; }));
    });

    Promise.all(promises).then(function (results) {
      state.meta = results[0];
      BRACKETS.forEach(function (b, i) { state.data[b] = results[i + 1]; });
    }).catch(function () {
      state.meta = null;
      BRACKETS.forEach(function (b) { state.data[b] = []; });
    }).finally(function () {
      showLoading(false);
      updateMeta();
      render();
    });
  }

  function initTabs() {
    var tabs = $$(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        for (var j = 0; j < tabs.length; j++) {
          tabs[j].classList.remove("active");
          tabs[j].setAttribute("aria-selected", "false");
        }
        this.classList.add("active");
        this.setAttribute("aria-selected", "true");
        state.bracket = this.dataset.bracket;
        state.sort = { key: null, asc: true };
        updateMeta();
        render();
      });
    }
  }

  function initSearch() {
    var timer;
    els.search().addEventListener("input", function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.search = e.target.value;
        render();
      }, 200);
    });
  }

  function initSort() {
    var ths = $$(".leaderboard th.sortable");
    for (var i = 0; i < ths.length; i++) {
      ths[i].addEventListener("click", function () {
        var key = this.dataset.sort;
        if (state.sort.key === key) {
          state.sort.asc = !state.sort.asc;
        } else {
          state.sort.key = key;
          state.sort.asc = false;
        }
        render();
      });
    }
  }

  function initModal() {
    var overlay = $("#modal-overlay");
    var btnAdd = $("#btn-add");
    var btnClose = $("#modal-close");
    var btnSubmit = $("#btn-submit");

    btnAdd.addEventListener("click", function () { overlay.hidden = false; });
    btnClose.addEventListener("click", function () { overlay.hidden = true; });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.hidden = true;
    });

    btnSubmit.addEventListener("click", function () {
      var type = document.querySelector('input[name="add-type"]:checked').value;
      var name = $("#add-name").value.trim();
      var realm = $("#add-realm").value;
      var realmLabel = REALM_LABELS[realm] || realm;

      if (!name) { alert("이름을 입력해주세요."); return; }

      var typeLabel = type === "guild" ? "길드" : "캐릭터";
      var title = encodeURIComponent("[추가] " + typeLabel + ": " + name);
      var body = encodeURIComponent(
        typeLabel + ":\n- " + name + " / " + realmLabel
      );

      var url = "https://github.com/" + GITHUB_REPO + "/issues/new?title=" + title + "&body=" + body + "&labels=add-source";
      window.open(url, "_blank");
      overlay.hidden = true;
    });
  }

  function init() {
    initTabs();
    initSearch();
    initSort();
    initModal();
    loadData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
