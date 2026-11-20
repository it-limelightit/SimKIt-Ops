export const RULE_VERSION = 'media-total-v2';
export const LEGACY_RULE_VERSION = 'media-average-v1';
export const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const contains = (text, phrase) => Boolean(normalize(phrase)) && ` ${normalize(text)} `.includes(` ${normalize(phrase)} `);


export function evaluateMedia(files, ruleVersion = RULE_VERSION) {
  const messages = [];
  const unique = new Map();
  for (const file of files) {
    if (!file.valid || !file.sha256 || !['photo', 'video'].includes(file.kind)) continue;
    // Identical copies cannot inflate either count, regardless of their filenames.
    if (!unique.has(file.sha256)) unique.set(file.sha256, file);
  }
  const photos = [...unique.values()].filter(file => file.kind === 'photo');
  const videos = [...unique.values()].filter(file => file.kind === 'video');
  const durations = videos.map(file => file.duration_seconds);
  const known = durations.every(duration => typeof duration === 'number' && Number.isFinite(duration) && duration > 0);
  // FFprobe reports durations to microsecond precision. Sum integer microseconds at the boundary.
  const total = known ? durations.reduce((sum, duration) => sum + Math.round(duration * 1e6), 0) / 1e6 : null;
  const average = total !== null && videos.length ? total / videos.length : null;
  if (photos.length < 4) messages.push(`Upload at least 4 unique readable photos; found ${photos.length}.`);
  if (!known) messages.push('A video duration could not be verified.');
  if (ruleVersion === LEGACY_RULE_VERSION) {
    if (videos.length < 4) messages.push(`Upload at least 4 unique readable video clips; found ${videos.length}.`);
    if (average !== null && average < 120) messages.push('Video clips must average at least 120 seconds.');
  } else if (total !== null && total < 120) {
    messages.push('Upload readable video clips totaling at least 120 seconds.');
  }
  return { passed: messages.length === 0, photo_count: photos.length, video_count: videos.length,
    video_total_seconds: total, video_average_seconds: average, messages };
}

export function evaluateCertificate(text, company, policy, logoMatched, requestStamp) {
  const messages = [];
  // Signature image detection/authentication is not silently replaced with an OCR label.
  const configured = policy?.approved_for_automation === true && policy.signature_policy === 'name_and_designation_only'
    && Array.isArray(policy.required_phrases) && policy.required_phrases.length > 0 && policy.required_phrases.every(p => normalize(p))
    && Array.isArray(policy.signatory_names) && policy.signatory_names.length > 0 && policy.signatory_names.every(p => normalize(p))
    && Array.isArray(policy.designations) && policy.designations.length > 0 && policy.designations.every(p => normalize(p))
    && Number.isInteger(policy.max_age_days) && policy.max_age_days >= 0 && policy.max_age_days <= 366
    && /^[a-f0-9]{64}$/.test(policy.logo_sha256 ?? '');
  if (!configured) return { passed: false, needs_review: true,
    messages: ['Company certificate/logo/authority policy needs configuration and approval before automatic commissioning.'] };
  const aliases = [company, ...(Array.isArray(policy.company_aliases) ? policy.company_aliases : [])];
  if (!aliases.some(name => contains(text, name))) messages.push('Certificate company name does not match this site.');
  for (const phrase of policy.required_phrases) if (!contains(text, phrase)) messages.push(`Certificate is missing required text: ${phrase}`);
  if (!policy.signatory_names.some(name => contains(text, name))) messages.push('An approved signatory name could not be read.');
  if (!policy.designations.some(role => contains(text, role))) messages.push('An approved signatory designation could not be read.');
  if (!logoMatched) messages.push('The approved company logo could not be verified.');
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(requestStamp)).map(part=>[part.type,part.value]));
  const day = Date.UTC(Number(dateParts.year),Number(dateParts.month)-1,Number(dateParts.day));
  const dates = [...String(text).matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g)].map(([, d, m, y]) => {
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    return date.getUTCDate() === Number(d) && date.getUTCMonth() === Number(m) - 1 ? date.getTime() : NaN;
  });
  if (!dates.some(date => Number.isFinite(date) && date <= day && day - date <= policy.max_age_days * 86400000))
    messages.push('A certificate date within the approved date window could not be read (DD/MM/YYYY or DD-MM-YYYY).');
  return { passed: messages.length === 0, needs_review: messages.length > 0, messages };
}
