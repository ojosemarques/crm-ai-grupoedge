/* Start only after explicit analytics consent. Sends to your own site's relay; never configure a CRM secret here. */
(function () {
  "use strict";
  var stopCurrent = null;
  window.PolitizaiAnalytics = {
    start: function (options) {
      if (!options || options.consent !== true || stopCurrent) return;
      var endpoint = new URL(options.endpoint, window.location.origin);
      if (endpoint.origin !== window.location.origin) throw new Error("Analytics requires a same-origin relay.");
      var session = crypto.randomUUID();
      var queue = [];
      var visibleAt = document.visibilityState === "visible" ? performance.now() : null;
      var stopped = false;
      var query = new URLSearchParams(window.location.search);
      var code = /^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,119}$/;
      var utmCampaign = query.get("utm_campaign");
      var utmContent = query.get("utm_content");
      function record(kind, details) {
        if (stopped || queue.length >= 50) return;
        var event = Object.assign({ eventId: crypto.randomUUID(), kind: kind, occurredAt: new Date().toISOString() }, details || {});
        if (utmCampaign && code.test(utmCampaign)) event.utmCampaign = utmCampaign;
        if (utmContent && code.test(utmContent)) event.utmContent = utmContent;
        queue.push(event);
      }
      function engagement() {
        if (visibleAt === null) return;
        var duration = Math.min(300000, Math.round(performance.now() - visibleAt));
        if (duration > 0) record("ENGAGEMENT", { durationMs: duration });
        visibleAt = document.visibilityState === "visible" ? performance.now() : null;
      }
      function flush() {
        if (stopped || !queue.length) return;
        var events = queue.splice(0, 50);
        var body = JSON.stringify({ consent: true, sessionPublicId: session, origin: window.location.origin, events: events });
        fetch(endpoint.href, { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true, credentials: "same-origin" }).then(function (response) {
          if (!response.ok) window.dispatchEvent(new CustomEvent("politizai:tracking-error", { detail: { status: response.status } }));
        }).catch(function () { window.dispatchEvent(new CustomEvent("politizai:tracking-error", { detail: { status: 0 } })); });
      }
      function click(event) {
        var target = event.target instanceof Element ? event.target.closest("[data-politizai-track]") : null;
        var name = target && target.getAttribute("data-politizai-track");
        if (name && code.test(name)) record("CLICK", { target: name });
      }
      function visibility() { engagement(); if (document.visibilityState === "visible") visibleAt = performance.now(); else flush(); }
      function pagehide() { engagement(); flush(); }
      document.addEventListener("click", click);
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("pagehide", pagehide);
      var timer = setInterval(function () { engagement(); flush(); }, 10000);
      record("PAGE_VIEW");
      flush();
      stopCurrent = function () {
        stopped = true; queue = []; clearInterval(timer);
        document.removeEventListener("click", click);
        document.removeEventListener("visibilitychange", visibility);
        window.removeEventListener("pagehide", pagehide);
      };
      return { sessionPublicId: session };
    },
    stop: function () { if (stopCurrent) stopCurrent(); stopCurrent = null; }
  };
}());
