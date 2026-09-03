import { Router } from "express";
import { env } from "../config/env.js";
import { googleAuthEnabled, passport } from "../auth/passport.js";

export const authRouter = Router();

authRouter.get("/google", (request, response, next) => {
  if (!googleAuthEnabled) {
    response.status(503).json({ error: "Google authentication is not configured" });
    return;
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })(request, response, next);
});

authRouter.get("/google/callback", (request, response, next) => {
  if (!googleAuthEnabled) {
    response.redirect(env.AUTH_FAILURE_REDIRECT);
    return;
  }

  passport.authenticate("google", {
    failureRedirect: env.AUTH_FAILURE_REDIRECT,
  })(request, response, () => response.redirect(env.AUTH_SUCCESS_REDIRECT));
});

authRouter.get("/me", (request, response) => {
  response.json({ user: request.user ?? null });
});

authRouter.post("/logout", (request, response, next) => {
  request.logout((error) => {
    if (error) {
      next(error);
      return;
    }

    request.session.destroy((sessionError) => {
      if (sessionError) {
        next(sessionError);
        return;
      }

      response.clearCookie("sat.sid");
      response.status(204).end();
    });
  });
});
