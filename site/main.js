// Copy the install line, show the star count, switch the screenshot's theme.

(function () {
  // Copy buttons.
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    var box = button.closest("[data-copy-box]");
    var text = box.querySelector("[data-copy-text]").textContent.trim();
    var label = button.querySelector("[data-copy-label]");
    var timer;
    button.addEventListener("click", function () {
      var done = function () {
        label.textContent = "Copied";
        button.classList.add("is-done");
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = "Copy"; button.classList.remove("is-done"); }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () { select(box); });
      } else {
        select(box);
      }
    });
  });
  function select(box) {
    var range = document.createRange();
    range.selectNodeContents(box.querySelector("[data-copy-text]"));
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Star count, cached for an hour; the buttons work without it.
  var slots = document.querySelectorAll("[data-stars]");
  var show = function (n) {
    if (typeof n !== "number" || n < 1) return;
    var text = n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n);
    slots.forEach(function (s) { s.textContent = text; s.hidden = false; });
  };
  var key = "kanso-stars";
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) {}
  if (cached && Date.now() - cached.at < 3600e3) {
    show(cached.n);
  } else {
    fetch("https://api.github.com/repos/jlopezlira/herdr-kanso", { headers: { Accept: "application/vnd.github+json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (repo) {
        if (!repo) return;
        show(repo.stargazers_count);
        try { localStorage.setItem(key, JSON.stringify({ n: repo.stargazers_count, at: Date.now() })); } catch (e) {}
      })
      .catch(function () {});
  }

})();
