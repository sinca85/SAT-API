import { app } from "./app.js";
import { env } from "./config/env.js";
import { connectToMongo } from "./database/mongo.js";

async function start(): Promise<void> {
  await connectToMongo();

  app.listen(env.PORT, () => {
    console.log(`SAT API listening on http://localhost:${env.PORT}`);
  });
}

if (!process.env.VERCEL) {
  start().catch((error) => {
    console.error("Failed to start SAT API", error);
    process.exit(1);
  });
}

export default app;
