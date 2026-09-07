// PEP Passport SPA Box Automation - Azure infrastructure (BRD Phase 8, NFR-020, NFR-021).
//
// No environment-specific value is embedded here. Everything comes from the per-environment
// parameter files in infrastructure/bicep/parameters/.
//
// Identity model: the Function App uses a SYSTEM-ASSIGNED managed identity for Azure OpenAI, Key
// Vault and Application Insights. No key is issued and no secret is deployed (NFR-009, NFR-010).

targetScope = 'resourceGroup'

@description('Environment name. Drives resource naming and configuration.')
@allowed(['dev', 'test', 'prod'])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Short workload name used in resource names.')
param workloadName string = 'spa'

@description('UPN of the SPA shared mailbox. REQUIREMENT GAP GAP-013 - supplied per environment.')
param spaMailboxUpn string

@description('Azure OpenAI model deployment name.')
param openAiDeploymentName string = 'gpt-4o'

@description('Azure OpenAI model name.')
param openAiModelName string = 'gpt-4o'

@description('Azure OpenAI model version.')
param openAiModelVersion string

@description('Azure OpenAI API version used by the Decision Service.')
param openAiApiVersion string = '2024-10-21'

@description('Tokens-per-minute capacity, in thousands. Size from expected volume (GAP-002, Q-15).')
@minValue(1)
param openAiCapacity int = 10

@description('Dataverse organisation URL for the Power Platform environment.')
param dataverseUrl string

@description('Module path exporting createProcessingStore(). The service refuses to run without it.')
param processingStoreModule string = './dataverseProcessingStore.js'

@description('Deploy private endpoints for Azure OpenAI and Key Vault. Recommended for production.')
param enablePrivateEndpoints bool = false

@description('Resource id of the subnet for private endpoints. Required when enablePrivateEndpoints is true.')
param privateEndpointSubnetId string = ''

@description('Entra ID tenant id, used for Easy Auth on the Function App.')
param tenantId string = subscription().tenantId

@description('Application (client) id of the Entra app registration protecting the Function App.')
param apiClientId string

@description('Log Analytics retention in days.')
@minValue(30)
param logRetentionDays int = 90

@description('Tags applied to every resource.')
param tags object = {
  workload: 'spa-mailbox-automation'
  workItem: 'WIT-504'
  environment: environmentName
}

var suffix = '${workloadName}-${environmentName}'
var storageName = toLower(replace('st${workloadName}${environmentName}${uniqueString(resourceGroup().id)}', '-', ''))

// ---------------------------------------------------------------------------
// Observability (NFR-005, NFR-006)
// ---------------------------------------------------------------------------

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: logRetentionDays
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    // Telemetry is redacted in the application before it is emitted (NFR-007); this only controls
    // whether the platform additionally collects client IP.
    DisableIpMasking: false
  }
}

// ---------------------------------------------------------------------------
// Key Vault - only for values that cannot use Managed Identity (NFR-010)
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: 'kv-${take(replace(suffix, '-', ''), 21)}'
  location: location
  tags: tags
  properties: {
    tenantId: tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: enablePrivateEndpoints ? 'Deny' : 'Allow'
      bypass: 'AzureServices'
    }
  }
}

// ---------------------------------------------------------------------------
// Azure OpenAI (INT-05)
// ---------------------------------------------------------------------------

resource openAi 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'oai-${suffix}'
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: 'oai-${suffix}'
    publicNetworkAccess: enablePrivateEndpoints ? 'Disabled' : 'Enabled'
    // Managed Identity only - no account key is ever used by the Decision Service.
    disableLocalAuth: true
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAi
  name: openAiDeploymentName
  sku: {
    name: 'Standard'
    capacity: openAiCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: openAiModelName
      version: openAiModelVersion
    }
    // Deterministic classification depends on a stable model version, so upgrades are explicit.
    versionUpgradeOption: 'NoAutoUpgrade'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// ---------------------------------------------------------------------------
// Function App (the Decision Service)
// ---------------------------------------------------------------------------

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
  }
}

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: 'plan-${suffix}'
  location: location
  tags: tags
  sku: {
    name: environmentName == 'prod' ? 'EP1' : 'Y1'
    tier: environmentName == 'prod' ? 'ElasticPremium' : 'Dynamic'
  }
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: 'func-${suffix}-decision'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      alwaysOn: environmentName == 'prod'
      appSettings: [
        { name: 'FUNCTIONS_EXTENSION_VERSION', value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME', value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION', value: '~22' }
        { name: 'AzureWebJobsStorage', value: 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        // Endpoints and identifiers only. No credential: Azure OpenAI and Dataverse both
        // authenticate with the Function App's managed identity (NFR-009, Rule 4).
        { name: 'AZURE_OPENAI_ENDPOINT', value: openAi.properties.endpoint }
        { name: 'AZURE_OPENAI_DEPLOYMENT', value: openAiDeploymentName }
        { name: 'AZURE_OPENAI_API_VERSION', value: openAiApiVersion }
        { name: 'DATAVERSE_URL', value: dataverseUrl }
        { name: 'SPA_MAILBOX_UPN', value: spaMailboxUpn }
        { name: 'PROCESSING_STORE_MODULE', value: processingStoreModule }
        { name: 'ENVIRONMENT_NAME', value: environmentName }
      ]
    }
  }
}

// Entra ID authentication. Without this the HTTP endpoints would be reachable anonymously, which
// no amount of application-level control would compensate for (NFR-008).
resource functionAuth 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
      redirectToProvider: 'azureactivedirectory'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
          clientId: apiClientId
        }
        validation: {
          defaultAuthorizationPolicy: {
            allowedApplications: [ apiClientId ]
          }
        }
      }
    }
    login: { tokenStore: { enabled: false } }
  }
}

// ---------------------------------------------------------------------------
// Role assignments - least privilege (NFR-011)
// ---------------------------------------------------------------------------

var cognitiveServicesOpenAiUser = 'a97b65f3-24c7-4388-baec-2e87135dc908'
var keyVaultSecretsUser = '4633458b-17de-408a-b874-0445c86b69e6'
var monitoringMetricsPublisher = '3913510d-42f4-4e42-8a64-420c390055eb'

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: openAi
  name: guid(openAi.id, functionApp.id, cognitiveServicesOpenAiUser)
  properties: {
    // "User" not "Contributor": the service infers, it does not manage deployments.
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesOpenAiUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVaultRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: keyVault
  name: guid(keyVault.id, functionApp.id, keyVaultSecretsUser)
  properties: {
    // Read-only on secrets.
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource metricsRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: appInsights
  name: guid(appInsights.id, functionApp.id, monitoringMetricsPublisher)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', monitoringMetricsPublisher)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Private endpoints (recommended for production)
// ---------------------------------------------------------------------------

resource openAiPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (enablePrivateEndpoints) {
  name: 'pe-oai-${suffix}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'oai'
        properties: {
          privateLinkServiceId: openAi.id
          groupIds: [ 'account' ]
        }
      }
    ]
  }
}

resource keyVaultPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (enablePrivateEndpoints) {
  name: 'pe-kv-${suffix}'
  location: location
  tags: tags
  properties: {
    subnet: { id: privateEndpointSubnetId }
    privateLinkServiceConnections: [
      {
        name: 'kv'
        properties: {
          privateLinkServiceId: keyVault.id
          groupIds: [ 'vault' ]
        }
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alerts (NFR-003)
// ---------------------------------------------------------------------------

resource actionGroup 'Microsoft.Insights/actionGroups@2023-01-01' = {
  name: 'ag-${suffix}'
  location: 'global'
  tags: tags
  properties: {
    groupShortName: take('spa${environmentName}', 12)
    enabled: true
    // Receivers are added per environment by the operations team - no address is guessed here.
    emailReceivers: []
  }
}

resource failureAlert 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: 'alert-${suffix}-processing-failures'
  location: location
  tags: tags
  properties: {
    displayName: 'SPA mailbox automation - processing failures'
    severity: 2
    enabled: true
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    scopes: [ appInsights.id ]
    criteria: {
      allOf: [
        {
          query: 'traces | where message has "Processing failed" or severityLevel >= 3'
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
        }
      ]
    }
    actions: { actionGroups: [ actionGroup.id ] }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

output functionAppName string = functionApp.name
output functionAppHostName string = functionApp.properties.defaultHostName
output functionAppPrincipalId string = functionApp.identity.principalId
output openAiEndpoint string = openAi.properties.endpoint
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output keyVaultName string = keyVault.name
