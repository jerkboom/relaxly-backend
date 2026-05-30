module.exports = {
  apps: [
    {
      name: 'booking-api',
      script: './server.js',
      instances: 'max', // Runs a cluster on every available CPU core!
      exec_mode: 'cluster', // Enables load balancing across the cores
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      // Automatically restart if memory usage gets too high (prevents leaks from taking down the server)
      max_memory_restart: '500M',
      // Delay between automatic restarts if the app is crash-looping
      restart_delay: 3000,
      // Pipe PM2 logs directly into the Winston logs directory we just made
      error_file: './logs/pm2-err.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      time: true
    },
  ],
};
