// Install inside the billing mailbox's own Google Apps Script project.
// Script properties: PAYMENT_ALERT_ENDPOINT, PAYMENT_ALERT_INGEST_SECRET.
// No email is sent, marked read, moved, or deleted.
function gmailRequest_(path) {
 const response=UrlFetchApp.fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{
  headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});
 if(response.getResponseCode()!==200) throw new Error('Gmail request failed: '+response.getResponseCode());
 return JSON.parse(response.getContentText());
}
function postAlerts_(messages,completed) {
 const properties=PropertiesService.getScriptProperties();
 const endpoint=properties.getProperty('PAYMENT_ALERT_ENDPOINT');
 const secret=properties.getProperty('PAYMENT_ALERT_INGEST_SECRET');
 if(!endpoint||!/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/payment-email-ingest$/.test(endpoint)||!secret||secret.length<32) throw new Error('Configure the endpoint and signing secret in Script Properties first.');
 const body=JSON.stringify({mailbox:'it@limelightit.io',messages:messages,completed:completed===true});
 const timestamp=String(Date.now());
 const signature=Utilities.computeHmacSha256Signature(timestamp+'.'+body,secret).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
 const response=UrlFetchApp.fetch(endpoint,{method:'post',contentType:'application/json',payload:body,
  headers:{'X-Payment-Timestamp':timestamp,'X-Payment-Signature':signature},muteHttpExceptions:true});
 if(response.getResponseCode()!==200) throw new Error('SimKit sync failed: '+response.getResponseCode()+'. Check endpoint/secret and try again.');
}
function checkContaboPayments() {
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 try {
  const properties=PropertiesService.getScriptProperties();
  if(String(gmailRequest_('profile').emailAddress).toLowerCase()!=='it@limelightit.io') throw new Error('Run this script from it@limelightit.io only.');
  const previous=Number(properties.getProperty('LAST_SUCCESS_MS'));
  // First run imports 30 days. Subsequent runs overlap by a day for delivery/indexing delays.
  const since=previous?Math.max(0,previous-86400000):Date.now()-30*86400000;
  const started=Date.now();
  const query='in:anywhere from:no-reply@contabo.com subject:"Payment missing" after:'+Math.floor(since/1000);
  let page;let pages=0;let batch=[];
  do {
   if(++pages>5)throw new Error('More than 500 matching emails. Contact your administrator; sync has not advanced.');
   const results=gmailRequest_('messages?maxResults=100&q='+encodeURIComponent(query)+(page?'&pageToken='+encodeURIComponent(page):''));
   for(const entry of results.messages||[]) {
    const message=gmailRequest_('messages/'+entry.id+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject');
    const headers=message.payload.headers;
    const sender=(headers.find(function(h){return h.name.toLowerCase()==='from';})||{}).value||'';
    const subject=(headers.find(function(h){return h.name.toLowerCase()==='subject';})||{}).value||'';
    const address=(sender.match(/<([^<>]+)>/)||[])[1]||sender.trim();
    if(address.toLowerCase()!=='no-reply@contabo.com'||!/^contabo\s*:\s*payment\s+missing\b/i.test(subject))continue;
    batch.push({id:message.id,sender:sender,subject:subject.slice(0,500),preview:(message.snippet||'').slice(0,500),received_at:new Date(Number(message.internalDate)).toISOString()});
    if(batch.length===10){postAlerts_(batch);batch=[];}
   }
   page=results.nextPageToken;
  }while(page);
  postAlerts_(batch,true); // Heartbeat only after the entire scan succeeds.
  properties.setProperty('LAST_SUCCESS_MS',String(started));
 }finally{lock.releaseLock();}
}
function installPaymentMonitor() {
 checkContaboPayments(); // Verify permission, mailbox and endpoint before installing.
 ScriptApp.getProjectTriggers().filter(function(t){return t.getHandlerFunction()==='checkContaboPayments';}).forEach(function(t){ScriptApp.deleteTrigger(t);});
 ScriptApp.newTrigger('checkContaboPayments').timeBased().everyMinutes(5).create();
}
