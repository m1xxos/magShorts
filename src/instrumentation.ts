export async function register() {
  // SCHEDULER=off lets a second instance run against the same database — a
  // production build alongside the dev server, say — without both of them
  // refreshing every feed and building the same digest twice.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SCHEDULER !== "off") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}
