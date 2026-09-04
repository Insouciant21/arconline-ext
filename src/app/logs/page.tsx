import { auth } from "@/auth";
import { LogsShell } from "@/components/logs-shell";
import { getLogsPayload } from "@/lib/logs";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "日志 · Arcaea B50 Studio",
};

export default async function LogsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <LogsShell initialData={await getLogsPayload()} />;
}
