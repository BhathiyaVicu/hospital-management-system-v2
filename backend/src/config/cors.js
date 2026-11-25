import { getEnv } from './env.js';

export function corsOptions(env = getEnv()) {
  const { FRONTEND_URL } = env;
  return {
    origin(origin, callback) {
      if (!origin || origin === FRONTEND_URL) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
    methods: ['GET', 'POST', 'PATCH',  'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}
