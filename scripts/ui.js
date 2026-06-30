(function () {
  window.BRX = window.BRX || {};

  const refs = {
    app: document.querySelector("#app"),
    siteHeader: document.querySelector(".site-header"),
    brandLink: document.querySelector(".brand"),
    nav: document.querySelector(".nav"),
    headerActions: document.querySelector("#headerActions"),
    toast: document.querySelector("#toast"),
  };

  function showToast(message) {
    refs.toast.textContent = message;
    refs.toast.classList.add("show");
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => refs.toast.classList.remove("show"), 2200);
  }

  function showError(message) {
    const error = document.querySelector("#formError");
    if (error) error.textContent = message;
  }

  window.BRX.ui = { refs, showToast, showError };
})();
