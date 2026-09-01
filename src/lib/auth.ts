import { auth } from "@/auth";
import { AppError } from "./errors";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    throw new AppError("需要登录后才能访问。", 401, "AUTH_REQUIRED");
  }
  return session;
}
