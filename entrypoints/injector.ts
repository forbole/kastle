export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    if (document.documentElement) {
      injectScript("/injected.js");
    } else {
      const observer = new MutationObserver((mutations, obs) => {
        if (document.documentElement) {
          obs.disconnect();
          injectScript("/injected.js");
        }
      });

      observer.observe(document, { childList: true });
    }
  },
  runAt: "document_start",
});
