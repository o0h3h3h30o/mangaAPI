module.exports = {
  apps: [{
    name: 'manga-api',
    script: 'server.js',
    instances: 4,
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
