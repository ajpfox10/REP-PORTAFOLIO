import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// api/src -> api -> proyecto raíz scanner_v3
dotenv.config({
  path: path.resolve(__dirname, "../../.env"),
});