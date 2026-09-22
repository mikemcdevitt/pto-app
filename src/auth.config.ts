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
  callbacks: {
    async signIn({ user }) {
      return Boolean(user.email);
    },
  },
} satisfies NextAuthConfig;
