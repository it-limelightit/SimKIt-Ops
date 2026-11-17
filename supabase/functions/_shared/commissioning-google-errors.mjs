// Return actionable provider classifications, never raw Google response bodies or credentials.
export function explainGoogleDriveError(status, body, context = {}) {
  const error = body?.error ?? {};
  const details = Array.isArray(error.details) ? error.details : [];
  const reasons = [error.status, ...(error.errors ?? []).map(item => item.reason), ...details.map(item => item.reason)].filter(value => typeof value === 'string');
  const known = reasons.find(reason => ['SERVICE_DISABLED','accessNotConfigured','API_KEY_SERVICE_BLOCKED',
    'ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions','rateLimitExceeded','userRateLimitExceeded',
    'dailyLimitExceeded','quotaExceeded','insufficientFilePermissions','notFound'].includes(reason));
  const reason = known || (status === 404 ? 'notFound' : status === 429 ? 'rateLimitExceeded' : 'unknown');
  const identity = context.service_account_email ? ` Service account: ${context.service_account_email}.` : '';
  const folder = context.folder_id ? ` Folder ID: ${context.folder_id}.` : '';
  const project = context.project_id || details.map(item => item.metadata?.consumer?.match(/^projects\/([\w-]+)$/)?.[1]).find(Boolean);
  let category = 'provider_error';
  let message = 'Google Drive could not complete the read. Retry later.';
  if (['SERVICE_DISABLED','accessNotConfigured','API_KEY_SERVICE_BLOCKED'].includes(reason)) {
    category = 'api_disabled';
    message = `Google Drive API is disabled or blocked in the service account's Google Cloud project${project ? ` (${project})` : ''}. Enable Google Drive API in that project, then retry.`;
  } else if (['ACCESS_TOKEN_SCOPE_INSUFFICIENT','insufficientPermissions'].includes(reason)) {
    category = 'scope_missing';
    message = 'Google rejected the access-token scope. The verifier requires drive.readonly. Refresh the connection; changing folder sharing will not fix this scope error.';
  } else if (['rateLimitExceeded','userRateLimitExceeded','dailyLimitExceeded','quotaExceeded'].includes(reason) || status === 429) {
    category = 'quota'; message = 'Google Drive rate or quota limit reached. Wait before retrying; no folder permission change is needed.';
  } else if (status === 403 || status === 404) {
    category = 'folder_access';
    message = `Google cannot read the configured folder. Confirm the folder ID and share that exact parent folder with the credential's service account as Viewer.${identity}${folder}`;
  } else if (status === 401) {
    category = 'authentication'; message = 'Google rejected the access token. Check the configured service account credential and retry.';
  }
  return { message, category, google_reason: reason, google_http_status: status,
    ...(category === 'api_disabled' && project ? { api_setup_url: `https://console.cloud.google.com/apis/library/drive.googleapis.com?project=${encodeURIComponent(project)}` } : {}) };
}
