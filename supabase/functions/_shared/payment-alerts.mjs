export const PAYMENT_MAILBOX = 'it@limelightit.io';
export function parseContaboBatch(input) {
 if (!input || input.mailbox?.toLowerCase().trim() !== PAYMENT_MAILBOX || !Array.isArray(input.messages) || input.messages.length > 50) throw Error('Invalid batch');
 const messages = input.messages.map(m => {
  const from = typeof m.sender === 'string' ? m.sender.trim().toLowerCase() : '';
  const sender = from.match(/^[^<>]*<([^<>]+)>$/)?.[1] ?? from;
  if (sender !== 'no-reply@contabo.com' || typeof m.subject !== 'string' || !/^contabo\s*:\s*payment\s+missing\b/i.test(m.subject)
   || m.subject.length > 500 || !/^[a-f0-9]{8,64}$/i.test(m.id ?? '') || typeof m.received_at !== 'string'
   || !Number.isFinite(Date.parse(m.received_at)) || Date.parse(m.received_at) > Date.now()+300000
   || typeof m.preview !== 'string' || m.preview.length > 1000) throw Error('Invalid Contabo message');
  return {id:m.id,sender,subject:m.subject,preview:m.preview,received_at:new Date(m.received_at).toISOString()};
 });
 return {mailbox:PAYMENT_MAILBOX,messages,completed:input.completed===true};
}
export async function verifyPaymentSignature(secret,timestamp,signature,body,now=Date.now()) {
 if (!secret || secret.length<32 || !/^\d{13}$/.test(timestamp??'') || Math.abs(now-Number(timestamp))>300000 || !/^[a-f0-9]{64}$/i.test(signature??'')) return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(signature.match(/../g),s=>parseInt(s,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(`${timestamp}.${body}`));
}
