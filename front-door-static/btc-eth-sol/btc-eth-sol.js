/* /btc-eth-sol/: refreshes the market data cards from free public market data (Coinbase and CoinGecko).
   Read-only GET requests, no keys, no cookies. If a request fails, the dated snapshot in the page stays, except on the
   two market-value cards, which have no snapshot and say live data is unavailable. */
(function () {
  "use strict";
  var CB = "https://api.exchange.coinbase.com/products/";
  var CG = "https://api.coingecko.com/api/v3/";
  var REQUEST_MS = 10000;

  function getJson(url) {
    var ac = new AbortController();
    var timer = setTimeout(function () { ac.abort(); }, REQUEST_MS);
    var req = fetch(url, {
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: ac.signal,
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
    var deadline = new Promise(function (_, reject) {
      ac.signal.addEventListener("abort", function () { reject(new Error("timeout")); });
    });
    return Promise.race([req, deadline]).finally(function () {
      clearTimeout(timer);
    });
  }
  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function set(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setChange(id, pct, suffix) {
    var el = document.getElementById(id);
    if (!el || pct == null || !Number.isFinite(pct)) return;
    el.textContent = (pct >= 0 ? "▲ +" : "▼ ") + pct.toFixed(2) + "% " + suffix;
    el.classList.remove("bes-up", "bes-down");
    el.classList.add(pct >= 0 ? "bes-up" : "bes-down");
  }
  function usd(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fixed(n, d) {
    return n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  /* Coinbase daily candles: [time, low, high, open, close, volume], time in unix seconds.
     Returns closes oldest to newest for a change of `days`: last close vs the close `days`
     earlier. One-day slack covers a missing boundary candle only; it never widens a complete history. */
  function closes(rows, days) {
    if (!Array.isArray(rows) || days < 1) return [];
    var pts = rows
      .filter(function (r) { return Array.isArray(r) && num(r[0]) && num(r[4]); })
      .map(function (r) { return { t: Number(r[0]), c: Number(r[4]) }; })
      .sort(function (a, b) { return a.t - b.t; });
    if (pts.length < 2) return [];
    var newest = pts[pts.length - 1];
    var need = days * 86400;
    var slack = 86400;
    var target = newest.t - need;
    var start = null;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var p = pts[i];
      var off = p.t - target;
      if (off < -slack || off > slack) continue;
      if (!start) {
        start = p;
        continue;
      }
      var startOff = start.t - target;
      var closer = Math.abs(off) < Math.abs(startOff);
      var sameAndLater = Math.abs(off) === Math.abs(startOff) && p.t > start.t;
      if (closer || sameAndLater) start = p;
    }
    if (!start) return [];
    var span = newest.t - start.t;
    if (span < need - slack || span > need + slack) return [];
    var out = [];
    for (i = 0; i < pts.length; i++) {
      if (pts[i].t >= start.t && pts[i].t <= newest.t) out.push(pts[i].c);
    }
    return out.length >= 2 ? out : [];
  }
  function spark(id, series) {
    var svg = document.getElementById(id);
    if (!svg || series.length < 2) return;
    var min = Math.min.apply(null, series);
    var max = Math.max.apply(null, series);
    var span = max - min || 1;
    var pts = series.map(function (v, i) {
      var x = (i / (series.length - 1)) * 100;
      var y = 38 - ((v - min) / span) * 36;
      return x.toFixed(2) + "," + y.toFixed(2);
    });
    var line = svg.querySelector("polyline");
    if (line) line.setAttribute("points", pts.join(" "));
    svg.removeAttribute("hidden");
  }
  function stamp() {
    var t = new Date().toLocaleString("en-US", {
      timeZone: "America/New_York",
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    set("bes-status-time", t + " ET");
    set("bes-status-kind", "Live data");
  }

  /* A card whose request fails says so: most keep their dated snapshot value, and cards with no snapshot say
     live data is unavailable. */
  function track(ids, job, note) {
    return job.catch(function (err) {
      ids.forEach(function (id) {
        var src = document.querySelector("#" + id + " .src");
        if (src) src.textContent += note || " · dated snapshot, about 8:09 AM ET, November 18, 2026";
      });
      throw err;
    });
  }

  /* Flippening tracker: ETH market value as a share of bitcoin's (100% would be a flippening). */
  function flip(eth, btc) {
    var pct = (eth / btc) * 100;
    var meter = document.getElementById("bes-flip-meter");
    if (meter) {
      meter.value = Math.min(pct, 100);
      meter.hidden = false;
    }
    set("bes-flip-share", "ETH is " + fixed(pct, 1) + "% of the way to a flippening.");
    if (eth < btc) set("bes-flip-gap", "Ethereum would need about " + fixed(btc / eth, 1) + "× its market value to pass bitcoin.");
    else set("bes-flip-gap", "Ethereum's market value is above bitcoin's right now.");
  }

  var jobs = [];

  jobs.push(
    track(
      ["card-eth-usd"],
      getJson(CB + "ETH-USD/stats").then(function (j) {
        var last = num(j.last);
        var open = num(j.open);
        if (!last) throw new Error("eth");
        set("bes-eth-usd", usd(last));
        if (open) setChange("bes-eth-usd-chg", ((last - open) / open) * 100, "in 24 hours");
      }),
    ),
  );

  jobs.push(
    track(
      ["card-eth-btc"],
      Promise.all([getJson(CB + "ETH-BTC/stats"), getJson(CB + "ETH-BTC/candles?granularity=86400")]).then(function (r) {
        var last = num(r[0].last);
        if (!last) throw new Error("ethbtc");
        var s = closes(r[1], 30);
        if (s.length < 2) throw new Error("ethbtc-history");
        set("bes-eth-btc", fixed(last, 5) + " BTC");
        set("bes-btc-eth", "1 BTC = " + fixed(1 / last, 2) + " ETH");
        s[s.length - 1] = last;
        setChange("bes-eth-btc-chg", ((last - s[0]) / s[0]) * 100, "in 30 days");
        spark("bes-eth-btc-spark", s);
      }),
    ),
  );

  jobs.push(
    track(
      ["card-eth-sol"],
      Promise.all([getJson(CB + "SOL-ETH/stats"), getJson(CB + "SOL-ETH/candles?granularity=86400")]).then(function (r) {
        var solEth = num(r[0].last);
        if (!solEth) throw new Error("soleth");
        var s = closes(r[1], 30);
        if (s.length < 2) throw new Error("soleth-history");
        var ethSol = 1 / solEth;
        set("bes-eth-sol", "1 ETH = " + fixed(ethSol, 2) + " SOL");
        set("bes-sol-eth", "1 SOL = " + fixed(solEth, 5) + " ETH");
        var series = s.map(function (v) { return 1 / v; });
        series[series.length - 1] = ethSol;
        setChange("bes-eth-sol-chg", ((ethSol - series[0]) / series[0]) * 100, "in 30 days");
        spark("bes-eth-sol-spark", series);
      }),
    ),
  );

  jobs.push(
    track(
      ["card-cap-eth-sol", "card-cap-eth-btc"],
      getJson(CG + "simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_market_cap=true").then(function (j) {
        var btc = num(j.bitcoin && j.bitcoin.usd_market_cap);
        var eth = num(j.ethereum && j.ethereum.usd_market_cap);
        var sol = num(j.solana && j.solana.usd_market_cap);
        if (!btc || !eth || !sol) throw new Error("caps");
        set("bes-cap-eth-sol", fixed(eth / sol, 2) + "×");
        set("bes-cap-sol-eth", "Solana is about " + fixed((sol / eth) * 100, 1) + "% of Ethereum");
        set("bes-cap-eth-btc", fixed((eth / btc) * 100, 1) + "%");
        flip(eth, btc);
      }).catch(function (err) {
        set("bes-cap-sol-eth", "Live data unavailable");
        set("bes-flip-share", "Live data unavailable");
        throw err;
      }),
      " · live data unavailable",
    ),
  );

  jobs.push(
    track(
      ["card-dominance"],
      getJson(CG + "global").then(function (j) {
        var p = j && j.data && j.data.market_cap_percentage;
        var btc = p && num(p.btc);
        if (!btc) throw new Error("global");
        set("bes-dom-btc", fixed(btc, 1) + "%");
        var eth = num(p.eth);
        var sol = num(p.sol);
        if (eth && sol) set("bes-dom-alts", "ETH " + fixed(eth, 1) + "% · SOL " + fixed(sol, 1) + "%");
      }),
    ),
  );

  Promise.allSettled(jobs).then(function (results) {
    var ok = results.filter(function (r) { return r.status === "fulfilled"; }).length;
    if (ok === results.length) stamp();
    else if (ok > 0) {
      stamp();
      set("bes-status-kind", "Partly live data (some cards show the dated snapshot or say live data is unavailable)");
    }
  });
})();
