// Matches the deployed receiver in the existing root PM2 instance.
module.exports = {
  apps: [{
    name: 'simkit-attendance',
    cwd: '/opt/simkit-attendance',
    script: '/opt/simkit-attendance/receiver.mjs',
    interpreter: '/opt/simkit-attendance-node/bin/node',
    node_args: ['--env-file=/etc/simkit-attendance.env'],
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    restart_delay: 5000,
    kill_timeout: 30000,
    max_memory_restart: '256M',
    out_file: '/var/lib/simkit-attendance/pm2/attendance-out.log',
    error_file: '/var/lib/simkit-attendance/pm2/attendance-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
  }],
};
