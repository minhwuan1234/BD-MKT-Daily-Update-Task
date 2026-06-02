window.TOOL_REGISTRY = window.TOOL_REGISTRY || [];

window.TOOL_REGISTRY.push({
  id:          "bd-mkt-daily",
  name:        "BD-MKT Daily Report",
  description: "Tracking morning/evening submit va plan vs actual cua team BD-MKT.",
  icon:        "ti-sun-moon",
  status:      "active",

  _APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyFQ5nPA7qvqjpokqtOCURdntTkRfu3u2md1VcNFBwuTRlvMR1DANUpMXm_2wqP58bP/exec",

  _MEMBERS: {
    "ou_72582d819ebd02dbe9cc0e2e08908099": "Minh Quân",
    "ou_3ff4b0c1ae98c259c7006993a41e8d84": "Huyền Linh",
    "ou_1f71198623d1dc71688fe1312390f7ee": "Nga Linh",
    "ou_d7d124081bfa6eabfb12e85166eca85f": "Giang",
    "ou_db7bca8d6a07437aaab422849ddc2c69": "Chi",
  },

  /* ══════════════════════════════
     FETCH DATA — 1 request tu Sheets
     ══════════════════════════════ */
  fetchData: async function(utils) {
    var res = await utils.fetchJson(this._APPS_SCRIPT_URL + "?t=" + Date.now());
    if (!res.ok) throw new Error("Sheets API error");

    var rows         = res.data || [];
    var MEMBERS      = this._MEMBERS;
    var memberNames  = Object.values(MEMBERS);
    var totalMembers = memberNames.length;

    // Ngay hom nay theo VN timezone
    var now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    var todayStr = now.getFullYear() + "-" +
      String(now.getMonth()+1).padStart(2,"0") + "-" +
      String(now.getDate()).padStart(2,"0");

    // Filter rows hom nay
    var todayRows = rows.filter(function(r) { return r["Date"] === todayStr; });
    var todayMorning = {};
    var todayEvening = {};

    todayRows.forEach(function(r) {
      var member = r["Member"];
      var type   = r["Type"];

      var tasks = [];
      for (var i = 1; i <= 2; i++) {
        var title = r["Task " + i];
        if (!title) continue;
        tasks.push({
          title:        title,
          output:       r["Output "   + i] || "—",
          expectedTime: r["Expected " + i] || "—",
          progress:     r["Progress " + i] || "—",
          timeSpent:    r["TimeSpent "+ i] || "—",
        });
      }

      var entry = {
        memberName:   member,
        tasks:        tasks,
        submittedAt:  r["Submitted At"]  || "",
        blockers:     r["Blockers"]      || "",
        tomorrowPlan: r["Tomorrow Plan"] || "",
        weeklyGoal:   r["Weekly Goal"]   || "",
      };

      if (type === "morning") todayMorning[member] = entry;
      if (type === "evening") todayEvening[member] = entry;
    });

    // Chart 30 ngay
    var days = [];
    for (var i = 29; i >= 0; i--) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      var ds  = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
      var lbl = String(d.getDate()).padStart(2,"0") + "/" + String(d.getMonth()+1).padStart(2,"0");
      days.push({ dateStr: ds, label: lbl, morning: 0, evening: 0 });
    }

    rows.forEach(function(r) {
      var day = days.find(function(d) { return d.dateStr === r["Date"]; });
      if (!day) return;
      if (r["Type"] === "morning") day.morning++;
      if (r["Type"] === "evening") day.evening++;
    });

    var morningCount = Object.keys(todayMorning).length;
    var eveningCount = Object.keys(todayEvening).length;

    return {
      totalMembers: totalMembers,
      morningCount: morningCount,
      eveningCount: eveningCount,
      morningRate:  totalMembers > 0 ? Math.round(morningCount / totalMembers * 100) : 0,
      eveningRate:  totalMembers > 0 ? Math.round(eveningCount / totalMembers * 100) : 0,
      memberNames:  memberNames,
      memberIds:    Object.keys(MEMBERS),
      members:      MEMBERS,
      todayMorning: todayMorning,
      todayEvening: todayEvening,
      chartDays:    days,
      todayStr:     todayStr,
      allRows:      rows,
    };
  },

  /* ══════════════════════════════
     RENDER CARD
     ══════════════════════════════ */
  renderCard: function(data) {
    var mc = data.morningRate >= 80 ? "green" : data.morningRate >= 50 ? "amber" : "red";
    var ec = data.eveningRate >= 80 ? "green" : data.eveningRate >= 50 ? "amber" : "red";
    return '<div class="tool-metrics">' +
      '<div class="tool-metric"><span class="metric-value ' + mc + '">' + data.morningCount + '/' + data.totalMembers + '</span><span class="metric-label">☀️ Morning</span></div>' +
      '<div class="tool-metric"><span class="metric-value ' + ec + '">' + data.eveningCount + '/' + data.totalMembers + '</span><span class="metric-label">🌙 Evening</span></div>' +
      '</div>' +
      '<div class="mini-bar-wrap" style="margin-top:8px">' +
        '<span style="font-size:10px;color:var(--text-muted);width:52px">Morning</span>' +
        '<div class="mini-bar"><div class="mini-bar-fill ' + (data.morningRate < 80 ? data.morningRate >= 50 ? "amber" : "red" : "") + '" style="width:' + data.morningRate + '%"></div></div>' +
        '<span class="mini-bar-pct">' + data.morningRate + '%</span>' +
      '</div>' +
      '<div class="mini-bar-wrap" style="margin-top:4px">' +
        '<span style="font-size:10px;color:var(--text-muted);width:52px">Evening</span>' +
        '<div class="mini-bar"><div class="mini-bar-fill ' + (data.eveningRate < 80 ? data.eveningRate >= 50 ? "amber" : "red" : "") + '" style="width:' + data.eveningRate + '%"></div></div>' +
        '<span class="mini-bar-pct">' + data.eveningRate + '%</span>' +
      '</div>';
  },

  /* ══════════════════════════════
     RENDER DETAIL
     ══════════════════════════════ */
  renderDetail: function(data, utils) {
    if (!data || data._error) return '<div class="state-error"><i class="ti ti-alert-circle"></i> Khong the tai data</div>';
    if (data._loading) return '<div class="state-loading"><div class="spinner"></div><p>Dang tai...</p></div>';

    var tabBar =
      '<div class="tab-bar">' +
        '<button class="tab-btn active" data-tab="tracking"><i class="ti ti-chart-bar"></i> Tracking</button>' +
        '<button class="tab-btn" data-tab="info"><i class="ti ti-info-circle"></i> Thong tin tool</button>' +
      '</div>' +
      '<div id="tab-tracking" class="tab-pane"></div>' +
      '<div id="tab-info" class="tab-pane" style="display:none"></div>';

    /* ── Stats ── */
    var mc = data.morningRate >= 80 ? "green" : data.morningRate >= 50 ? "amber" : "red";
    var ec = data.eveningRate >= 80 ? "green" : data.eveningRate >= 50 ? "amber" : "red";
    var bothCount = data.memberNames.filter(function(name) {
      return data.todayMorning[name] && data.todayEvening[name];
    }).length;

    var statsHTML =
      '<div class="detail-stats">' +
        '<div class="stat-card"><span class="stat-label">☀️ Morning submit</span><span class="stat-value ' + mc + '">' + data.morningRate + '%</span><span class="stat-delta">' + data.morningCount + '/' + data.totalMembers + ' members</span></div>' +
        '<div class="stat-card"><span class="stat-label">🌙 Evening submit</span><span class="stat-value ' + ec + '">' + data.eveningRate + '%</span><span class="stat-delta">' + data.eveningCount + '/' + data.totalMembers + ' members</span></div>' +
        '<div class="stat-card"><span class="stat-label">Ca 2 submit</span><span class="stat-value green">' + bothCount + '</span><span class="stat-delta">/ ' + data.totalMembers + ' members</span></div>' +
      '</div>';

    /* ── Chart ── */
    window._bdChartDays = data.chartDays;
    window._bdTotal     = data.totalMembers;
    window._bdAllRows   = data.allRows;

    window._buildBDChart = function(n) {
      var container = document.getElementById("bd-chart-container");
      if (!container) return;
      n = n || 7;
      var allDays = window._bdChartDays || [];
      var days    = allDays.slice(-n);
      var max     = Math.max(window._bdTotal, 1);
      var hasData = days.some(function(d) { return d.morning > 0 || d.evening > 0; });

      if (!hasData) {
        container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--text-muted)"><i class="ti ti-chart-bar-off" style="font-size:28px"></i><span>Chua co du lieu</span></div>';
        return;
      }

      container.innerHTML = days.map(function(d) {
        var mp  = Math.round(d.morning / max * 100);
        var ep  = Math.round(d.evening / max * 100);
        var tip = '<strong>' + d.dateStr + '</strong><br>☀️ Morning: ' + d.morning + '/' + max + '<br>🌙 Evening: ' + d.evening + '/' + max;
        var mBg = mp >= 80 ? "var(--green)"  : mp > 0 ? "var(--accent)" : "var(--bg-hover)";
        var eBg = ep >= 80 ? "var(--blue)"   : ep > 0 ? "var(--yellow)" : "var(--bg-hover)";
        return '<div class="chart-col" data-tip="' + tip.replace(/"/g, "&quot;") + '" data-date="' + d.dateStr + '" data-morning="' + d.morning + '" data-evening="' + d.evening + '">' +
          '<div class="chart-bar-wrap" style="gap:3px;align-items:flex-end">' +
            '<div class="chart-bar" style="flex:1;height:' + Math.max(mp,3) + '%;background:' + mBg + ';border-radius:3px 3px 0 0"></div>' +
            '<div class="chart-bar" style="flex:1;height:' + Math.max(ep,3) + '%;background:' + eBg + ';border-radius:3px 3px 0 0"></div>' +
          '</div>' +
          '<div class="chart-label">' + d.label + '</div>' +
          '<div class="chart-count">' + d.morning + '/' + d.evening + '</div>' +
        '</div>';
      }).join("");

      // Tooltip
      var tip = document.getElementById("_bd_global_tip");
      if (!tip) {
        tip = document.createElement("div");
        tip.id = "_bd_global_tip";
        tip.style.cssText = "position:fixed;z-index:99999;background:var(--bg-surface);border:1px solid var(--border-strong);border-radius:6px;padding:8px 12px;font-size:12px;color:var(--text-primary);white-space:nowrap;line-height:1.6;pointer-events:none;display:none;font-family:var(--font-body)";
        document.body.appendChild(tip);
      }
      container.querySelectorAll(".chart-col").forEach(function(col) {
        col.addEventListener("mouseenter", function() {
          tip.innerHTML = (col.dataset.tip || "").replace(/&quot;/g, '"');
          tip.style.display = "block";
        });
        col.addEventListener("mousemove", function(e) {
          tip.style.left = (e.clientX - tip.offsetWidth / 2) + "px";
          tip.style.top  = (e.clientY - tip.offsetHeight - 14) + "px";
        });
        col.addEventListener("mouseleave", function() { tip.style.display = "none"; });

        if (parseInt(col.dataset.morning) > 0 || parseInt(col.dataset.evening) > 0) {
          col.style.cursor = "pointer";
          col.addEventListener("click", function() {
            var dateStr = col.dataset.date;
            var detail  = document.getElementById("bd-day-detail");
            if (!detail) return;
            if (detail.dataset.activeDate === dateStr && detail.style.display !== "none") {
              detail.style.display = "none";
              detail.dataset.activeDate = "";
              container.querySelectorAll(".chart-col--active").forEach(function(c) { c.classList.remove("chart-col--active"); });
              return;
            }
            container.querySelectorAll(".chart-col--active").forEach(function(c) { c.classList.remove("chart-col--active"); });
            col.classList.add("chart-col--active");
            detail.dataset.activeDate = dateStr;
            detail.style.display = "block";
            window._fetchBDDay(dateStr);
          });
        }
      });
    };

    /* ── Fetch day detail tu allRows ── */
    window._fetchBDDay = function(dateStr) {
      var detail = document.getElementById("bd-day-detail");
      if (!detail) return;

      var rows = (window._bdAllRows || []).filter(function(r) {
        return r["Date"] === dateStr;
      });

      if (!rows.length) {
        detail.innerHTML = '<div class="state-empty" style="padding:24px"><i class="ti ti-inbox" style="font-size:28px"></i><p>Chua co du lieu cho ngay ' + dateStr + '</p></div>';
        return;
      }

      var byMember = {};
      rows.forEach(function(r) {
        var m = r["Member"];
        if (!byMember[m]) byMember[m] = { morning: null, evening: null };
        if (r["Type"] === "morning") byMember[m].morning = r;
        if (r["Type"] === "evening") byMember[m].evening = r;
      });

      var memberRows = Object.entries(byMember).map(function(entry) {
        var name = entry[0];
        var d    = entry[1];

        var mCell = d.morning
          ? '<span class="status-pill submitted" style="font-size:10px">☀️ Submit</span><br><span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">' + (d.morning["Submitted At"] || "") + '</span>'
          : '<span class="status-pill missing" style="font-size:10px">✗ Chua</span>';
        var eCell = d.evening
          ? '<span class="status-pill submitted" style="font-size:10px">🌙 Submit</span><br><span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">' + (d.evening["Submitted At"] || "") + '</span>'
          : '<span class="status-pill missing" style="font-size:10px">✗ Chua</span>';

        var taskCols = "";
        for (var i = 1; i <= 2; i++) {
          var title = d.morning ? (d.morning["Task "     + i] || "") : "";
          var plan  = d.morning ? (d.morning["Expected " + i] || "—") : "—";
          var prog  = d.evening ? (d.evening["Progress " + i] || "") : "";
          var time  = d.evening ? (d.evening["TimeSpent "+ i] || "—") : "—";
          if (!title && i > 1) continue;
          var pc = prog === "100%" ? "done" : prog && parseInt(prog) >= 60 ? "high" : "medium";
          taskCols +=
            '<td style="font-size:12px;color:var(--text-primary)">' + (title || "—") + '</td>' +
            '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' + plan + '</td>' +
            '<td>' + (prog ? '<span class="progress-badge ' + pc + '">' + prog + '</span>' : '<span style="color:var(--text-muted)">—</span>') + '</td>' +
            '<td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);white-space:nowrap">' + time + '</td>';
        }

        return '<tr>' +
          '<td style="font-weight:500;white-space:nowrap;vertical-align:middle">' + name + '</td>' +
          '<td style="vertical-align:middle">' + mCell + '</td>' +
          '<td style="vertical-align:middle">' + eCell + '</td>' +
          taskCols +
        '</tr>';
      }).join("");

      var mCount = Object.values(byMember).filter(function(d) { return d.morning; }).length;
      var eCount = Object.values(byMember).filter(function(d) { return d.evening; }).length;

      detail.innerHTML =
        '<div class="members-section" style="overflow-x:auto">' +
          '<div class="section-header">' +
            '<span class="section-title">Chi tiet ngay ' + dateStr + '</span>' +
            '<span class="section-meta">' + mCount + ' morning · ' + eCount + ' evening</span>' +
          '</div>' +
          '<table class="members-table" style="min-width:100%;table-layout:auto"><thead><tr>' +
            '<th>Thanh vien</th><th>Morning</th><th>Evening</th>' +
            '<th>Task 1</th><th>Plan</th><th>Actual</th><th>Time</th>' +
            '<th>Task 2</th><th>Plan</th><th>Actual</th><th>Time</th>' +
          '</tr></thead><tbody>' + memberRows + '</tbody></table>' +
        '</div>';
    };

    var chartHTML =
      '<div class="members-section" style="margin-bottom:0">' +
        '<div class="section-header">' +
          '<span class="section-title">Lich su submit</span>' +
          '<div style="display:flex;gap:12px;align-items:center">' +
            '<div style="display:flex;gap:10px;align-items:center;font-size:11px;color:var(--text-muted)">' +
              '<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--accent);display:inline-block"></span>Morning</span>' +
              '<span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:var(--yellow);display:inline-block"></span>Evening</span>' +
            '</div>' +
            '<select id="bd-chart-range" style="background:var(--bg-hover);border:1px solid var(--border-strong);color:var(--text-primary);font-size:12px;padding:4px 10px;border-radius:var(--radius-sm);cursor:pointer;outline:none">' +
              '<option value="7" selected>7 ngay</option>' +
              '<option value="14">2 tuan</option>' +
              '<option value="21">3 tuan</option>' +
              '<option value="30">1 thang</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div id="bd-chart-container" class="chart-wrap"></div>' +
        '<div id="bd-day-detail" style="display:none;margin-top:16px"></div>' +
      '</div>';

    /* ── Members table hom nay ── */
    var maxTasks = 0;
    data.memberNames.forEach(function(name) {
      var m = data.todayMorning[name];
      if (m && m.tasks) maxTasks = Math.max(maxTasks, m.tasks.length);
    });
    maxTasks = Math.max(maxTasks, 1);

    var thHeaders = '<th>Thanh vien</th><th>Morning</th><th>Evening</th>';
    for (var ti = 0; ti < maxTasks; ti++) {
      thHeaders += '<th>Task ' + (ti+1) + '</th><th>Plan</th><th>Actual</th><th>Time</th>';
    }

    var memberRows = data.memberNames.map(function(name) {
      var morning = data.todayMorning[name];
      var evening = data.todayEvening[name];

      var mCell = morning
        ? '<span class="status-pill submitted" style="font-size:10px;white-space:nowrap">☀️ Submit</span><br><span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">' + (morning.submittedAt || "") + '</span>'
        : '<span class="status-pill missing" style="font-size:10px;white-space:nowrap">✗ Chua</span>';
      var eCell = evening
        ? '<span class="status-pill submitted" style="font-size:10px;white-space:nowrap">🌙 Submit</span><br><span style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">' + (evening.submittedAt || "") + '</span>'
        : '<span class="status-pill missing" style="font-size:10px;white-space:nowrap">✗ Chua</span>';

      var taskCols = "";
      for (var ti = 0; ti < maxTasks; ti++) {
        var t      = morning && morning.tasks ? morning.tasks[ti] : null;
        var actual = evening && evening.tasks ? evening.tasks[ti] : null;
        var prog   = actual ? actual.progress  : null;
        var time   = actual ? actual.timeSpent : null;
        var pc     = prog === "100%" ? "done" : prog && parseInt(prog) >= 60 ? "high" : "medium";
        taskCols +=
          '<td style="font-size:12px;color:var(--text-primary)">'                                                                          + (t ? (t.title||"—") : "—")        + '</td>' +
          '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">'                                                     + (t ? (t.expectedTime||"—") : "—") + '</td>' +
          '<td>' + (prog ? '<span class="progress-badge ' + pc + '">' + prog + '</span>' : '<span style="color:var(--text-muted)">—</span>') + '</td>' +
          '<td style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);white-space:nowrap">'                            + (time || "—")                     + '</td>';
      }

      return '<tr>' +
        '<td style="font-weight:500;white-space:nowrap;vertical-align:middle">' + name    + '</td>' +
        '<td style="vertical-align:middle">'                                    + mCell   + '</td>' +
        '<td style="vertical-align:middle">'                                    + eCell   + '</td>' +
        taskCols +
      '</tr>';
    }).join("");

    var membersHTML =
      '<div class="members-section" style="overflow-x:auto">' +
        '<div class="section-header"><span class="section-title">Trang thai hom nay</span><span class="section-meta">' + data.todayStr + '</span></div>' +
        '<table class="members-table" style="min-width:100%;table-layout:auto"><thead><tr>' +
          thHeaders +
        '</tr></thead><tbody>' + memberRows + '</tbody></table>' +
      '</div>';

    /* ── Tab info ── */
    var infoHTML =
      '<div class="tool-info-page">' +
        '<div class="tool-info-hero">' +
          '<div class="tool-info-icon"><i class="ti ti-sun-moon"></i></div>' +
          '<div>' +
            '<h2 class="tool-info-name">BD-MKT Daily Report</h2>' +
            '<p class="tool-info-tagline">Tracking morning/evening submit va plan vs actual cua team BD-MKT.</p>' +
          '</div>' +
        '</div>' +
        '<div class="tool-info-section">' +
          '<div class="tool-info-section-title"><i class="ti ti-info-circle"></i> Mo ta</div>' +
          '<p class="tool-info-text">Moi ngay team BD-MKT dien 2 form: Morning (plan task + output du kien) va Evening (actual progress). Dashboard tong hop ti le submit va so sanh plan vs actual.</p>' +
        '</div>' +
        '<div class="tool-info-grid">' +
          '<div class="tool-info-section">' +
            '<div class="tool-info-section-title"><i class="ti ti-settings"></i> Cau hinh</div>' +
            '<div class="tool-info-kv">' +
              '<div class="kv-row"><span class="kv-key">Timezone</span><span class="kv-val">Asia/Ho_Chi_Minh</span></div>' +
              '<div class="kv-row"><span class="kv-key">Tan suat</span><span class="kv-val">Hang ngay (Thu 2 – Thu 6)</span></div>' +
              '<div class="kv-row"><span class="kv-key">Platform</span><span class="kv-val">Lark / Feishu</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="tool-info-section">' +
            '<div class="tool-info-section-title"><i class="ti ti-database"></i> Data source</div>' +
            '<div class="tool-info-kv">' +
              '<div class="kv-row"><span class="kv-key">Source</span><span class="kv-val">Google Sheets</span></div>' +
              '<div class="kv-row"><span class="kv-key">Sheet</span><span class="kv-val kv-mono">BD-MKT-L&D-Daily Report</span></div>' +
              '<div class="kv-row"><span class="kv-key">API</span><span class="kv-val kv-mono">Apps Script doGet</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    window._bdTrackingHTML = statsHTML + chartHTML + membersHTML;
    window._bdInfoHTML     = infoHTML;

    window._initBDTabs = function() {
      var tracking = document.getElementById("tab-tracking");
      var info     = document.getElementById("tab-info");
      if (tracking) tracking.innerHTML = window._bdTrackingHTML;
      if (info)     info.innerHTML     = window._bdInfoHTML;

      setTimeout(function() {
        if (window._buildBDChart) {
          window._buildBDChart(7);
          var sel = document.getElementById("bd-chart-range");
          if (sel) sel.addEventListener("change", function() { window._buildBDChart(parseInt(this.value)); });
        }
      }, 50);

      document.querySelectorAll(".tab-btn").forEach(function(btn) {
        btn.addEventListener("click", function() {
          document.querySelectorAll(".tab-btn").forEach(function(b) { b.classList.remove("active"); });
          document.querySelectorAll(".tab-pane").forEach(function(p) { p.style.display = "none"; });
          btn.classList.add("active");
          var target = document.getElementById("tab-" + btn.dataset.tab);
          if (target) target.style.display = "block";
          if (btn.dataset.tab === "tracking") {
            setTimeout(function() {
              if (window._buildBDChart) {
                var sel = document.getElementById("bd-chart-range");
                window._buildBDChart(sel ? parseInt(sel.value) : 7);
              }
            }, 50);
          }
        });
      });
    };

    return tabBar;
  }
});
