// Cloudflare Pages Functions route: /api/golden (the durable eval golden set).
import { cf } from "../../proxy/api/feedbackHttp.js";
export const onRequest = cf("golden");
