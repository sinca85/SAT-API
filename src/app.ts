import cors from "cors";
import express from "express";
import session from "express-session";
import * as helmetModule from "helmet";
import { MongoStore } from "connect-mongo";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { passport } from "./auth/passport.js";
import { env } from "./config/env.js";
import { connectToMongo, mongoStatus } from "./database/mongo.js";
import { adminHighLevelRouter } from "./routes/admin-highlevel.js";
import { adminRolesRouter } from "./routes/admin-roles.js";
import { adminFaqsRouter } from "./routes/admin-faqs.js";
import { adminLeadsRouter } from "./routes/admin-leads.js";
import { adminUsersRouter } from "./routes/admin-users.js";
import { authRouter } from "./routes/auth.js";
import { leadsRouter } from "./routes/leads.js";
import { aiRouter, aiAdminRouter } from "./routes/ai.js";

export const app = express();

// Vercel's build environment can resolve Helmet through its CommonJS typings,
// while local NodeNext builds resolve its ESM default export. Normalize both.
const helmet = (helmetModule.default ?? helmetModule) as unknown as (options?: object) => RequestHandler;

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  if (env.NODE_ENV !== "production" && origin === env.CORS_ORIGIN) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "seguroatiempo.com" || hostname.endsWith(".seguroatiempo.com"));
  } catch {
    return false;
  }
}

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin(origin, callback) {
    callback(null, isAllowedOrigin(origin) ? origin ?? false : false);
  },
  credentials: true,
}));
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

const publicDirectory = path.join(process.cwd(), "public");
app.use(express.static(publicDirectory));

const panelRoutes = ["/usuarios", "/roles", "/leads", "/faqs", "/highlevel/contactos"];

app.get("/permisos", (_request, response) => response.redirect(302, "/roles"));

app.get("/", (_request, response) => {
  response.redirect(302, "/usuarios");
});

app.get(panelRoutes, (_request, response) => {
  response.set("Cache-Control", "no-store").sendFile(path.join(publicDirectory, "index.html"));
});

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "sat-api", mongo: mongoStatus() });
});

app.use("/auth", authRouter);
app.use("/leads", leadsRouter);
app.use("/api/ai", aiRouter);
app.use("/admin/ai", aiAdminRouter);
app.use("/admin/leads", adminLeadsRouter);
app.use("/admin/users", adminUsersRouter);
app.use("/admin/roles", adminRolesRouter);
app.use("/admin/faqs", adminFaqsRouter);
app.use("/admin/highlevel", adminHighLevelRouter);

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
