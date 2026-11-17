// Portable read-only discovery shared by the Supabase UI precheck and local worker tests.
const FOLDER = 'application/vnd.google-apps.folder';
const SHORTCUT = 'application/vnd.google-apps.shortcut';
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,version,md5Checksum,parents,videoMediaMetadata,trashed,resourceKey,shortcutDetails(targetId,targetMimeType,targetResourceKey)';
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// M/S is a business salutation, not part of the company folder name.
const companyName = value => normalize(String(value ?? '').normalize('NFKC').trim().replace(/^m\s*\/\s*s\.?\s+/i, ''));
const validId = value => typeof value === 'string' && /^[\w-]+$/.test(value);
const letterName = name => /commission|commision|commison|comission|comision|certificate|letter|latter/.test(normalize(name).replaceAll(' ', ''));
const mediaName = name => /\b(media|photos?|photographs?|images?|videos?|clips?)\b/.test(normalize(name));
const documentFile = file => file.mimeType === 'application/pdf' || /^image\//.test(file.mimeType)
  || ['application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(file.mimeType);

export async function listDriveFolder(id, request, maxEntries = 60) {
  if (!validId(id)) throw new Error('Registered Drive folder ID is invalid');
  let pageToken;
  const files = [];
  do {
    const response = await request('files', { q: `'${id}' in parents and trashed = false`, includeItemsFromAllDrives: 'true',
      fields: `nextPageToken,incompleteSearch,files(${FILE_FIELDS})`,
      pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const page = await response.json();
    if (page.incompleteSearch) throw new Error('Drive returned an incomplete listing');
    files.push(...(page.files ?? []));
    if (files.length > maxEntries) throw new Error('Drive folder exceeds the configured processing limit');
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files;
}

async function resolveShortcut(file, request) {
  const links = [];
  const seen = new Set();
  let target = file;
  while (target.mimeType === SHORTCUT) {
    if (seen.has(target.id) || links.length >= 5) throw new Error('Drive shortcut loop or excessive shortcut chain detected.');
    seen.add(target.id);
    const targetId = target.shortcutDetails?.targetId;
    if (!validId(targetId)) throw new Error(`Drive shortcut target is missing: ${file.name || file.id}.`);
    links.push(target);
    const resourceKey = target.shortcutDetails?.targetResourceKey;
    target = await (await request(`files/${targetId}`, { fields: FILE_FIELDS }, resourceKey ? `${targetId}/${resourceKey}` : undefined)).json();
    if (target.trashed || !target.id || !target.mimeType) throw new Error(`Drive shortcut target is unavailable: ${file.name || file.id}.`);
  }
  return { target, links };
}

export async function findCompanyRoot(company, mapping, parentId, request) {
  if (mapping.root_folder_id) {
    if (!validId(mapping.root_folder_id)) throw new Error('Registered Drive folder ID is invalid');
    const file=await (await request(`files/${mapping.root_folder_id}`,{fields:FILE_FIELDS})).json();
    const {target}=await resolveShortcut(file,request);
    if (target.mimeType!==FOLDER || target.trashed) throw new Error('Company evidence root must be an accessible folder.');
    return target.id;
  }
  if (!validId(parentId)) throw new Error('Configure the parent Drive folder containing company folders');
  const names = [company, ...(mapping.certificate_policy?.company_aliases ?? [])].map(companyName).filter(Boolean);
  // Ignore unrelated shortcuts in the shared parent. Resolve only company-name matches.
  const candidates = (await listDriveFolder(parentId, request, 2000)).filter(file => [FOLDER,SHORTCUT].includes(file.mimeType) && names.includes(companyName(file.name)));
  const matches = new Set();
  for (const candidate of candidates) {
    const {target}=await resolveShortcut(candidate,request);
    if (target.mimeType===FOLDER && !target.trashed) matches.add(target.id);
  }
  if (matches.size !== 1) throw new Error('Company folder name is missing or ambiguous; pin its exact folder ID');
  return [...matches][0];
}

export async function discoverCompanyEvidence(rootId, request) {
  const groups = { photo: [], video: [], certificate: [], folders: [], shortcuts: [] };
  const visited = new Map();
  const active = new Set();
  const add=(kind,file)=>{if(!groups[kind].some(existing=>existing.id===file.id))groups[kind].push(file);};
  let entries = 0;
  async function walk(id, context, depth) {
    if (active.has(id)) throw new Error('Drive shortcut folder loop detected. Remove the circular shortcut and retry.');
    if (visited.has(id)) {
      if (visited.get(id)!==context) throw new Error('Drive folder has conflicting media and certificate locations. Keep one clear evidence location.');
      return;
    }
    if (depth > 5 || visited.size >= 50) throw new Error('Company folder nesting exceeds safe processing limits');
    visited.set(id,context);active.add(id);
    const children = await listDriveFolder(id, request);
    entries += children.length;
    if (entries > 500) throw new Error('Company evidence exceeds the 500-entry processing limit');
    for (const original of children) {
      const {target:file,links}=await resolveShortcut(original,request);
      for(const link of links)add('shortcuts',link);
      const names=[original.name,file.name];
      if (file.mimeType === FOLDER) {
        add('folders',file);
        const next = names.some(letterName) ? 'letter' : context === 'letter' ? 'letter' : names.some(mediaName) ? 'media' : context;
        await walk(file.id, next, depth + 1);
      } else if (documentFile(file) && (context === 'letter' || names.some(letterName))) {
        add('certificate',file);
      } else if (context === 'media') {
        if (/^image\//.test(file.mimeType)) add('photo',file);
        if (/^video\//.test(file.mimeType)) add('video',file);
      } else if (depth === 0 && documentFile(file)) add('certificate',file);
      else if (depth === 0 && /^video\//.test(file.mimeType)) add('video',file);
    }
    active.delete(id);
  }
  await walk(rootId, 'root', 0);
  groups.photo=groups.photo.filter(photo=>!groups.certificate.some(letter=>letter.id===photo.id));
  return groups;
}

export function summarizeDriveEvidence(groups) {
  const seen = new Set();
  const unique = files => files.filter(file => {
    // Binary Drive files expose MD5; lack of checksum makes duplicate exclusion uncertain.
    const key = file.md5Checksum ? `hash:${file.md5Checksum}` : `id:${file.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const photos = unique(groups.photo);
  const videos = unique(groups.video);
  const durations = videos.map(file => Number(file.videoMediaMetadata?.durationMillis) / 1000);
  const durationKnown = durations.every(value => Number.isFinite(value) && value > 0);
  const average = videos.length && durationKnown ? durations.reduce((sum, value) => sum + value, 0) / videos.length : null;
  const messages = [];
  if (photos.length < 4) messages.push(`At least 4 unique photos are required; found ${photos.length}.`);
  if (videos.length < 4) messages.push(`At least 4 unique video clips are required; found ${videos.length}.`);
  if (average === null) messages.push('Video duration metadata is unavailable. Retry after Drive finishes processing, or use the verification worker.');
  else if (average < 120) messages.push(`Average video duration is ${average.toFixed(1)} seconds; at least 120 seconds is required.`);
  if (groups.certificate.length !== 1) messages.push(`Expected one final commissioning letter; found ${groups.certificate.length}.`);
  if ([...photos,...videos].some(file => !file.md5Checksum)) messages.push('Some files have no checksum; duplicate verification needs the worker.');
  return { photo_count: photos.length, video_count: videos.length, video_average_seconds: average,
    certificate_count: groups.certificate.length, media_precheck_passed: messages.length === 0, messages,
    photos: photos.map(file => ({ name: file.name })),
    videos: videos.map((file, index) => ({ name: file.name, duration_seconds: Number.isFinite(durations[index]) ? durations[index] : null })),
    certificates: groups.certificate.map(file => ({ name: file.name })) };
}
