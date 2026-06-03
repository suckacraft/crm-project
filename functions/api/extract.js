// Cloudflare Pages Functions entry point (file path maps to the /api/extract
// route). Cloudflare calls onRequest(context) with a Web Request and expects a
// Web Response — exactly what proxy/api/extract.js's onRequest provides.
// Keys come from the Pages project's environment variables.
export { onRequest } from "../../proxy/api/extract.js";
