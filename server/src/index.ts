import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
app.listen(config.port, () => {
  console.log(`TixHub API listening on :${config.port} (${config.nodeEnv})`);
});
