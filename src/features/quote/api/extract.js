// Vercel / Netlify-node serverless entry point.
// Vercel auto-detects files in /api as functions. This re-exports the same
// handler the local proxy uses, so the front-end's default proxyUrl
// "/api/extract" works same-origin (no CORS) once deployed.
export { default } from "../proxy/api/extract.js";
