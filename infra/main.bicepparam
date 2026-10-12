using './main.bicep'

// Values come from environment variables so no secrets are committed:
//   export JOBS_KEY="$(openssl rand -hex 24)"
param appName = 'topnotch'
param swaLocation = 'eastasia'
param shopTimeZone = 'Asia/Manila'
param jobsKey = readEnvironmentVariable('JOBS_KEY')
param staffNotifyEmail = readEnvironmentVariable('STAFF_NOTIFY_EMAIL', '')
