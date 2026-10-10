// Edge-safe piece of the NextAuth config: providers/callbacks with no
// Node.js-only dependencies (no database adapter, no Nodemailer). This is
// what src/proxy.ts uses -- written back when it was Edge Middleware, which
// couldn't load Node APIs like the 'stream'/'net'/'tls' modules that
// nodemailer and some adapter internals need. (Next 16's proxy runs on Node,
// but the split is kept.) The full config (src/auth.ts) spreads this and
// adds the Node-only pieces on top, for use everywhere except the proxy.
import Google from "next-auth/providers/google";
import type { NextAuthConfig } from "next-auth";

export default {
  providers: [Google],
  // Explicit JWT sessions: the proxy builds its own NextAuth instance
  // from this config WITHOUT the Drizzle adapter, so it can't look up
  // database sessions. If strategy is left unset, next-auth infers
  // "database" here (auth.ts has the adapter) but "jwt" in the proxy,
  // and the proxy can never recognize a signed-in session. Pinning both
  // to "jwt" keeps them consistent; the adapter still handles user/account
  // records, it just doesn't own the session.
  session: { strategy: "jwt" },
  callbacks: {
    async signIn({ user }) {
      return Boolean(user.email);
    },
  },
} satisfies NextAuthConfig;
