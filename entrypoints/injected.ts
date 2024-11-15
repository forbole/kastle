import { KastleBrowserAPI } from "@/api/browser";

export default defineUnlistedScript(() => {
  // Add the kastle object to window
  Object.assign(window, { kastle: new KastleBrowserAPI() });
});
