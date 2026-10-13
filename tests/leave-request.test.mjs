import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../src/lib/leave-request.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {prepareLeaveSubmission}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const today='2026-10-12';
const decisionSource=readFileSync(new URL('../src/lib/request-calendar.ts',import.meta.url),'utf8');
const decisionJs=ts.transpileModule(decisionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {requestCalendarStyle}=await import(`data:text/javascript;base64,${Buffer.from(decisionJs).toString('base64')}`);
test('calendar decision colors distinguish approved leave/WFH, rejections and pending dates',()=>{
  assert.match(requestCalendarStyle('leave','approved').tone,/violet/);
  assert.match(requestCalendarStyle('wfh','approved').tone,/indigo/);
  for(const kind of ['leave','wfh']){
    assert.match(requestCalendarStyle(kind,'rejected').tone,/rose/);
    assert.match(requestCalendarStyle(kind,'pending').tone,/amber/);
    assert.match(requestCalendarStyle(kind,'rejected').label,/rejected/);
  }
  assert.equal(requestCalendarStyle(null,null),null);
});
const calendarSource=readFileSync(new URL('../src/lib/employee-calendar.ts',import.meta.url),'utf8');
const calendarJs=ts.transpileModule(calendarSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {calendarSummary,calendarWeeks}=await import(`data:text/javascript;base64,${Buffer.from(calendarJs).toString('base64')}`);
test('calendar analytics distinguish approved WFH/leave from pending or rejected requests and unknown days',()=>{
  const days=[
    {date:'2026-10-01',status:'present',working_day:true},
    {date:'2026-10-02',status:'late',working_day:true},
    {date:'2026-10-03',status:'work_from_home',working_day:true},
    {date:'2026-10-04',status:'on_leave',working_day:true},
    {date:'2026-10-05',status:'needs_review',working_day:true,request_status:'pending'},
    {date:'2026-10-06',status:'scheduled',working_day:true,request_status:'rejected'},
    {date:'2026-10-07',status:'off_day',working_day:false},
  ];
  const summary=calendarSummary(days,'2026-10-05');
  assert.equal(summary.office,2);assert.equal(summary.wfh,1);assert.equal(summary.leave,1);
  assert.equal(summary.absent,0);assert.equal(summary.late,1);assert.equal(summary.working,6);
  assert.equal(summary.completed,3);assert.equal(summary.expected,4);
  const weeks=calendarWeeks(days);
  assert.equal(weeks.length,2);
  assert.equal(weeks.reduce((sum,w)=>sum+w.office,0),2);
  assert.equal(weeks.reduce((sum,w)=>sum+w.wfh+w.leave+w.review,0),3);
});
const input={requestType:'wfh',from:'2026-10-26',to:'2026-10-30',category:'',description:'  Working remotely for a family appointment  '};
test('WFH submits without the hidden leave category and uses the WFH endpoint',()=>{
  assert.deepEqual(prepareLeaveSubmission(input,today),{name:'attendance_submit_my_wfh',args:{_start:'2026-10-26',_end:'2026-10-30',_description:'Working remotely for a family appointment'}});
  assert.equal('_category' in prepareLeaveSubmission({...input,category:'Marriage'},today).args,false);
});
test('leave still requires a category and sends it to the leave endpoint',()=>{
  assert.throws(()=>prepareLeaveSubmission({...input,requestType:'leave'},today),/Select a reason category/);
  const submission=prepareLeaveSubmission({...input,requestType:'leave',category:'Family medical'},today);
  assert.equal(submission.name,'attendance_submit_my_leave');
  assert.equal(submission.args._category,'Family medical');
});
test('invalid dates and descriptions produce actionable validation errors',()=>{
  assert.throws(()=>prepareLeaveSubmission({...input,from:''},today),/Choose a start date/);
  assert.throws(()=>prepareLeaveSubmission({...input,from:'2026-10-11'},today),/today or a future/);
  assert.throws(()=>prepareLeaveSubmission({...input,to:'2026-10-25'},today),/end date/);
  assert.throws(()=>prepareLeaveSubmission({...input,to:'2027-02-01'},today),/91 calendar days/);
  assert.throws(()=>prepareLeaveSubmission({...input,description:'  abc  '},today),/5 and 1800/);
});
