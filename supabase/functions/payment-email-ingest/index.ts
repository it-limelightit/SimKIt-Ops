import { createClient } from 'npm:@supabase/supabase-js@2';
import { parseContaboBatch, verifyPaymentSignature } from '../_shared/payment-alerts.mjs';

Deno.serve(async (req: Request) => {
 const reply=(status:number,value:unknown)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
 if(req.method!=='POST') return reply(405,{error:'POST required'});
 const secret=Deno.env.get('PAYMENT_ALERT_INGEST_SECRET');
 if(!secret) return reply(503,{error:'Monitor setup required'});
 if(Number(req.headers.get('content-length'))>65536) return reply(413,{error:'Payload too large'});
 // Bound chunked requests too, before allocating the full payload.
 const reader=req.body?.getReader();
 if(!reader) return reply(400,{error:'Missing payload'});
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return reply(413,{error:'Payload too large'});}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const body=new TextDecoder().decode(bytes);
 if(!await verifyPaymentSignature(secret,req.headers.get('x-payment-timestamp'),req.headers.get('x-payment-signature'),body)) return reply(401,{error:'Invalid signature'});
 let batch;
 try{batch=parseContaboBatch(JSON.parse(body));}catch{return reply(400,{error:'Invalid Contabo message batch'});}
 const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.rpc('ingest_payment_emails',{_mailbox:batch.mailbox,_messages:batch.messages,_completed:batch.completed});
 if(error) return reply(503,{error:'Could not save payment alerts; retry later'});
 return reply(200,{inserted:data});
});
