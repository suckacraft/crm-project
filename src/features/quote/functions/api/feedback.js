// Cloudflare Pages Functions route: /api/feedback (the durable corpus).
import { cf } from "../../proxy/api/feedbackHttp.js";
export const onRequest = cf("feedback");
