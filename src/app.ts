import cors from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import MongoStore from "connect-mongo";
import type { NextFunction, Request, Response } from "express";
import { passport } from "./auth/passport.js";
import { env } from "./config/env.js";
import { connectToMongo, mongoStatus } from "./database/mongo.js";
import { adminUsersRouter } from "./routes/admin-users.js";
import { authRouter } from "./routes/auth.js";

export const app = express();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(async (_request, _response, next) => {
  try {
    await connectToMongo();
    next();
  } catch (error) {
    next(error);
  }
});
app.use(
  session({
    name: "sat.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "sat-api", mongo: mongoStatus() });
});

app.use("/auth", authRouter);
app.use("/admin/users", adminUsersRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "Not found" });
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof Error && error.name === "ZodError") {
    response.status(400).json({ error: "Invalid request", details: error.message });
    return;
  }

  console.error(error);
  response.status(500).json({ error: "Internal server error" });
});

export default app;
