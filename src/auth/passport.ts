import passport from "passport";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { bootstrapAdminEmails, env } from "../config/env.js";
import { User } from "../models/user.js";

export const googleAuthEnabled = Boolean(
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
);

function toSessionUser(user: InstanceType<typeof User>): Express.User {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? undefined,
    role: user.role,
    status: user.status,
  };
}

async function authenticateGoogleProfile(profile: Profile): Promise<Express.User> {
  const googleEmail = profile.emails?.find((entry) => entry.verified)?.value;
  if (!googleEmail) {
    throw new Error("Google did not provide a verified email address");
  }

  const email = googleEmail.toLowerCase();
  const isBootstrapAdmin = bootstrapAdminEmails.has(email);
  let user = await User.findOne({ $or: [{ googleId: profile.id }, { email }] });

  if (!user) {
    user = await User.create({
      googleId: profile.id,
      email,
      name: profile.displayName || email,
      avatarUrl: profile.photos?.[0]?.value,
      role: isBootstrapAdmin ? "admin" : "user",
      status: isBootstrapAdmin ? "active" : "pending",
      lastLoginAt: new Date(),
    });
  } else {
    user.googleId = profile.id;
    user.name = profile.displayName || user.name;
    user.avatarUrl = profile.photos?.[0]?.value || user.avatarUrl;
    user.lastLoginAt = new Date();

    if (isBootstrapAdmin) {
      user.role = "admin";
      user.status = "active";
    }

    await user.save();
  }

  return toSessionUser(user);
}

if (googleAuthEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID!,
        clientSecret: env.GOOGLE_CLIENT_SECRET!,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          done(null, await authenticateGoogleProfile(profile));
        } catch (error) {
          done(error as Error);
        }
      },
    ),
  );
}

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await User.findById(id);
    done(null, user ? toSessionUser(user) : false);
  } catch (error) {
    done(error as Error);
  }
});

export { passport };
