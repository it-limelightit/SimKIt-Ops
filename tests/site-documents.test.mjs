import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const source=fs.readFileSync(new URL('../src/lib/site-documents.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {getSiteDocumentPath,resolveSiteDocumentUrl}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const project='https://example.supabase.co';
const path='site-id/assessment/mom/report 100%.pdf';
const stored=mode=>`${project}/storage/v1/object/${mode}/site-docs/${path.split('/').map(encodeURIComponent).join('/')}`;

test('legacy, authenticated and previously signed references resolve to the same original path',()=>{
 for(const mode of ['public','authenticated','sign']) assert.equal(getSiteDocumentPath(stored(mode)+(mode==='sign'?'?token=expired':''),project),path);
});
test('external links and media files are left unchanged and never signed',async()=>{
 const storage={from(){assert.fail('External links must not access Storage');}};
 for(const url of ['https://drive.google.com/file/d/abc',stored('public').replace('example.supabase.co','other.supabase.co'),stored('public').replace('site-docs/','site-media/')]){
  assert.equal(getSiteDocumentPath(url,project),null);
  assert.equal(await resolveSiteDocumentUrl(url,project,storage),url);
 }
});
test('malformed or encoded traversal references cannot escape document paths',()=>{
 for(const url of [stored('public').replace(/report.*$/,'%ZZ'),`${project}/storage/v1/object/public/site-docs/site-id/%2e%2e%2fsecret`,`${project}/storage/v1/object/public/site-docs/site-id/%5csecret`]) assert.equal(getSiteDocumentPath(url,project),null);
});
test('signs at access time with a short expiry and no stored stale token',async()=>{
 const calls=[];
 const storage={from(bucket){calls.push(bucket);return {async createSignedUrl(objectPath,expiry){calls.push(objectPath,expiry);return {data:{signedUrl:'https://signed.example/fresh'},error:null};}};}};
 assert.equal(await resolveSiteDocumentUrl(stored('sign')+'?token=expired',project,storage),'https://signed.example/fresh');
 assert.deepEqual(calls,['site-docs',path,300]);
});
test('denied or missing document never falls back to a public download',async()=>{
 for(const result of [{data:null,error:{message:'Denied'}},{data:null,error:null}]){
  const storage={from(){return {async createSignedUrl(){return result;}};}};
  await assert.rejects(resolveSiteDocumentUrl(stored('authenticated'),project,storage),/access denied/i);
 }
});
