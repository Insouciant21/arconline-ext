import { auth } from "@/auth";
import { LoginForm } from "@/components/login-form";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");

  const params = await searchParams;
  return (
    <LoginForm
      callbackUrl={safeCallbackUrl(params.callbackUrl)}
      initialError={params.error === "CredentialsSignin" ? "访问口令无效，请重试。" : undefined}
    />
  );
}

function safeCallbackUrl(value?: string) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
