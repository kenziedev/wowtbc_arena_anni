(function () {
  "use strict";

  var SUPABASE_URL = "";
  var SUPABASE_ANON_KEY = "";
  var CONFIG_PATH = "config/supabase.json";
  var ALL_CHARS_PATH = "data/all_characters.json";
  var TALENT_DEFS_PATH = "data/talent_defs.json";

  var BRACKET_COLORS = {
    "2v2": { line: "#58a6ff", bg: "rgba(88,166,255,0.1)" },
    "3v3": { line: "#3fb950", bg: "rgba(63,185,80,0.1)" },
    "5v5": { line: "#f0ab00", bg: "rgba(240,171,0,0.1)" },
  };

  var chart = null;
  var state = { charId: null, name: "", realm: "", snapshots: [], activeBracket: null };

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function getParams() {
    var params = new URLSearchParams(window.location.search);
    return { name: params.get("name") || "", realm: params.get("realm") || "" };
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    function pad(n) { return String(n).padStart(2, "0"); }
    return (d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function formatDateShort(iso) {
    var d = new Date(iso);
    function pad(n) { return String(n).padStart(2, "0"); }
    return (d.getMonth() + 1) + "/" + pad(d.getDate());
  }

  function fetchJSON(url) {
    var bustUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + "_t=" + Date.now();
    return fetch(bustUrl).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function showLoading(show) {
    $("#loading").hidden = !show;
    var sections = [".chart-section", ".history-section"];
    for (var i = 0; i < sections.length; i++) {
      var el = $(sections[i]);
      if (el) el.style.display = show ? "none" : "";
    }
  }

  function showEmpty() {
    showLoading(false);
    $("#empty-state").hidden = false;
  }

  async function loadConfig() {
    try {
      var cfg = await fetchJSON(CONFIG_PATH);
      SUPABASE_URL = cfg.url || "";
      SUPABASE_ANON_KEY = cfg.anon_key || "";
      return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
    } catch (e) {
      return false;
    }
  }

  async function supabaseGet(path) {
    var resp = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
      headers: {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + SUPABASE_ANON_KEY,
      },
    });
    if (!resp.ok) return null;
    return resp.json();
  }

  async function loadCharacter(name, realm) {
    var chars = await supabaseGet(
      "characters?name=eq." + encodeURIComponent(name) +
      "&realm=eq." + encodeURIComponent(realm) +
      "&limit=1"
    );
    if (!chars || chars.length === 0) return null;
    return chars[0];
  }

  async function loadSnapshots(charId) {
    var snaps = await supabaseGet(
      "rating_snapshots?character_id=eq." + charId +
      "&order=recorded_at.asc"
    );
    return snaps || [];
  }

  async function loadCharacterExtras(name, realm) {
    try {
      var all = await fetchJSON(ALL_CHARS_PATH);
      var nameLower = name.toLowerCase();
      for (var i = 0; i < all.length; i++) {
        if (all[i].name.toLowerCase() === nameLower && all[i].realm === realm) {
          return all[i];
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function renderHeader(char, extras) {
    $("#char-name").textContent = char.name;
    var parts = [];
    var race = (extras && extras.race) || char.race || "";
    var cls = (extras && extras["class"]) || char["class"] || "";
    var guild = (extras && extras.guild) || char.guild || "";
    var faction = (extras && extras.faction) || char.faction || "";
    if (race) parts.push(race);
    if (cls) parts.push(cls);
    if (guild) parts.push("<" + guild + ">");
    var factionLabel = faction === "HORDE" ? "호드" : faction === "ALLIANCE" ? "얼라이언스" : "";
    if (factionLabel) parts.push(factionLabel);
    $("#char-info").textContent = parts.join(" · ");
    document.title = char.name + " - TBC 투기장";
  }

  function renderAvatar(extras) {
    var profile = $("#char-profile");
    var img = $("#char-avatar");
    if (extras && extras.avatar) {
      img.src = extras.avatar;
      img.alt = extras.name;
      profile.hidden = false;
    } else {
      img.style.display = "none";
      profile.hidden = false;
    }
  }

  function renderCards(snapshots) {
    var container = $("#detail-cards");
    container.innerHTML = "";
    var brackets = {};
    for (var i = 0; i < snapshots.length; i++) {
      var s = snapshots[i];
      if (!brackets[s.bracket] || new Date(s.recorded_at) > new Date(brackets[s.bracket].recorded_at)) {
        brackets[s.bracket] = s;
      }
    }
    var order = ["2v2", "3v3", "5v5"];
    for (var j = 0; j < order.length; j++) {
      var b = order[j];
      var data = brackets[b];
      if (!data) continue;
      var total = data.won + data.lost;
      var wr = total > 0 ? (data.won / total * 100).toFixed(1) : "0.0";
      var card = document.createElement("div");
      card.className = "detail-card";
      card.innerHTML =
        '<div class="card-bracket">' + b + '</div>' +
        '<div class="card-rating">' + data.rating + '</div>' +
        '<div class="card-record">' + data.won + '승 ' + data.lost + '패 (' + wr + '%)</div>';
      container.appendChild(card);
    }
  }

  // --- Talent Tree (visual grid) ---

  var talentDefs = null;
  var tooltipEl = null;

  async function loadTalentDefs() {
    try {
      talentDefs = await fetchJSON(TALENT_DEFS_PATH);
    } catch (e) { talentDefs = null; }
  }

  function getSpecGroups(extras) {
    if (extras.spec_groups && extras.spec_groups.length > 0) return extras.spec_groups;
    if (extras.talents && extras.talents.length > 0) {
      return [{ active: true, trees: extras.talents }];
    }
    return [];
  }

  function findClassDef(className) {
    if (!talentDefs) return null;
    for (var key in talentDefs) {
      if (talentDefs[key].ko === className) return talentDefs[key];
    }
    return null;
  }

  function findTreeDef(classDef, treeName) {
    if (!classDef) return null;
    for (var i = 0; i < classDef.trees.length; i++) {
      if (classDef.trees[i].ko === treeName) return classDef.trees[i];
    }
    return null;
  }

  function buildLearnedMap(charTalents) {
    var map = {};
    for (var i = 0; i < charTalents.length; i++) {
      var t = charTalents[i];
      if (t.icon) map[t.icon] = t;
    }
    return map;
  }

  function renderSpecTabs(specGroups) {
    var tabContainer = $("#spec-tabs");
    tabContainer.innerHTML = "";

    for (var i = 0; i < specGroups.length; i++) {
      var g = specGroups[i];
      var label = "특성" + (i + 1);
      if (g.active) label += " (active)";
      var summary = g.trees.filter(function (t) { return t.points > 0; })
        .map(function (t) { return t.points; }).join("/");
      if (summary) label += " " + summary;
      var btn = document.createElement("button");
      btn.className = "spec-tab" + (i === 0 ? " active" : "");
      btn.textContent = label;
      btn.dataset.idx = String(i);
      btn.addEventListener("click", onSpecTabClick);
      tabContainer.appendChild(btn);
    }
  }

  function onSpecTabClick() {
    var tabs = document.querySelectorAll(".spec-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
    this.classList.add("active");
    var idx = parseInt(this.dataset.idx, 10);
    var groups = state._specGroups;
    if (groups && groups[idx]) {
      renderTalentTreesGrid(groups[idx].trees);
    }
  }

  function renderTalents(extras) {
    var section = $("#talents-section");
    if (!extras) return;
    var groups = getSpecGroups(extras);
    if (groups.length === 0) return;

    state._specGroups = groups;
    renderSpecTabs(groups);

    var first = groups[0];
    renderTalentTreesGrid(first.trees);
    section.hidden = false;
  }

  function renderTalentTreesGrid(charTrees) {
    var container = $("#talent-trees");
    container.innerHTML = "";

    var className = state._className || "";
    var classDef = findClassDef(className);

    if (!classDef) {
      renderTalentTreesFallback(charTrees, container);
      return;
    }

    for (var ti = 0; ti < classDef.trees.length; ti++) {
      var treeDef = classDef.trees[ti];
      var charTree = null;
      for (var ci = 0; ci < charTrees.length; ci++) {
        if (charTrees[ci].name === treeDef.ko) { charTree = charTrees[ci]; break; }
      }

      var learnedMap = charTree ? buildLearnedMap(charTree.talents) : {};
      var points = charTree ? (charTree.points || 0) : 0;
      var maxTier = Math.ceil(treeDef.grid.length / 4);

      var panel = document.createElement("div");
      panel.className = "tree-panel";

      var header = document.createElement("div");
      header.className = "tree-panel-header";
      header.innerHTML = '<span class="tree-panel-name">' + esc(treeDef.ko || treeDef.name) +
        '</span><span class="tree-panel-points">' + points + '</span>';
      panel.appendChild(header);

      var grid = document.createElement("div");
      grid.className = "tree-grid";
      grid.style.gridTemplateRows = "repeat(" + maxTier + ", 44px)";

      for (var gi = 0; gi < treeDef.grid.length; gi++) {
        var def = treeDef.grid[gi];
        if (def === null) continue;

        var row = Math.floor(gi / 4) + 1;
        var col = (gi % 4) + 1;

        var learned = learnedMap[def.icon] || null;
        var curRank = learned ? learned.rank : 0;
        var maxRank = def.max_rank || 1;

        var nodeClass = "talent-node";
        if (curRank >= maxRank) nodeClass += " full";
        else if (curRank > 0) nodeClass += " partial";
        else nodeClass += " unlearned";

        var node = document.createElement("div");
        node.className = nodeClass;
        node.style.gridRow = String(row);
        node.style.gridColumn = String(col);

        node.innerHTML =
          '<img src="icons/' + def.icon + '.jpg" alt="' + esc(def.name) + '" loading="lazy" />' +
          '<span class="talent-rank-label">' + curRank + '/' + maxRank + '</span>';

        node._talentDef = def;
        node._curRank = curRank;
        node._charTalent = learned;
        node.addEventListener("mouseenter", onTalentHover);
        node.addEventListener("mousemove", onTalentMove);
        node.addEventListener("mouseleave", onTalentLeave);

        grid.appendChild(node);
      }

      panel.appendChild(grid);
      container.appendChild(panel);
    }
  }

  function renderTalentTreesFallback(trees, container) {
    for (var i = 0; i < trees.length; i++) {
      var tree = trees[i];
      if (tree.points === 0) continue;
      var div = document.createElement("div");
      div.className = "tree-panel";
      var html = '<div class="tree-panel-header"><span class="tree-panel-name">' +
        esc(tree.name) + '</span><span class="tree-panel-points">' +
        tree.points + '</span></div><div class="talent-list-fallback">';
      for (var j = 0; j < tree.talents.length; j++) {
        var t = tree.talents[j];
        var iconSrc = t.icon ? 'icons/' + t.icon + '.jpg' : '';
        html += '<div class="talent-fb-item">';
        if (iconSrc) html += '<img src="' + iconSrc + '" class="talent-fb-icon" />';
        html += '<span>' + esc(t.name) + '</span><span class="talent-fb-rank">' + t.rank + '</span></div>';
      }
      html += '</div>';
      div.innerHTML = html;
      container.appendChild(div);
    }
  }

  function onTalentHover(e) {
    if (!tooltipEl) tooltipEl = $("#talent-tooltip");
    var def = this._talentDef;
    var curRank = this._curRank;
    var charTalent = this._charTalent;
    var maxRank = def.max_rank || 1;

    var name = charTalent ? charTalent.name : def.name;
    var desc = "";
    if (def.descriptions && def.descriptions.length > 0) {
      var ri = curRank > 0 ? Math.min(curRank, def.descriptions.length) - 1 : 0;
      desc = def.descriptions[ri];
    }

    var html = '<div class="tt-name">' + esc(name) + '</div>' +
      '<div class="tt-rank">랭크 ' + curRank + ' / ' + maxRank + '</div>';
    if (desc) html += '<div class="tt-desc">' + esc(desc) + '</div>';

    tooltipEl.innerHTML = html;
    tooltipEl.style.display = "block";
    positionTooltip(e);
  }

  function onTalentMove(e) { positionTooltip(e); }

  function onTalentLeave() {
    if (tooltipEl) tooltipEl.style.display = "none";
  }

  function positionTooltip(e) {
    if (!tooltipEl) return;
    var x = e.clientX + 16;
    var y = e.clientY + 16;
    if (x + 320 > window.innerWidth) x = e.clientX - 320;
    if (y + 200 > window.innerHeight) y = e.clientY - 200;
    tooltipEl.style.left = x + "px";
    tooltipEl.style.top = y + "px";
  }

  // --- Equipment (icons + enchants) ---

  var SLOT_ORDER = [
    "HEAD", "NECK", "SHOULDER", "BACK", "CHEST", "WRIST",
    "HANDS", "WAIST", "LEGS", "FEET",
    "FINGER_1", "FINGER_2", "TRINKET_1", "TRINKET_2",
    "MAIN_HAND", "OFF_HAND", "RANGED"
  ];

  function renderEquipment(extras) {
    var section = $("#equipment-section");
    var container = $("#equipment-grid");
    if (!extras || !extras.equipment || extras.equipment.length === 0) return;

    var items = extras.equipment.slice();
    items.sort(function (a, b) {
      var ai = SLOT_ORDER.indexOf(a.slot_type);
      var bi = SLOT_ORDER.indexOf(b.slot_type);
      if (ai === -1) ai = 99;
      if (bi === -1) bi = 99;
      return ai - bi;
    });

    container.innerHTML = "";
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var qualityClass = "quality-" + (item.quality_type || "COMMON");
      var borderClass = "icon-border-" + (item.quality_type || "COMMON");

      var div = document.createElement("div");
      div.className = "equip-item";

      var iconHtml = '';
      if (item.icon) {
        iconHtml = '<img class="equip-icon ' + borderClass + '" src="' + esc(item.icon) + '" alt="" loading="lazy" />';
      } else {
        iconHtml = '<div class="equip-icon equip-icon-empty ' + borderClass + '"></div>';
      }

      var enchantHtml = '';
      if (item.enchants && item.enchants.length > 0) {
        for (var e = 0; e < item.enchants.length; e++) {
          var ench = item.enchants[e];
          if (ench.type === "PERMANENT") {
            enchantHtml += '<div class="equip-enchant">' + esc(ench.text) + '</div>';
          } else if (ench.type === "GEM") {
            enchantHtml += '<div class="equip-gem">' + esc(ench.source || ench.text) + '</div>';
          }
        }
      }

      div.innerHTML =
        iconHtml +
        '<div class="equip-info">' +
          '<div class="equip-name ' + qualityClass + '">' + esc(item.name) + '</div>' +
          '<div class="equip-slot-label">' + esc(item.slot) + '</div>' +
          enchantHtml +
        '</div>';
      container.appendChild(div);
    }
    section.hidden = false;
  }

  // --- Chart ---

  function renderChartTabs(snapshots) {
    var container = $("#chart-tabs");
    container.innerHTML = "";
    var brackets = {};
    for (var i = 0; i < snapshots.length; i++) {
      brackets[snapshots[i].bracket] = true;
    }
    var order = ["2v2", "3v3", "5v5"];
    var first = true;
    for (var j = 0; j < order.length; j++) {
      var b = order[j];
      if (!brackets[b]) continue;
      var btn = document.createElement("button");
      btn.className = "chart-tab" + (first ? " active" : "");
      btn.textContent = b;
      btn.dataset.bracket = b;
      btn.addEventListener("click", onChartTabClick);
      container.appendChild(btn);
      if (first) {
        state.activeBracket = b;
        first = false;
      }
    }
  }

  function onChartTabClick() {
    var tabs = document.querySelectorAll(".chart-tab");
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
    this.classList.add("active");
    state.activeBracket = this.dataset.bracket;
    renderChart(state.snapshots, state.activeBracket);
    renderHistory(state.snapshots, state.activeBracket);
  }

  function renderChart(snapshots, bracket) {
    var filtered = snapshots.filter(function (s) { return s.bracket === bracket; });
    var labels = filtered.map(function (s) { return formatDateShort(s.recorded_at); });
    var ratings = filtered.map(function (s) { return s.rating; });
    var ctx = $("#rating-chart").getContext("2d");
    var colors = BRACKET_COLORS[bracket] || BRACKET_COLORS["5v5"];
    if (chart) chart.destroy();
    chart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: bracket + " 레이팅",
          data: ratings,
          borderColor: colors.line,
          backgroundColor: colors.bg,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) { return "레이팅: " + ctx.parsed.y; },
            },
          },
        },
        scales: {
          x: { ticks: { color: "#8b949e" }, grid: { color: "rgba(48,54,61,0.5)" } },
          y: { ticks: { color: "#8b949e" }, grid: { color: "rgba(48,54,61,0.5)" } },
        },
      },
    });
  }

  function renderHistory(snapshots, bracket) {
    var filtered = snapshots.filter(function (s) { return s.bracket === bracket; });
    filtered.sort(function (a, b) { return new Date(b.recorded_at) - new Date(a.recorded_at); });
    var body = $("#history-body");
    body.innerHTML = "";
    for (var i = 0; i < filtered.length; i++) {
      var s = filtered[i];
      var prev = filtered[i + 1];
      var diff = prev ? s.rating - prev.rating : 0;
      var diffClass = diff > 0 ? "winrate-high" : diff < 0 ? "winrate-low" : "";
      var diffText = diff > 0 ? "+" + diff : diff === 0 ? "-" : String(diff);
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + formatDate(s.recorded_at) + "</td>" +
        "<td>" + s.bracket + "</td>" +
        "<td>" + s.rating + "</td>" +
        "<td>" + s.won + "승 " + s.lost + "패</td>" +
        '<td class="' + diffClass + '">' + diffText + "</td>";
      body.appendChild(tr);
    }
  }

  // --- Init ---

  async function init() {
    showLoading(true);
    var params = getParams();
    if (!params.name || !params.realm) { showEmpty(); return; }

    var configPromise = loadConfig();
    var extrasPromise = loadCharacterExtras(params.name, params.realm);
    var talentDefsPromise = loadTalentDefs();
    var configured = await configPromise;
    var extras = await extrasPromise;
    await talentDefsPromise;

    var char = null;
    var snapshots = [];

    if (configured) {
      char = await loadCharacter(params.name, params.realm);
      if (char) {
        snapshots = await loadSnapshots(char.id);
      }
    }

    if (!char && extras) {
      char = { name: extras.name, realm: extras.realm, race: extras.race, "class": extras["class"], guild: extras.guild, faction: extras.faction };
    }
    if (!char) { showEmpty(); return; }

    state.charId = char.id;
    state.name = char.name;
    state.realm = char.realm;

    state._className = (extras && extras["class"]) || char["class"] || "";
    renderHeader(char, extras);
    renderAvatar(extras);

    if (snapshots.length > 0) {
      state.snapshots = snapshots;
      renderCards(snapshots);
      renderChartTabs(snapshots);
      renderChart(snapshots, state.activeBracket);
      renderHistory(snapshots, state.activeBracket);
    }

    renderEquipment(extras);
    renderTalents(extras);

    showLoading(false);
    $("#empty-state").hidden = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
