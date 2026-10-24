/* applies the saved theme before the page is painted (no flash) */
(function () {
  var apply = function (t) { if (t) document.documentElement.setAttribute('data-theme', t); };
  try { apply(localStorage.getItem('theme')); } catch (e) {}
  window.setTheme = function (t, centre, suffix) {
    apply(t); try { localStorage.setItem('theme', t); } catch (e) {}
    if (centre) document.title = centre + (suffix ? ' \u2014 ' + suffix : '');
  };
})();
