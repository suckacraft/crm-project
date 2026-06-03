// Vercel serverless route: /api/feedback (the durable corpus).
import { vercel } from "../proxy/api/feedbackHttp.js";
export default vercel("feedback");
