import { auth } from "@/auth";
import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardPayload } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return <DashboardShell initialData={await getDashboardPayload()} />;
}
