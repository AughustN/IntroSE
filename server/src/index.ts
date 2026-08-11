import { createServer } from "node:http";
import { createApp } from "./app.js";
import { AI_REQUEST_TIMEOUT_MS, config } from "./config.js";
import { startHoldSweep } from "./modules/holds/sweep.js";
import { startTopupReconciliation } from "./modules/payments/reconcile.js";
import { attachIo } from "./realtime/io.js";
import { startNotificationWorker } from "./modules/notifications/notifications.service.js";

/*
 * Last line of defence, not a licence to skip handlers.
 *
 * Node's default for an unhandled rejection is to raise it as an uncaught exception, which ends the
 * process. This API runs several fire-and-forget background loops — hold sweep, top-up
 * reconciliation, notification delivery — so a single unhandled rejection in any of them would take
 * the whole server down, potentially moments after a successful checkout.
 *
 * Each of those call sites attaches its own handler; this only catches what slips through, and logs
 * loudly rather than exiting. Deliberately not registered for `uncaughtException`: a genuinely
 * unexpected throw leaves the process in an unknown state, and continuing to serve requests from
 * there is worse than restarting.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled promise rejection:", reason);
});

// Express is wrapped in a bare http.Server so Socket.IO can share the same port and origin (R-5);
// tests keep driving `createApp()` directly through supertest.
const app = createApp();
const server = createServer(app);
attachIo(server);

server.listen(config.port, () => {
  console.log(`TixHub API listening on :${config.port} (${config.nodeEnv})`);
  // Holds are released on the database's clock, not the client's — this loop is what acts on it.
  startHoldSweep();
  console.log("seat-hold sweep started");
  // A lost IPN must not leave someone's money reading as pending forever (UC-40 A5).
  startTopupReconciliation();
  console.log("top-up reconciliation started");
  startNotificationWorker();
  console.warn("notification delivery worker started");

  /*
   * Say which AI is actually wired up.
   *
   * Which model answers is decided by `.env`, read once at module load, and until this line there
   * was no way to see the result short of reading the file — so "the assistant is slow" and "the
   * assistant is pointed at a model that is down" looked identical from the outside. They are not:
   * on the configured gateway one model timed out on every request while its neighbours answered in
   * three seconds. The host and model are printed; the key never is, only whether one exists.
   */
  const target = new URL(config.openaiChatUrl);
  console.warn(
    `AI: model=${config.openaiModel} host=${target.origin} key=${config.openaiApiKey ? "set" : "MISSING — AI will always fall back"} timeout=${AI_REQUEST_TIMEOUT_MS}ms`,
  );
});
