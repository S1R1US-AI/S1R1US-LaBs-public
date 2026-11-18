/* /btc-eth-sol/: refreshes the market data cards from free public market data (Coinbase and CoinGecko).
   Read-only GET requests, no keys, no cookies. If a request fails, the dated snapshot in the page stays, except on the
   two market-value cards, which have no snapshot and say live data is unavailable. */
(function () {
  "use strict";
  var CB = "https://api.exchange.coinbase.com/products/";
  var CG = "https://api.coingecko.com/api/v3/";

  function getJson(url) {
    return fetch(url, { headers: { accept: "application/json" }, credentials: "omit", cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
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
  /* Coinbase daily candles: [time, low, high, open, close, volume], newest first. Returns closes oldest to newest. */
  function closes(rows, days) {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(function (r) { return Array.isArray(r) && num(r[0]) && num(r[4]); })
      .sort(function (a, b) { return a[0] - b[0]; })
      .slice(-(days + 1))
      .map(function (r) { return Number(r[4]); });
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
        set("bes-eth-btc", fixed(last, 5) + " BTC");
        set("bes-btc-eth", "1 BTC = " + fixed(1 / last, 2) + " ETH");
        var s = closes(r[1], 30);
        if (s.length > 1) {
          s[s.length - 1] = last;
          setChange("bes-eth-btc-chg", ((last - s[0]) / s[0]) * 100, "in 30 days");
          spark("bes-eth-btc-spark", s);
        }
      }),
    ),
  );

  jobs.push(
    track(
      ["card-eth-sol"],
      Promise.all([getJson(CB + "SOL-ETH/stats"), getJson(CB + "SOL-ETH/candles?granularity=86400")]).then(function (r) {
        var solEth = num(r[0].last);
        if (!solEth) throw new Error("soleth");
        var ethSol = 1 / solEth;
        set("bes-eth-sol", "1 ETH = " + fixed(ethSol, 2) + " SOL");
        set("bes-sol-eth", "1 SOL = " + fixed(solEth, 5) + " ETH");
        var s = closes(r[1], 30).map(function (v) { return 1 / v; });
        if (s.length > 1) {
          s[s.length - 1] = ethSol;
          setChange("bes-eth-sol-chg", ((ethSol - s[0]) / s[0]) * 100, "in 30 days");
          spark("bes-eth-sol-spark", s);
        }
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
      }).catch(function (err) {
        set("bes-cap-sol-eth", "Live data unavailable");
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
