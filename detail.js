(function () {
  "use strict";

  var SUPABASE_URL = "";
  var SUPABASE_ANON_KEY = "";
  var CONFIG_PATH = "config/supabase.json";

  var BRACKET_COLORS = {
    "2v2": { line: "#58a6ff", bg: "rgba(88,166,255,0.1)" },
    "3v3": { line: "#3fb950", bg: "rgba(63,185,80,0.1)" },
    "5v5": { line: "#f0ab00", bg: "rgba(240,171,0,0.1)" },
  };

  var chart = null;
  var state = { charId: null, name: "", realm: "", snapshots: [], activeBracket: null };

  function $(sel) { return document.querySelector(sel); }

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

  function showLoading(show) {
    $("#loading").hidden = !show;
    $(".detail-cards").style.display = show ? "none" : "";
    $(".chart-section").style.display = show ? "none" : "";
    $(".history-section").style.display = show ? "none" : "";
  }

  function showEmpty() {
    showLoading(false);
    $("#empty-state").hidden = false;
    $(".detail-cards").style.display = "none";
    $(".chart-section").style.display = "none";
    $(".history-section").style.display = "none";
  }

  async function loadConfig() {
    try {
      var resp = await fetch(CONFIG_PATH + "?_t=" + Date.now());
      if (!resp.ok) return false;
      var cfg = await resp.json();
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

  function renderHeader(char) {
    $("#char-name").textContent = char.name;
    var parts = [];
    if (char.race) parts.push(char.race);
    if (char["class"]) parts.push(char["class"]);
    if (char.guild) parts.push("<" + char.guild + ">");
    var factionLabel = char.faction === "HORDE" ? "호드" : char.faction === "ALLIANCE" ? "얼라이언스" : "";
    if (factionLabel) parts.push(factionLabel);
    $("#char-info").textContent = parts.join(" · ");
    document.title = char.name + " - TBC 투기장";
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
          x: {
            ticks: { color: "#8b949e" },
            grid: { color: "rgba(48,54,61,0.5)" },
          },
          y: {
            ticks: { color: "#8b949e" },
            grid: { color: "rgba(48,54,61,0.5)" },
          },
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

  async function init() {
    showLoading(true);

    var params = getParams();
    if (!params.name || !params.realm) {
      showEmpty();
      return;
    }

    var configured = await loadConfig();
    if (!configured) {
      showEmpty();
      return;
    }

    var char = await loadCharacter(params.name, params.realm);
    if (!char) {
      showEmpty();
      return;
    }

    state.charId = char.id;
    state.name = char.name;
    state.realm = char.realm;

    var snapshots = await loadSnapshots(char.id);
    if (snapshots.length === 0) {
      showEmpty();
      return;
    }

    state.snapshots = snapshots;
    renderHeader(char);
    renderCards(snapshots);
    renderChartTabs(snapshots);
    renderChart(snapshots, state.activeBracket);
    renderHistory(snapshots, state.activeBracket);
    showLoading(false);
    $("#empty-state").hidden = true;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
