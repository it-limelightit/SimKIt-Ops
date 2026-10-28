import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export function connectionUrl(input) {
  let url;
  try { url = new URL(input); } catch {
    throw new Error('Missing or invalid URL. Paste a complete URL starting with https://.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Use an HTTPS Supabase URL without embedded credentials or a fragment.');
  }
  let project;
  if (url.hostname === 'mcp.supabase.com' && url.pathname === '/mcp') {
    project = url.searchParams.get('project_ref');
  } else if (/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)) {
    project = url.hostname.split('.')[0];
  } else if (url.hostname === 'supabase.com') {
    project = /^\/dashboard\/project\/([a-z0-9]+)(?:\/|$)/.exec(url.pathname)?.[1];
  }
  if (!project || !/^[a-z0-9]+$/.test(project)) {
    throw new Error('Supply a hosted project URL, Dashboard project URL, or MCP URL containing project_ref.');
  }
  return `https://mcp.supabase.com/mcp?project_ref=${project}&read_only=true&features=database`;
}

function parseResponse(body) {
  try { return JSON.parse(body); } catch { /* Streamable HTTP can return SSE. */ }
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (!data) continue;
    try {
      const message = JSON.parse(data);
      if (message.id != null) return message;
    } catch { /* Ignore non-JSON events. */ }
  }
  throw new Error('Server did not return a recognizable MCP response.');
}

export function extractSiteCount(result) {
  if (result === null || result === undefined) return undefined;
  if (typeof result === 'object') {
    if (Object.hasOwn(result, 'site_count') && /^\d+$/.test(String(result.site_count))) {
      return String(result.site_count);
    }
    for (const value of Object.values(result)) {
      const count = extractSiteCount(value);
      if (count !== undefined) return count;
    }
  }
  if (typeof result === 'string') {
    // Some servers JSON-encode the tool text, including the result and safety wrapper.
    try {
      const decoded = JSON.parse(result);
      if (decoded !== result) return extractSiteCount(decoded);
    } catch { /* Safety wrappers and Markdown are not standalone JSON. */ }
    return /["\\]*site_count["\\]*\s*:\s*["\\]*(\d+)/.exec(result)?.[1];
  }
  return undefined;
}

async function main() {
  const url = connectionUrl(process.env.SIMKIT_MCP_URL || '');
  const token = process.env.SIMKIT_MCP_TOKEN;
  if (!token) throw new Error('Missing token. Run the PowerShell launcher.');
  let session;
  let protocol;
  let id = 0;
  async function call(method, params, notification = false) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (session) headers['Mcp-Session-Id'] = session;
    if (protocol) headers['MCP-Protocol-Version'] = protocol;
    const response = await fetch(url, {
      method: 'POST', headers, redirect: 'error',
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: ++id }), method, params }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const hint = response.status === 401 ? 'Check that this is a valid Supabase personal access token.'
        : response.status === 403 ? 'Check the token permissions and project access.'
        : response.status === 404 ? 'Check the project reference.' : 'Check network access and Supabase availability.';
      throw new Error(`HTTP ${response.status}. ${hint}`);
    }
    session = response.headers.get('mcp-session-id') || session;
    if (notification) { await response.body?.cancel(); return; }
    const message = parseResponse(await response.text());
    if (message.error) throw new Error(`MCP error ${message.error.code}; server details withheld to avoid exposing data.`);
    return message.result;
  }
  console.log('Connecting with project scope, read_only=true, and database tools only.');
  const initialized = await call('initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'simkit-readonly-local-test', version: '1.0.0' },
  });
  protocol = initialized.protocolVersion;
  await call('notifications/initialized', {}, true);
  console.log('PASS: MCP initialization and authentication.');
  const names = [];
  let cursor;
  do {
    const page = await call('tools/list', cursor ? { cursor } : {});
    names.push(...page.tools.map(tool => tool.name));
    cursor = page.nextCursor;
  } while (cursor);
  console.log(`Available tools: ${names.join(', ')}`);
  if (!names.includes('execute_sql')) throw new Error('execute_sql is unavailable with these permissions.');
  async function query(sql) {
    const result = await call('tools/call', { name: 'execute_sql', arguments: { query: sql } });
    if (result.isError) throw new Error('SQL tool failed; response withheld to avoid exposing database details.');
    return result;
  }
  const readonly = await query("SELECT current_setting('transaction_read_only') AS transaction_read_only");
  const content = JSON.stringify(readonly);
  if (!/transaction_read_only[\\\s\":]+on\b/.test(content)) {
    throw new Error('Could not confirm transaction_read_only=on. Stopped before accessing application tables.');
  }
  console.log('PASS: PostgreSQL confirms transaction_read_only=on.');
  await query('SELECT count(*) AS visible_public_tables FROM information_schema.tables WHERE table_schema = \'public\'');
  console.log('PASS: Database metadata query.');
  const sites = await query('SELECT count(*) AS site_count FROM public.sites');
  console.log('PASS: Site count query.');
  const siteCount = extractSiteCount(sites);
  if (siteCount !== undefined) {
    console.log(`Total sites in database: ${siteCount}`);
  } else {
    console.log('Site query succeeded, but its response format could not be read automatically.');
  }
  console.log('Connection test complete. Business totals still need comparison with your app rules.');
}

if (process.argv.includes('--self-test')) {
  assert.equal(connectionUrl('https://example123.supabase.co'), 'https://mcp.supabase.com/mcp?project_ref=example123&read_only=true&features=database');
  assert.equal(connectionUrl('https://mcp.supabase.com/mcp?project_ref=abc&read_only=false&features=functions'), 'https://mcp.supabase.com/mcp?project_ref=abc&read_only=true&features=database');
  assert.throws(() => connectionUrl('https://example.com/mcp?project_ref=abc'));
  assert.throws(() => connectionUrl('https://mcp.supabase.com/mcp'));
  assert.deepEqual(parseResponse('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n').result, {});
  const sample = JSON.stringify({ content: [{ type: 'text', text: '[{"transaction_read_only":"on"}]' }] });
  assert.match(sample, /transaction_read_only[\\\s\":]+on\b/);
  assert.equal(extractSiteCount({ content: [{ type: 'text', text: 'Result:\n<untrusted-data>[{"site_count":123}]</untrusted-data>' }] }), '123');
  assert.equal(extractSiteCount({ content: [{ type: 'text', text: JSON.stringify('Result:\n<untrusted-data>[{"site_count":0}]</untrusted-data>') }] }), '0');
  assert.equal(extractSiteCount({ structuredContent: { rows: [{ site_count: '42' }] } }), '42');
  assert.equal(extractSiteCount({ content: [{ text: 'Result: [{\\"site_count\\":12}]' }] }), '12');
  assert.equal(extractSiteCount({ content: [{ text: 'No result' }] }), undefined);
  console.log('Local checks passed. No network request or credentials used.');
} else if (process.argv.includes('--validate-url')) {
  try {
    connectionUrl(process.env.SIMKIT_MCP_URL || '');
    console.log('Project URL accepted. Read-only mode will be enforced.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Do not print raw fetch errors, response bodies, headers, or stack traces.
    console.error(`Test failed: ${error.message.replaceAll(process.env.SIMKIT_MCP_TOKEN || '\u0000', '[REDACTED]')}`);
    process.exitCode = 1;
  });
}
