// The changelog page: CHANGELOG.md (copied next to this page when the site
// is published) read and drawn as releases, newest first.
(function () {
  var box = document.querySelector("[data-changelog]");
  if (!box) return;
  var esc = function (s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
  // `code`, **bold** and [links](url), on escaped text.
  var inline = function (s) {
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  };
  var render = function (text) {
    var out = [], list = null, item = null, started = false;
    var close = function () { if (item !== null) { list.push("<li>" + inline(item) + "</li>"); item = null; } if (list) { out.push("<ul>" + list.join("") + "</ul>"); list = null; } };
    text.split("\n").forEach(function (line) {
      var v = /^## \[([^\]]+)\](?: - (.+))?/.exec(line);
      if (v) { close(); if (started) out.push("</section>"); started = true; out.push('<section class="release" id="v' + esc(v[1]) + '"><h2>' + esc(v[1]) + (v[2] ? ' <span class="when">' + esc(v[2]) + "</span>" : "") + "</h2>"); return; }
      if (!started) return; // the intro: this page says it in its own words
      var h = /^### (.+)/.exec(line);
      if (h) { close(); out.push("<h3>" + esc(h[1]) + "</h3>"); return; }
      var b = /^- (.*)/.exec(line);
      if (b) { if (item !== null) list.push("<li>" + inline(item) + "</li>"); list = list || []; item = b[1]; return; }
      if (/^\s+\S/.test(line) && item !== null) { item += " " + line.trim(); return; }
      if (line.trim()) { close(); out.push("<p>" + inline(line) + "</p>"); }
    });
    close();
    if (started) out.push("</section>");
    return out.join("");
  };
  fetch("CHANGELOG.md", { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(); return r.text(); })
    .then(function (t) { box.innerHTML = render(t); if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView(); } })
    .catch(function () { box.innerHTML = '<p>Read it on <a href="https://github.com/jlopezlira/herdr-kanso/blob/main/CHANGELOG.md">GitHub</a>.</p>'; });
})();
