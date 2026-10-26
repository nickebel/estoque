(() => {
  const installButton = document.getElementById("install-app");
  let installPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.classList.remove("hidden");
  });
  installButton.addEventListener("click", async () => {
    if (!installPrompt) {
      alert("Para instalar, abra o menu do navegador e escolha \"Instalar app\" ou \"Adicionar à tela inicial\".");
      return;
    }
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    installButton.classList.add("hidden");
  });
  window.addEventListener("appinstalled", () => {
    installButton.classList.add("hidden");
    installPrompt = null;
  });
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Falha ao registrar modo offline:", error));
    });
  }
})();
