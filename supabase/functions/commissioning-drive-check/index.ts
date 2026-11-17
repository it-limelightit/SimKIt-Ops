import { createClient } from "npm:@supabase/supabase-js@2.108.0";
import { findCompanyRoot, discoverCompanyEvidence, summarizeDriveEvidence } from "../_shared/commissioning-drive.mjs";
import { explainGoogleDriveError } from "../_shared/commissioning-google-errors.mjs";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let cachedToken = "";
let tokenUntil = 0;
let cachedCredential = "";

async function accessToken(credential: {client_email: string; private_key: string}) {
  const credentialHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(`${credential.client_email}\n${credential.private_key}`))),value=>value.toString(16).padStart(2,"0")).join("");
  if (cachedToken && cachedCredential === credentialHash && Date.now() < tokenUntil) return cachedToken;
  const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const value = (body: unknown) => encode(new TextEncoder().encode(JSON.stringify(body)));
  const now = Math.floor(Date.now() / 1000);
  const input = `${value({alg:"RS256",typ:"JWT"})}.${value({iss:credential.client_email,scope:"https://www.googleapis.com/auth/drive.readonly",aud:"https://oauth2.googleapis.com/token",iat:now,exp:now+3600})}`;
  const pem = credential.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), char => char.charCodeAt(0)), {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"}, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const response = await fetch("https://oauth2.googleapis.com/token", {method:"POST",body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${input}.${encode(new Uint8Array(signature))}`}),signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error("Google authentication failed. Check the service account credential.");
  const result = await response.json();
  cachedToken=result.access_token;tokenUntil=Date.now()+3300000;cachedCredential=credentialHash;
  return cachedToken;
}

async function driveReader(credential: {client_email:string;private_key:string;project_id?:string}) {
  const bearer = await accessToken(credential);
  let requests = 0;
  const resourceKeys=new Map<string,string>();
  const deadline=Date.now()+85000;
  return async (path: string, params: Record<string,string>, resourceHeader?: string) => {
    if (++requests > 70 || Date.now() >= deadline) throw new Error("This company's folder tree is too large for a UI check. Use the verification worker.");
    const endpoint = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    if(resourceHeader && /^[\w-]+\/[\w-]+$/.test(resourceHeader))resourceKeys.set(resourceHeader.split('/')[0],resourceHeader);
    const fileId=path.startsWith("files/")?path.slice(6):params.q?.match(/^'([\w-]+)' in parents/)?.[1];
    const resourceKey=fileId?resourceKeys.get(fileId):undefined;
    for (const [key,value] of Object.entries({supportsAllDrives:"true",...params})) endpoint.searchParams.set(key,value);
    const response=await fetch(endpoint,{headers:{Authorization:`Bearer ${bearer}`,...(resourceKey?{"X-Goog-Drive-Resource-Keys":resourceKey}:{})},signal:AbortSignal.timeout(Math.min(10000,deadline-Date.now()))});
    if (!response.ok) {
      const body=await response.json().catch(()=>null);
      const folder_id=path.startsWith("files/")?path.slice(6):params.q?.match(/^'([\w-]+)' in parents/)?.[1];
      const diagnostic=explainGoogleDriveError(response.status,body,{service_account_email:credential.client_email,project_id:credential.project_id,folder_id});
      throw Object.assign(new Error(diagnostic.message),{driveDiagnostic:diagnostic});
    }
    return response;
  };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, {headers:cors});
  if (req.method !== "POST") return json({error:"POST required"},405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({error:"Sign in to check Drive evidence."},401);
    const body = await req.json();
    // Backend-only, read-only connection diagnosis. Never expose credentials through this route.
    if (["diagnose_setup","worker_access_token"].includes(body.action)) {
      const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceKey || authorization !== `Bearer ${serviceKey}`) {
        // Existing service keys may differ from the runtime-injected key after rotation.
        // Let PostgREST verify the signature and service-only EXECUTE grant; no row is changed.
        const gate=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
        const {data:probe,error:probeError}=await gate.rpc("can_access_site_for_verification",{_site:null,_worker:null});
        if (probeError || probe !== false) return json({error:"Backend service authentication required."},401);
      }
      const credentialString=Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
      const parentId=Deno.env.get("GOOGLE_DRIVE_COMPANIES_ROOT_ID")||"";
      if (!credentialString || !/^[\w-]+$/.test(parentId)) return json({status:"setup_required",read_only:true,messages:["Google credential or companies-parent folder ID is missing/invalid."]});
      let credential;
      try {credential=JSON.parse(credentialString);if(!credential.client_email||!credential.private_key)throw new Error();}
      catch {return json({status:"setup_required",read_only:true,messages:["Google service account credential is invalid."]});}
      if (body.action === "worker_access_token") return json({access_token:await accessToken(credential),expires_in:3300,companies_root_id:parentId});
      const request=await driveReader(credential);
      let root;
      try { root=await (await request(`files/${parentId}`,{fields:"id,name,mimeType,trashed"})).json(); }
      catch (error) {
        if ((error as Error & {driveDiagnostic?:{google_http_status:number}})?.driveDiagnostic?.google_http_status !== 404) throw error;
        // A common setup mistake is entering the folder label instead of its URL ID.
        // Only search folders already visible to this identity; no permissions are changed.
        const result=await (await request("files",{q:`mimeType = 'application/vnd.google-apps.folder' and name = '${parentId}' and trashed = false`,
          includeItemsFromAllDrives:"true",fields:"files(id,name),nextPageToken,incompleteSearch",pageSize:"100"})).json();
        if (result.files?.length && !result.incompleteSearch && !result.nextPageToken) return json({
          status:"folder_id_required",read_only:true,configured_value:parentId,
          folder_candidates:result.files.map((file:{id:string;name:string})=>({id:file.id,name:file.name})),
          messages:["The configured value is a visible folder name, not its Drive ID. Use the ID from the folder URL."]});
        throw error;
      }
      if (root.trashed || root.mimeType !== "application/vnd.google-apps.folder") return json({status:"setup_required",read_only:true,messages:["The configured companies parent is not an active Drive folder."]});
      await (await request("files",{q:`'${parentId}' in parents and trashed = false`,includeItemsFromAllDrives:"true",fields:"files(id),nextPageToken",pageSize:"1"})).json();
      let evidence;
      if (typeof body.company_name === "string" && body.company_name.trim() && body.company_name.length<=200) {
        const companyRoot=await findCompanyRoot(body.company_name,{},parentId,request);
        evidence={company_name:body.company_name,company_folder_id:companyRoot,...summarizeDriveEvidence(await discoverCompanyEvidence(companyRoot,request))};
      }
      return json({status:"connection_ok",read_only:true,service_account_email:credential.client_email,project_id:credential.project_id,
        parent_folder_id:parentId,parent_folder_name:root.name,...(evidence?{evidence}:{}),messages:["Configured Google identity can read and list the companies parent folder."]});
    }
    const url = Deno.env.get("SUPABASE_URL")!;
    const caller = createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!, {global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
    const {data:{user},error:authError} = await caller.auth.getUser();
    if (authError || !user) return json({error:"Sign in to check Drive evidence."},401);
    if (!idPattern.test(body.site_id || "")) return json({error:"A valid company/site ID is required."},400);
    const {data:allowed,error:accessError} = await caller.rpc("can_access_site",{_site_id:body.site_id});
    if (accessError || allowed !== true) return json({error:"You do not have access to this company."},403);
    const admin = createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const {data:site,error:siteError} = await admin.from("sites").select("company_name,name").eq("id",body.site_id).single();
    if (siteError || !site) return json({error:"Company could not be loaded."},404);
    const {data:mapping,error:mappingError} = await admin.from("commissioning_drive_folders").select("root_folder_id,certificate_policy").eq("site_id",body.site_id).maybeSingle();
    if (mappingError) return json({status:"setup_required",messages:["Commissioning verification migration is not ready."],read_only:true});
    const credentialString = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON");
    const parentId = Deno.env.get("GOOGLE_DRIVE_COMPANIES_ROOT_ID") || "";
    const missing = [];
    if (!credentialString) missing.push("Add GOOGLE_SERVICE_ACCOUNT_JSON to Supabase Edge Function Secrets.");
    if (!mapping?.root_folder_id && !parentId) missing.push("Add GOOGLE_DRIVE_COMPANIES_ROOT_ID with the parent folder containing your company folders.");
    if (missing.length) return json({status:"setup_required",messages:missing,read_only:true,company_name:site.company_name||site.name});
    let credential;
    try { credential=JSON.parse(credentialString!); if (!credential.client_email || !credential.private_key) throw new Error(); }
    catch { return json({status:"setup_required",messages:["The Google service account secret is invalid. Replace it in Supabase Secrets."],read_only:true}); }
    // Rate-limit metadata scans without changing any company or commissioning records.
    const {data:reserved,error:rateError} = await admin.rpc("reserve_commissioning_drive_check",{_site_id:body.site_id,_user_id:user.id});
    if (rateError || reserved !== true) return json({error:"Wait one minute before checking this company again."},429);
    const request = await driveReader(credential);
    const rootId = await findCompanyRoot(site.company_name||site.name,mapping||{},parentId,request);
    const groups = await discoverCompanyEvidence(rootId,request);
    const summary=summarizeDriveEvidence(groups);
    let commissioning;
    if (body.action === "commission" && summary.media_precheck_passed) {
      const letter=groups.certificate[0];
      if (['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(letter?.mimeType)) {
        commissioning={status:"needs_correction",message:"Upload completed letter as PDF."};
      } else {
        const {data:started,error:startError}=await caller.rpc("start_automatic_commissioning",{_site_id:body.site_id,_drive_link:`https://drive.google.com/drive/folders/${rootId}`});
        if (startError) return json({status:"check_failed",messages:["Automatic verification could not start. Retry later."],read_only:true});
        commissioning=started;
      }
    }
    return json({status:"checked",read_only:true,company_name:site.company_name||site.name,
      folder_url:`https://drive.google.com/drive/folders/${rootId}`,...summary,
      ...(commissioning?{commissioning_state:commissioning.status,commissioning_message:commissioning.message,job_id:commissioning.job_id,read_only:!['queued','checking','approved'].includes(commissioning.status)}:{}),
      certificate_ocr_status:"not_run",messages:[...summary.messages,
        "Read-only precheck complete. Letter OCR, logo, file readability and final approval require the configured verification worker. No status or dates were changed."]});
  } catch (error) {
    const diagnostic=(error as Error & {driveDiagnostic?:{message:string;category:string;google_reason:string;google_http_status:number;api_setup_url?:string}})?.driveDiagnostic;
    if (diagnostic) return json({status:"check_failed",messages:[diagnostic.message],read_only:true,
      diagnostic:{category:diagnostic.category,google_reason:diagnostic.google_reason,google_http_status:diagnostic.google_http_status},
      ...(diagnostic.api_setup_url?{api_setup_url:diagnostic.api_setup_url}:{})});
    const message=error instanceof Error ? error.message : "Drive check could not finish.";
    // Only controlled validation/provider messages are returned; never return credentials or stack traces.
    const safe=/^(Drive |Google |Company |Configure |This company's |Registered |Evidence )/.test(message) ? message : "Drive check could not finish. Check the server configuration and try again.";
    return json({status:"check_failed",messages:[safe],read_only:true},200);
  }
});
