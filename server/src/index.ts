import { createServer } from "node:http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { startHoldSweep } from "./modules/holds/sweep.js";
import { startTopupReconciliation } from "./modules/payments/reconcile.js";
import { attachIo } from "./realtime/io.js";

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
});
