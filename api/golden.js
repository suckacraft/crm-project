// Vercel serverless route: /api/golden (the durable eval golden set).
import { vercel } from "../proxy/api/feedbackHttp.js";
export default vercel("golden");
