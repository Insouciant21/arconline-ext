import { auth } from "@/auth";
import { HistoryShell } from "@/components/history-shell";
import { getHistoryPayload } from "@/lib/history";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "历史 · Arcaea B50 Studio",
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <HistoryShell initialData={await getHistoryPayload()} />;
}
