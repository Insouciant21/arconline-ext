export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startDailyScheduler } = await import("@/lib/scheduler");
    startDailyScheduler();
  }
}
