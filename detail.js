(function () {
  "use strict";

  var SUPABASE_URL = "";
  var SUPABASE_ANON_KEY = "";
  var CONFIG_PATH = "config/supabase.json";
  var ALL_CHARS_PATH = "data/all_characters.json";

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

  // --- Talents (dual spec support) ---

  function getSpecGroups(extras) {
    if (extras.spec_groups && extras.spec_groups.length > 0) return extras.spec_groups;
    if (extras.talents && extras.talents.length > 0) {
      return [{ active: true, trees: extras.talents }];
    }
    return [];
  }

  function renderSpecTabs(specGroups) {
    var tabContainer = $("#spec-tabs");
    tabContainer.innerHTML = "";
    if (specGroups.length <= 1) return;

    for (var i = 0; i < specGroups.length; i++) {
      var g = specGroups[i];
      var label = g.active ? "활성 특성" : "이중 특성";
      var summary = g.trees.filter(function (t) { return t.points > 0; })
        .map(function (t) { return t.points; }).join("/");
      if (summary) label += " (" + summary + ")";
      var btn = document.createElement("button");
      btn.className = "spec-tab" + (g.active ? " active" : "");
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
      renderTalentTrees(groups[idx].trees);
    }
  }

  function renderTalents(extras) {
    var section = $("#talents-section");
    if (!extras) return;
    var groups = getSpecGroups(extras);
    if (groups.length === 0) return;

    state._specGroups = groups;
    renderSpecTabs(groups);

    var activeGroup = groups.find(function (g) { return g.active; }) || groups[0];
    renderTalentTrees(activeGroup.trees);
    section.hidden = false;
  }

  function renderTalentTrees(trees) {
    var container = $("#talent-trees");
    container.innerHTML = "";
    var maxPoints = 61;

    for (var i = 0; i < trees.length; i++) {
      var tree = trees[i];
      if (tree.points === 0) continue;
      var pct = Math.min(100, Math.round(tree.points / maxPoints * 100));
      var div = document.createElement("div");
      div.className = "talent-tree";
      var html =
        '<div class="talent-tree-header">' +
          '<span class="talent-tree-name">' + esc(tree.name) + '</span>' +
          '<span class="talent-tree-points">' + tree.points + '</span>' +
        '</div>' +
        '<div class="talent-bar-track">' +
          '<div class="talent-bar-fill tree-' + i + '" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<div class="talent-list">';
      for (var j = 0; j < tree.talents.length; j++) {
        var t = tree.talents[j];
        html += '<span class="talent-pill">' + esc(t.name) +
                ' <span class="talent-pill-rank">' + t.rank + '</span></span>';
      }
      html += '</div>';
      div.innerHTML = html;
      container.appendChild(div);
    }
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
    var configured = await configPromise;
    var extras = await extrasPromise;

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
