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

test('submitted assessment with pending factory form is visible without claiming completion',()=>{
  assert.equal(getFactoryFormState(pending).submitted,true);
  assert.equal(getFactoryFormState(pending).completed,false);
  assert.match(getFactoryFormState(pending).title,/factory form pending/);
});
test('unsubmitted draft with completion checkbox is not a submitted factory form',()=>{
  assert.equal(getFactoryFormState({factory_operations_done:true}).submitted,false);
  assert.equal(getFactoryFormState({factory_operations_done:true}).completed,false);
  assert.equal(shouldNotifyFactorySubmission(null,{factory_operations_done:true}),false);
});
test('pending submission generates an assessment notification only once',()=>{
  assert.equal(shouldNotifyFactorySubmission(null,pending),true);
  assert.equal(shouldNotifyFactorySubmission(pending,{...pending,mom_uploaded:true}),false);
});
test('finishing a factory form after assessment submission generates a completion notification',()=>{
  assert.equal(shouldNotifyFactorySubmission(pending,completed),true);
  assert.equal(getFactoryFormState(completed).title,'New factory form submitted');
  assert.notEqual(getFactoryFormState(pending).submissionKey,getFactoryFormState(completed).submissionKey);
});
test('editing a completed factory form does not resend its submission notification',()=>{
  assert.equal(shouldNotifyFactorySubmission(completed,{...completed,factory_op_name:'Updated name'}),false);
});
