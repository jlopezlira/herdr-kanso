// The copy button needs JavaScript; reading does not.
(function () {
  var status = document.querySelector("[data-copy-status]");
  function announce(text) { if (status) { status.textContent = ""; status.textContent = text; } }
  document.querySelectorAll("[data-copy]").forEach(function (button) {
    var box = button.closest("[data-copy-box]");
    var code = box.querySelector("[data-copy-text]");
    var label = button.querySelector("[data-copy-label]");
    var timer;
    function reset(after) { clearTimeout(timer); timer = setTimeout(function () { label.textContent = "Copy"; button.classList.remove("is-done"); }, after); }
    function done() { label.textContent = "Copied"; button.classList.add("is-done"); announce("Copied the agent block."); reset(1800); }
    function failed() {
      var range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      label.textContent = "Press Cmd+C";
      announce("Could not copy. The agent block is selected; press Cmd+C to copy it.");
      reset(2400);
    }
    button.hidden = false;
    button.addEventListener("click", function () {
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code.textContent.trim()).then(done, failed);
      else failed();
    });
  });
})();
