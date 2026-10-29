import dotenv from "dotenv";
import { resolve } from "node:path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "apps/api/.env") });
dotenv.config({ path: resolve(process.cwd(), "../../.env") });

const [{ app }, { prisma }] = await Promise.all([
  import("./app.js"),
  import("./db.js"),
]);

const port = Number(process.env.PORT ?? 4001);
const server = app.listen(port, () => {
  console.log(`API SDN 268 berjalan pada port ${port}`);
});

async function shutdown() {
  server.close();
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
