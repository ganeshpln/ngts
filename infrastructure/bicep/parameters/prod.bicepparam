// Parameters for the prod environment.
// REQUIREMENT GAP GAP-013 / Q-14: the placeholder values below must be supplied by IT before
// deployment. They are intentionally left as placeholders rather than guessed.

using '../main.bicep'

param environmentName = 'prod'
param location = '<AZURE_REGION>'
param spaMailboxUpn = '<SPA_SHARED_MAILBOX_UPN>'
param dataverseUrl = '<https://org.crm.dynamics.com>'
param apiClientId = '<ENTRA_APP_CLIENT_ID>'
param openAiModelVersion = '<MODEL_VERSION>'
param openAiCapacity = 30
param enablePrivateEndpoints = true
param privateEndpointSubnetId = '<SUBNET_RESOURCE_ID>'
param logRetentionDays = 365
