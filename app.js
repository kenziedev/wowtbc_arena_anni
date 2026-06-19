(function () {
  "use strict";

  var BRACKETS = ["2v2", "3v3", "5v5"];
  var DATA_BASE = "data";
  var SEASONS_INDEX_PATH = DATA_BASE + "/seasons.json";
  var CLASS_CLASS_MAP = {
    "전사": "class-warrior",
    "성기사": "class-paladin",
    "사냥꾼": "class-hunter",
    "도적": "class-rogue",
    "사제": "class-priest",
    "주술사": "class-shaman",
    "마법사": "class-mage",
    "흑마법사": "class-warlock",
    "드루이드": "class-druid",
  };

  var PAGE_SIZE = 300;

  var state = {
    bracket: "2v2",
    page: 1,
    data: {},
    meta: null,
    cutoffs: null,
    seasons: [],
    currentSeasonId: null,
    seasonId: null,
    pendingSeasonId: null,
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
    seasonSelect: function () { return $("#season-select"); },
    seasonSelectWrap: function () { return $("#season-select-wrap"); },
  };

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // The top reward title changes every season (시즌1 "지옥에서 온 검투사",
  // 시즌2 "무자비한 검투사", ...). Only the lower four tiers keep stable names,
  // so any title we don't recognise is treated as the top (infernal) tier.
  function cutoffTierClass(title) {
    return CUTOFF_CLASS_MAP[title] || "cutoff-infernal";
  }

  function cutoffTierIcon(title) {
    return CUTOFF_ICONS[title] || CUTOFF_ICONS["지옥에서 온 검투사"];
  }

  function cutoffRatingClass(r, bracket) {
    var cutoffs = state.cutoffs && state.cutoffs.cutoffs && state.cutoffs.cutoffs[bracket];
    if (!cutoffs || !cutoffs.length) return "";
    var sorted = cutoffs.slice().sort(function (a, b) { return b.rating - a.rating; });
    for (var i = 0; i < sorted.length; i++) {
      if (r >= sorted[i].rating) {
        return cutoffTierClass(sorted[i].title).replace("cutoff-", "rating-cutoff-");
      }
    }
    return "";
  }

  function ratingClass(r) {
    var cutoffClass = cutoffRatingClass(r, state.bracket);
    if (cutoffClass) return cutoffClass;
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

  function factionMark(f) {
    if (f === "HORDE") {
      return '<span class="faction-mark faction-mark-horde" title="호드">호</span>';
    }
    if (f === "ALLIANCE") {
      return '<span class="faction-mark faction-mark-alliance" title="얼라이언스">얼</span>';
    }
    return "";
  }

  function characterClassClass(className) {
    return CLASS_CLASS_MAP[className] || "";
  }

  function characterRowClass(className) {
    var classClass = characterClassClass(className);
    return classClass ? classClass.replace("class-", "row-class-") : "";
  }

  function esc(str) {
    var el = document.createElement("span");
    el.textContent = str || "";
    return el.innerHTML;
  }

  function normalizeSeasonId(value) {
    if (value === null || value === undefined || value === "") return null;
    var id = parseInt(value, 10);
    return id > 0 ? id : null;
  }

  function findSeason(id) {
    var seasonId = normalizeSeasonId(id);
    if (!seasonId) return null;
    for (var i = 0; i < state.seasons.length; i++) {
      if (normalizeSeasonId(state.seasons[i].id) === seasonId) return state.seasons[i];
    }
    return null;
  }

  function seasonPath(season) {
    if (!season) return DATA_BASE;
    return (season.path || (DATA_BASE + "/seasons/" + season.id)).replace(/\/$/, "");
  }

  function currentSeason() {
    return findSeason(state.seasonId) || findSeason(state.currentSeasonId) || state.seasons[0] || null;
  }

  function changeBadge(val, invert) {
    if (!val) return "";
    var cls = val > 0 ? "change-up" : "change-down";
    if (invert) cls = val > 0 ? "change-down" : "change-up";
    var arrow = val > 0 ? "\u25B2" : "\u25BC";
    return '<span class="change-badge ' + cls + '">' + arrow + Math.abs(val) + '</span>';
  }

  function buildRow(entry) {
    var wr = entry.winrate || 0;
    var tr = document.createElement("tr");
    var rankChange = changeBadge(entry.rkd, false);
    var ratingChange = changeBadge(entry.rd, false);
    var className = (entry["class"] || "").trim();
    var guildName = (entry.guild || "").trim();
    var profileHidden = !className && !guildName;
    tr.className = characterRowClass(className);

    var classGuildHtml;
    if (profileHidden) {
      classGuildHtml =
        '<td colspan="2" class="col-class-guild col-profile-hidden">' +
        '<span class="profile-hidden-label">&lt;정보제공 비동의&gt;</span></td>';
    } else {
      var classClass = characterClassClass(className);
      var guildTitle = guildName ? ' title="' + esc(guildName) + '"' : "";
      classGuildHtml =
        '<td class="col-class"><span class="class-tag ' + classClass + '">' + esc(className) + "</span></td>" +
        '<td class="col-guild"><span class="guild-name"' + guildTitle + ">" + esc(guildName) + "</span></td>";
    }

    tr.innerHTML =
      '<td class="col-rank">' + factionMark(entry.faction) +
      '<span class="rank-main"><span class="col-rank-num ' + rankClass(entry.rank) + '">' + entry.rank + "</span>" + rankChange + "</span></td>" +
      '<td class="col-name ' + factionClass(entry.faction) + '"><a class="char-link char-name" href="detail.html?name=' + encodeURIComponent(entry.name) + '&realm=' + encodeURIComponent(entry.realm) + '&season=' + encodeURIComponent(state.seasonId || "") + '">' + esc(entry.name) + "</a></td>" +
      classGuildHtml +
      '<td class="col-rating"><span class="rating-badge ' + ratingClass(entry.rating) + '">' + entry.rating + '</span>' + ratingChange + "</td>" +
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

  function getTotalPages(filtered) {
    return Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  }

  function render() {
    var body = els.body();
    var filtered = getFiltered();
    body.innerHTML = "";

    if (filtered.length === 0) {
      els.tableWrap().hidden = true;
      els.empty().hidden = false;
      renderPagination(0, 0);
      return;
    }

    els.tableWrap().hidden = false;
    els.empty().hidden = true;

    var totalPages = getTotalPages(filtered);
    if (state.page > totalPages) state.page = totalPages;
    if (state.page < 1) state.page = 1;

    var start = (state.page - 1) * PAGE_SIZE;
    var end = Math.min(start + PAGE_SIZE, filtered.length);
    var pageItems = filtered.slice(start, end);

    var fragment = document.createDocumentFragment();
    for (var i = 0; i < pageItems.length; i++) {
      fragment.appendChild(buildRow(pageItems[i]));
    }
    body.appendChild(fragment);
    updateSortIndicators();
    renderPagination(totalPages, filtered.length);
  }

  function renderPagination(totalPages, totalItems) {
    var container = document.getElementById("pagination");
    if (!container) return;

    if (totalPages <= 1) {
      container.innerHTML = "";
      container.hidden = true;
      return;
    }
    container.hidden = false;

    var html = '<div class="pagination-info">' +
      totalItems + '명 중 ' +
      ((state.page - 1) * PAGE_SIZE + 1) + '-' +
      Math.min(state.page * PAGE_SIZE, totalItems) + '명' +
      '</div><div class="pagination-buttons">';

    html += '<button class="page-btn' + (state.page === 1 ? ' disabled' : '') + '" data-page="prev">&laquo;</button>';

    var pages = buildPageNumbers(state.page, totalPages);
    for (var i = 0; i < pages.length; i++) {
      var p = pages[i];
      if (p === "...") {
        html += '<span class="page-ellipsis">...</span>';
      } else {
        html += '<button class="page-btn' + (p === state.page ? ' active' : '') + '" data-page="' + p + '">' + p + '</button>';
      }
    }

    html += '<button class="page-btn' + (state.page === totalPages ? ' disabled' : '') + '" data-page="next">&raquo;</button>';
    html += '</div>';
    container.innerHTML = html;
  }

  function buildPageNumbers(current, total) {
    if (total <= 7) {
      var arr = [];
      for (var i = 1; i <= total; i++) arr.push(i);
      return arr;
    }
    var pages = [1];
    if (current > 3) pages.push("...");
    for (var j = Math.max(2, current - 1); j <= Math.min(total - 1, current + 1); j++) {
      pages.push(j);
    }
    if (current < total - 2) pages.push("...");
    pages.push(total);
    return pages;
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

  var CUTOFF_ICONS = {
    "지옥에서 온 검투사": '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V6.3l7-3.12zM12 7l-1.5 3H7l2.5 2-1 3.5L12 13l3.5 2.5-1-3.5L17 10h-3.5z"/></svg>',
    "검투사": '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V6.3l7-3.12z"/></svg>',
    "결투사": '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V6.3l7-3.12z"/></svg>',
    "승부사": '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V6.3l7-3.12z"/></svg>',
    "도전자": '<svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.83-3.13 9.37-7 10.5-3.87-1.13-7-5.67-7-10.5V6.3l7-3.12z"/></svg>'
  };

  var CUTOFF_CLASS_MAP = {
    "지옥에서 온 검투사": "cutoff-infernal",
    "검투사": "cutoff-gladiator",
    "결투사": "cutoff-duelist",
    "승부사": "cutoff-rival",
    "도전자": "cutoff-challenger"
  };

  function renderCutoffs() {
    var container = document.getElementById("cutoffs");
    if (!container) return;
    if (!state.cutoffs || !state.cutoffs.cutoffs) {
      container.innerHTML = "";
      return;
    }
    var bracketCutoffs = state.cutoffs.cutoffs[state.bracket];
    if (!bracketCutoffs || bracketCutoffs.length === 0) {
      container.innerHTML = "";
      return;
    }

    var entries = state.data[state.bracket] || [];
    var html = "";
    for (var i = 0; i < bracketCutoffs.length; i++) {
      var c = bracketCutoffs[i];
      var cls = cutoffTierClass(c.title);
      var icon = cutoffTierIcon(c.title);

      var rankText = "";
      if (entries.length > 0) {
        var count = 0;
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].rating >= c.rating) count++;
        }
        if (count > 0) rankText = "~" + count + "위";
      }

      html += '<div class="cutoff-badge ' + cls + '">' +
        '<div class="cutoff-icon">' + icon + '</div>' +
        '<div class="cutoff-info">' +
        '<div class="cutoff-title">' + esc(c.title) + '</div>' +
        '<div class="cutoff-rating">' + c.rating + (rankText ? '<span class="cutoff-rank">' + rankText + '</span>' : '') + '</div>' +
        '</div></div>';
    }
    container.innerHTML = html;
  }

  function fetchJSON(url) {
    var bustUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + "_t=" + Date.now() + "-" + Math.random().toString(36).slice(2);
    return fetch(bustUrl, { cache: "no-store" }).then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.json();
    });
  }

  function loadSeasonsIndex() {
    return fetchJSON(SEASONS_INDEX_PATH).then(function (index) {
      var seasons = index && index.seasons;
      state.seasons = Array.isArray(seasons) ? seasons.slice() : [];
      state.seasons.sort(function (a, b) { return normalizeSeasonId(a.id) - normalizeSeasonId(b.id); });
      state.currentSeasonId = normalizeSeasonId(index && index.current_season_id);
      if (!state.currentSeasonId && state.seasons.length > 0) {
        state.currentSeasonId = normalizeSeasonId(state.seasons[state.seasons.length - 1].id);
      }
      state.seasonId = findSeason(state.pendingSeasonId) ? state.pendingSeasonId : state.currentSeasonId;
      renderSeasonSelect();
    }).catch(function () {
      state.seasons = [{ id: 1, label: "시즌 1", path: DATA_BASE, status: "current" }];
      state.currentSeasonId = 1;
      state.seasonId = 1;
      renderSeasonSelect();
    });
  }

  function renderSeasonSelect() {
    var select = els.seasonSelect();
    var wrap = els.seasonSelectWrap();
    if (!select || !wrap) return;
    if (!state.seasons || state.seasons.length === 0) {
      select.innerHTML = "";
      wrap.hidden = true;
      return;
    }
    var html = "";
    for (var i = 0; i < state.seasons.length; i++) {
      var season = state.seasons[i];
      var id = normalizeSeasonId(season.id);
      var status = season.status === "current" ? " · 진행중" : "";
      html += '<option value="' + id + '"' + (id === state.seasonId ? ' selected' : '') + '>' +
        esc(season.label || ("시즌 " + id)) + status + '</option>';
    }
    select.innerHTML = html;
    wrap.hidden = false;
  }

  function loadData() {
    showLoading(true);
    var season = currentSeason();
    var base = seasonPath(season);
    fetchDataSet(base).catch(function () {
      if (base !== DATA_BASE) return fetchDataSet(DATA_BASE);
      throw new Error("Could not load leaderboard data");
    }).then(function (results) {
      state.meta = results[0];
      BRACKETS.forEach(function (b, i) { state.data[b] = results[i + 1]; });
      state.cutoffs = results[BRACKETS.length + 1];
    }).catch(function () {
      state.meta = null;
      BRACKETS.forEach(function (b) { state.data[b] = []; });
      state.cutoffs = null;
    }).finally(function () {
      showLoading(false);
      updateMeta();
      renderCutoffs();
      render();
    });
  }

  function fetchDataSet(base) {
    var promises = [fetchJSON(base + "/meta.json")];
    BRACKETS.forEach(function (b) {
      promises.push(fetchJSON(base + "/" + b + ".json").catch(function () { return []; }));
    });
    promises.push(fetchJSON(base + "/cutoffs.json").catch(function () { return null; }));
    return Promise.all(promises);
  }

  function syncURL(push) {
    var params = new URLSearchParams();
    if (state.seasonId && state.seasonId !== state.currentSeasonId) params.set("season", state.seasonId);
    params.set("bracket", state.bracket);
    if (state.page > 1) params.set("page", state.page);
    var qs = "?" + params.toString();
    if (window.location.search === qs) return;
    var newURL = window.location.pathname + qs;
    if (push) {
      history.pushState(null, "", newURL);
    } else {
      history.replaceState(null, "", newURL);
    }
  }

  function readURL() {
    var params = new URLSearchParams(window.location.search);
    state.pendingSeasonId = normalizeSeasonId(params.get("season"));
    if (state.seasons.length > 0) {
      state.seasonId = findSeason(state.pendingSeasonId) ? state.pendingSeasonId : state.currentSeasonId;
    }
    var b = params.get("bracket");
    if (b && BRACKETS.indexOf(b) !== -1) state.bracket = b;
    var p = parseInt(params.get("page"), 10);
    state.page = p && p > 0 ? p : 1;
  }

  function setActiveTab() {
    var tabs = $$(".tab");
    for (var j = 0; j < tabs.length; j++) {
      var isActive = tabs[j].dataset.bracket === state.bracket;
      tabs[j].classList.toggle("active", isActive);
      tabs[j].setAttribute("aria-selected", isActive ? "true" : "false");
    }
  }

  function initTabs() {
    var tabs = $$(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        state.bracket = this.dataset.bracket;
        state.page = 1;
        state.sort = { key: null, asc: true };
        setActiveTab();
        updateMeta();
        renderCutoffs();
        render();
        syncURL(true);
      });
    }
  }

  function initSeasonSelect() {
    var select = els.seasonSelect();
    if (!select) return;
    select.addEventListener("change", function () {
      var seasonId = normalizeSeasonId(select.value);
      if (!seasonId || seasonId === state.seasonId) return;
      state.seasonId = seasonId;
      state.pendingSeasonId = seasonId;
      state.page = 1;
      state.sort = { key: null, asc: true };
      renderSeasonSelect();
      loadData();
      syncURL(true);
    });
  }

  function initPagination() {
    var container = document.getElementById("pagination");
    if (!container) return;
    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-page]");
      if (!btn || btn.classList.contains("disabled")) return;
      var val = btn.dataset.page;
      var filtered = getFiltered();
      var totalPages = getTotalPages(filtered);
      if (val === "prev") {
        state.page = Math.max(1, state.page - 1);
      } else if (val === "next") {
        state.page = Math.min(totalPages, state.page + 1);
      } else {
        state.page = parseInt(val, 10);
      }
      render();
      syncURL(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function initSearch() {
    var timer;
    els.search().addEventListener("input", function (e) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.search = e.target.value;
        state.page = 1;
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

  function init() {
    readURL();
    setActiveTab();
    initSeasonSelect();
    initTabs();
    initSearch();
    initSort();
    initPagination();
    loadSeasonsIndex().then(function () {
      syncURL(false);
      loadData();
    });

    window.addEventListener("popstate", function () {
      readURL();
      setActiveTab();
      renderSeasonSelect();
      loadData();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
