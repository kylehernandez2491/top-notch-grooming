// Top Notch Dog Grooming infrastructure: Static Web App (Standard, managed Functions), Cosmos DB (serverless),
// Azure Communication Services Email (Azure-managed domain), Application Insights.
targetScope = 'resourceGroup'

@description('Short prefix for resource names (lowercase letters and numbers).')
@minLength(3)
@maxLength(12)
param appName string = 'topnotch'

@description('Region for Cosmos DB, Log Analytics and Application Insights.')
param location string = resourceGroup().location

@description('Static Web Apps is offered in a limited set of regions.')
@allowed([
  'westus2'
  'centralus'
  'eastus2'
  'westeurope'
  'eastasia'
])
param swaLocation string = 'centralus'

@description('Comma-separated emails that receive the admin (groomer/staff) role at sign-in.')
param adminEmails string

@description('Application (client) ID of the Entra External ID app registration. Can be set later.')
param entraClientId string = ''

@secure()
@description('Client secret of the Entra External ID app registration. Can be set later.')
param entraClientSecret string = ''

@secure()
@minLength(24)
@description('Shared secret the scheduled reminder workflow sends in the x-jobs-key header.')
param jobsKey string

@description('IANA time zone used when the shop settings are first seeded.')
param shopTimeZone string = 'Asia/Manila'

@description('Optional inbox that receives a copy of every online booking, move and cancellation.')
param staffNotifyEmail string = ''

@description('Data residency for Azure Communication Services.')
param communicationDataLocation string = 'United States'

param tags object = {
  app: appName
}

var suffix = substring(uniqueString(resourceGroup().id), 0, 8)
var databaseName = 'grooming'

// ---------- Observability ----------

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${appName}-logs-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${appName}-ai-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

// ---------- Cosmos DB (serverless: pay per request, ideal for a single shop) ----------

resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-11-15' = {
  name: '${appName}-cosmos-${suffix}'
  location: location
  tags: tags
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    capabilities: [
      { name: 'EnableServerless' }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
    minimalTlsVersion: 'Tls12'
    // SWA managed functions cannot use managed identity, so the API authenticates with a key.
    disableLocalAuth: false
    disableKeyBasedMetadataWriteAccess: false
  }
}

resource database 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-11-15' = {
  parent: cosmos
  name: databaseName
  properties: {
    resource: { id: databaseName }
  }
}

resource ownersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'owners'
  properties: {
    resource: {
      id: 'owners'
      partitionKey: { paths: [ '/ownerId' ], kind: 'Hash', version: 2 }
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [
          { path: '/photo/?' }
          { path: '/medicalNotes/?' }
          { path: '/behaviorNotes/?' }
          { path: '/"_etag"/?' }
        ]
      }
    }
  }
}

resource bookingsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'bookings'
  properties: {
    resource: {
      id: 'bookings'
      // One logical partition per day: an appointment and all of its slot locks commit in one transaction.
      partitionKey: { paths: [ '/day' ], kind: 'Hash', version: 2 }
      defaultTtl: -1
      indexingPolicy: {
        indexingMode: 'consistent'
        automatic: true
        includedPaths: [ { path: '/*' } ]
        excludedPaths: [
          { path: '/notes/?' }
          { path: '/staffNotes/?' }
          { path: '/history/*' }
          { path: '/reportCard/*' }
          { path: '/"_etag"/?' }
        ]
      }
    }
  }
}

resource catalogContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-11-15' = {
  parent: database
  name: 'catalog'
  properties: {
    resource: {
      id: 'catalog'
      partitionKey: { paths: [ '/kind' ], kind: 'Hash', version: 2 }
    }
  }
}

// ---------- Email (Azure Communication Services) ----------

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: '${appName}-email-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: communicationDataLocation
  }
}

// Azure-managed domain works immediately (DoNotReply@xxxx.azurecomm.net). Swap for a custom
// domain later for better deliverability and your own sender name.
resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communication 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: '${appName}-acs-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    dataLocation: communicationDataLocation
    linkedDomains: [ emailDomain.id ]
  }
}

// ---------- Static Web App ----------

resource site 'Microsoft.Web/staticSites@2023-12-01' = {
  name: '${appName}-${suffix}'
  location: swaLocation
  tags: tags
  // Standard is required for custom authentication (Entra External ID) and the rolesSource function.
  sku: {
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

resource siteSettings 'Microsoft.Web/staticSites/config@2023-12-01' = {
  parent: site
  name: 'appsettings'
  properties: {
    COSMOS_ENDPOINT: cosmos.properties.documentEndpoint
    COSMOS_KEY: cosmos.listKeys().primaryMasterKey
    COSMOS_DATABASE: databaseName
    ADMIN_EMAILS: adminEmails
    JOBS_KEY: jobsKey
    ACS_CONNECTION_STRING: communication.listKeys().primaryConnectionString
    EMAIL_SENDER: 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
    STAFF_NOTIFY_EMAIL: staffNotifyEmail
    SHOP_TIME_ZONE: shopTimeZone
    APP_BASE_URL: 'https://${site.properties.defaultHostname}'
    ENTRA_EXTERNAL_ID_CLIENT_ID: entraClientId
    ENTRA_EXTERNAL_ID_CLIENT_SECRET: entraClientSecret
    APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
    REMINDER_LEAD_HOURS: '24'
  }
  dependsOn: [
    ownersContainer
    bookingsContainer
    catalogContainer
  ]
}

output staticWebAppName string = site.name
output staticWebAppHostname string = site.properties.defaultHostname
output entraRedirectUri string = 'https://${site.properties.defaultHostname}/.auth/login/entraExternalId/callback'
output cosmosAccountName string = cosmos.name
output emailSender string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
output applicationInsightsName string = insights.name
