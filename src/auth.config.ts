// Edge-safe piece of the NextAuth config: providers/callbacks with no
// Node.js-only dependencies (no database adapter, no Nodemailer). This is
// what src/middleware.ts uses, since Edge Middleware can't load Node APIs
// like the 'stream'/'net'/'tls' modules that nodemailer and some adapter
// internals need. The full config (src/auth.ts) spreads this and adds the
// Node-only pieces on top, for use everywhere except middleware.
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

export default {
  providers: [Google],
  // Explicit JWT sessions: middleware builds its own NextAuth instance
  // from this config WITHOUT the Drizzle adapter, so it can't look up
  // database sessions. If strategy is left unset, next-auth infers
  // "database" here (auth.ts has the adapter) but "jwt" in middleware,
  // and middleware can never recognize a signed-in session. Pinning both
  // to "jwt" keeps them consistent; the adapter still handles user/account
  // records, it just doesn't own the session.
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      return Boolean(user.email);
    },
  },
} satisfies NextAuthConfig;
