using './main.bicep'

// Values come from environment variables so no secrets are committed:
//   export ADMIN_EMAILS="you@example.com"
//   export JOBS_KEY="$(openssl rand -hex 24)"
//   export ENTRA_CLIENT_ID="..."  ENTRA_CLIENT_SECRET="..."   (optional on the first run)
param appName = 'topnotch'
param swaLocation = 'centralus'
param shopTimeZone = 'Asia/Manila'
param adminEmails = readEnvironmentVariable('ADMIN_EMAILS')
param jobsKey = readEnvironmentVariable('JOBS_KEY')
param entraClientId = readEnvironmentVariable('ENTRA_CLIENT_ID', '')
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
param staffNotifyEmail = readEnvironmentVariable('STAFF_NOTIFY_EMAIL', '')
