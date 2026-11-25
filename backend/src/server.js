import 'dotenv/config';
import { getEnv } from './config/env.js';
import { supabaseAdmin } from './config/supabase.js';
import { createApp } from './app.js';

async function startServer() {
  const env = getEnv();
  try {
    const { error } = await supabaseAdmin.from('users').select('id').limit(1);
    if (error) throw error;
  } catch (error) {
    console.error(`Supabase connection failed (${error.code || 'connection error'}). Verify SUPABASE_URL and the service role key.`);
    process.exitCode = 1;
    return;
  }

  const server = createApp({ env }).listen(env.PORT, () => {
    console.log(`Hospital MS API listening on port ${env.PORT}; Supabase is connected.`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received; closing HTTP server.`);
    server.close(async () => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

startServer().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
