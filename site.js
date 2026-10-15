(() => {
  const statuses = document.querySelectorAll(".connection-status");

  function updateConnectionStatus() {
    const online = navigator.onLine;
    statuses.forEach((status) => {
      status.textContent = online
        ? "Online · your data still stays in this browser"
        : "Offline · saved browser data remains available";
      status.classList.toggle("offline", !online);
    });
  }

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  updateConnectionStatus();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      statuses.forEach((status) => {
        status.textContent = "Offline app support could not be enabled; reconnect to reload the app.";
      });
    });
  }
})();
