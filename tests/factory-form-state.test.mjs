import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const code=ts.transpileModule(fs.readFileSync('src/lib/factory-form-state.ts','utf8'),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const {getFactoryFormState,shouldNotifyFactorySubmission}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const pending={assessment_phase_submitted:true,factory_operations_done:false,factory_form_submitted_at:'2026-10-07T12:23:09.869Z'};
const completed={...pending,factory_operations_done:true};

test('submitted assessment with pending factory form is not a completed factory submission',()=>{
  assert.equal(getFactoryFormState(pending).submitted,true);
  assert.equal(getFactoryFormState(pending).completed,false);
  assert.match(getFactoryFormState(pending).title,/factory form pending/);
});
test('unsubmitted draft with completion checkbox is not a submitted factory form',()=>{
  assert.equal(getFactoryFormState({factory_operations_done:true}).submitted,false);
  assert.equal(getFactoryFormState({factory_operations_done:true}).completed,false);
  assert.equal(shouldNotifyFactorySubmission(null,{factory_operations_done:true}),false);
});
test('pending assessment submissions never generate factory-form notifications',()=>{
  assert.equal(shouldNotifyFactorySubmission(null,pending),false);
  assert.equal(shouldNotifyFactorySubmission(pending,{...pending,mom_uploaded:true}),false);
});
test('first completed factory submission generates a notification',()=>{
  assert.equal(shouldNotifyFactorySubmission(null,completed),true);
});
test('finishing a factory form after assessment submission generates a completion notification',()=>{
  assert.equal(shouldNotifyFactorySubmission(pending,completed),true);
  assert.equal(getFactoryFormState(completed).title,'New factory form submitted');
  assert.notEqual(getFactoryFormState(pending).submissionKey,getFactoryFormState(completed).submissionKey);
});
test('editing a completed factory form does not resend its submission notification',()=>{
  assert.equal(shouldNotifyFactorySubmission(completed,{...completed,factory_op_name:'Updated name'}),false);
});

test('the Telegram server handler rejects pending forms even when called directly',async()=>{
  globalThis.factoryNotificationTest={getFactoryFormState,shouldNotifyFactorySubmission,
    createServerFn(){return {validator(){return this;},handler(fn){return fn;}};},
    supabaseAdmin:{from(){throw Error('Pending forms must not trigger site lookup or Telegram');}},
  };
  const compiled=ts.transpileModule(fs.readFileSync('src/lib/factory-form-notification.ts','utf8'),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
  }).outputText.replace(/^import .*?;\r?\n/gm,'');
  const prefix='const {getFactoryFormState,shouldNotifyFactorySubmission,createServerFn,supabaseAdmin}=globalThis.factoryNotificationTest;\n';
  const {notifyFactoryFormSubmittedFn}=await import('data:text/javascript;base64,'+Buffer.from(prefix+compiled).toString('base64'));
  const result=await notifyFactoryFormSubmittedFn({data:{siteId:'example',assessmentData:pending}});
  assert.equal(result.skipped,true);assert.equal(result.error,'Factory form is pending');
  delete globalThis.factoryNotificationTest;
});
