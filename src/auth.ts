import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

const authSecret =
  process.env.AUTH_SECRET?.trim() ||
  process.env.NEXTAUTH_SECRET?.trim() ||
  process.env.ADMIN_TOKEN?.trim() ||
  (process.env.NODE_ENV === "production" ? undefined : "development-only-auth-secret");

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: authSecret,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "访问口令",
      credentials: {
        token: {
          label: "访问口令",
          type: "password",
          placeholder: "输入管理口令",
        },
      },
      async authorize(credentials) {
        const expected = process.env.ADMIN_TOKEN?.trim();
        const supplied = typeof credentials?.token === "string" ? credentials.token.trim() : "";
        if (!expected || !supplied || !safeEqual(supplied, expected)) return null;
        return { id: "admin", name: "Arcaea B50 Admin" };
      },
    }),
  ],
});

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
