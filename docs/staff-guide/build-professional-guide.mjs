import {jsPDF} from 'jspdf';
import autoTable from 'jspdf-autotable';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const dir=path.dirname(fileURLToPath(import.meta.url));
const pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
const C={navy:'#172B4D',blue:'#3656C9',body:'#33445C',muted:'#65758B',line:'#DCE3ED',pale:'#F2F5FC'};
let y=0;const pages=[];
function text(s,size=11.5,bold=false,color=C.body,x=19,width=172){pdf.setFont('helvetica',bold?'bold':'normal');pdf.setFontSize(size);pdf.setTextColor(color);const lines=pdf.splitTextToSize(s,width);pdf.text(lines,x,y);y+=lines.length*size*.46+2.7;}
function page(section,title,description){if(pages.length)pdf.addPage();pages.push({page:pages.length+1,title});pdf.setFillColor(C.navy);pdf.rect(0,0,210,15,'F');pdf.setFont('helvetica','bold');pdf.setFontSize(9);pdf.setTextColor('#FFFFFF');pdf.text('SIMKIT OPS',19,9.5);pdf.setFont('helvetica','normal');pdf.text('STAFF USER GUIDE',191,9.5,{align:'right'});y=27;text(section.toUpperCase(),9,true,C.blue);y+=1;text(title,25,true,C.navy);text(description,11.5,false,C.muted);y+=3;}
function heading(s){y+=2;text(s,13.5,true,C.navy);}
function step(n,title,body){pdf.setFillColor(C.pale);pdf.circle(23,y-1,4,'F');pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.setTextColor(C.blue);pdf.text(String(n),23,y+.1,{align:'center'});text(title,11.5,true,C.navy,31,160);text(body,11,false,C.body,31,160);y+=1;}
function note(title,body){pdf.setFont('helvetica','normal');pdf.setFontSize(10.8);const lines=pdf.splitTextToSize(body,158);const h=14+lines.length*4.95;pdf.setFillColor(C.pale);pdf.roundedRect(19,y,172,h,2,2,'F');pdf.setFillColor(C.blue);pdf.rect(19,y,1,h,'F');y+=6;text(title,10,true,C.blue,25,160);text(body,10.8,false,C.body,25,158);y+=3;}
function table(headers,rows,widths){autoTable(pdf,{startY:y,head:[headers],body:rows,theme:'grid',margin:{left:19,right:19},styles:{font:'helvetica',fontSize:10.5,cellPadding:3.7,textColor:C.body,lineColor:C.line,lineWidth:.15,overflow:'linebreak'},headStyles:{fillColor:C.navy,textColor:'#FFFFFF',fontStyle:'bold'},alternateRowStyles:{fillColor:'#F8FAFD'},columnStyles:widths??{}});y=pdf.lastAutoTable.finalY+6;}
function shot(name,label,maxHeight=88){const data=readFileSync(path.join(dir,'screenshots',name+'.png'));const info=pdf.getImageProperties(data);const w=Math.min(166,maxHeight*info.width/info.height),h=w*info.height/info.width;pdf.setFillColor('#FFFFFF');pdf.setDrawColor(C.line);pdf.roundedRect(19,y,172,h+6,2,2,'FD');pdf.addImage(data,'PNG',105-w/2,y+3,w,h,undefined,'FAST');y+=h+11;text(label,9,false,C.muted);y+=1;}
function check(){console.log(`Page ${pages.length}: content ends at ${y.toFixed(1)} mm`);if(y>274)throw new Error('Page overflow: '+pages.length);}

page('Getting started','Staff User Guide','Attendance, requests and expenses - explained step by step.');
text('For managers, office staff and field associates',14,true,C.blue);
text('Use SimKit to record your working day, request approval and track expenses. Sign in with your assigned account. Your menu shows the options available to your role.');
heading('Find the section you need');
table(['Task','Page'],[['Record daily attendance','2'],['Apply for leave','3'],['Request work from home (WFH)','4'],['Request late / half-day arrival','5'],['Submit an expense','6'],['Track expense approval and payment','7'],['Review requests as a manager','8'],['Check deadlines or get help','9']],{0:{cellWidth:145},1:{cellWidth:27,halign:'center'}});
note('REMEMBER THESE THREE RULES','Pending means waiting for approval.\nLate arrival requests close at 8:00 AM IST.\nExpense approval and payment are separate stages.');
text('Screenshots show the actual app interface with sample data. Names, dates and amounts are examples. Layouts may vary on a phone.',10,false,C.muted);
text('Version 1.1  |  23 October 2026  |  Internal staff use',9.5,false,C.muted);check();

page('01 / Attendance','Record your attendance','Follow the process for your role every working day.');
heading('Office staff and office-based managers');
step(1,'Scan when you arrive','Use the office face attendance device when you reach the office.');
step(2,'Check the recorded entry','Open My attendance, or your attendance screen. Check the date, scan time and status. Report missing or incorrect entries promptly.');
heading('Field associates');
shot('field-online','Field attendance: select Mark as online at the start of work.',61);
step(1,'Start work','Select Mark as online. Plan your visits or continue to your dashboard.');
step(2,'Update work and finish','Keep visit details and work status up to date. Complete the required work and approvals before marking a visit complete. Select Mark offline when you finish.');
note('IF YOUR ATTENDANCE IS INCORRECT','Tell your manager/admin the date and your actual arrival or start time. Share the error details or a screenshot, if available.');check();

page('02 / Leave','Apply for leave','Open Leave & WFH > New request > Leave.');
shot('leave','Example: a one-day leave request with dates, category and reason.',81);
step(1,'Enter the leave dates','Choose the start and end dates. For one day, enter the same date in both fields.');
step(2,'Explain the reason and submit','Choose a reason category. Add a short, clear explanation, then select Submit leave request. Apply in advance whenever possible.');
step(3,'Check the decision for each date','Open Request history. Check which dates are approved. A request can be partly approved; follow the decision for each day.');
note('DATE RULE','Choose today or a future start date. The app blocks past start dates. For an emergency, inform your manager immediately and submit as soon as possible.');
text('Pending means waiting for a decision. If a date is rejected, contact your manager to discuss the next step.',10.5);check();

page('03 / Work from home','Request WFH','Open Leave & WFH > New request > Work from home.');
shot('wfh','Work from home is shown only when WFH is enabled for your account.',77);
step(1,'Check that the option is available','WFH must be enabled for your linked office or manager attendance account. If the option is missing, ask your manager/admin to check eligibility.');
step(2,'Enter dates and the reason','Choose today or future dates. Explain why you need WFH, then submit the request.');
step(3,'Check approval and work as agreed','Check each date in Request history. Once approved, stay available during agreed working hours and keep your manager updated.');
note('APPROVAL IS REQUIRED','Do not treat a pending WFH request as approved. If it is rejected or your dates change, contact your manager and follow the recorded decision.');
text('Example reason: "Requesting WFH on 26 October for a home appointment. I will be available during working hours."',10.5);check();

page('04 / Late arrival','Late / half-day arrival','Open Leave & WFH > New request > Late / half-day arrival.');
note('SUBMIT BY 8:00 AM IST','Apply by 8:00 AM on the requested day, two hours before the 10:00 AM office start. Applications for that date close after the deadline.');
shot('late','Example: expected arrival at 11:00 AM for a medical appointment.',76);
step(1,'Enter your expected arrival','Choose the date and an arrival time after 10:00 AM. Select Late arrival or Half-day arrival.');
step(2,'Choose the reason and submit','Select the reason category and add a clear explanation. If you select Other, you must enter an explanation.');
step(3,'Check approval and record attendance','Check the decision in Request history. Record your actual attendance when you arrive.');
text('Unexpected delay after 8:00 AM? Contact your manager immediately. The app will not accept a request for that date after the deadline.',10.5,true,C.blue);check();

page('05 / Expenses','Submit a work expense','Open Expense / My expenses > Add Expense.');
shot('expense','The Add Expense form. Complete the details before Submit to Hardik.',108);
step(1,'Enter the expense details','Enter the actual date, amount in INR, expense name, category and work purpose. Mention the site or visit where relevant. Future dates are blocked.');
step(2,'Attach clear bills or receipts','Accepted: PDF, JPG or PNG. Maximum: 5 files, up to 5 MB each. Check that the amount and details are readable.');
step(3,'Review and submit once','Check the details, then select Submit to Hardik. Keep the original proof and follow the claim status. Avoid duplicate claims.');
text('Missing receipt? Explain the situation and ask the finance reviewer what supporting proof is acceptable.',10.5,false,C.muted);check();

page('06 / Expense tracking','From claim to payment','Check the status to understand what happens next.');
table(['Stage','What it means'],[['Pending with Hardik','Your claim is waiting for the first review.'],['Verified by Hardik','The claim has been checked. It must still be forwarded for final approval.'],['Sent to Tarun','Your claim is waiting for final approval.'],['Approved','Final approval is recorded. Payment may still be pending.'],['Paid','Payment has been recorded. Check the payment details.']],{0:{cellWidth:52},1:{cellWidth:120}});
heading('Which month does the claim belong to?');
text('A new claim belongs to the month you submit it. For example, a September expense submitted in October belongs to October settlement. Submit expenses promptly.');
heading('If a claim is rejected');
text('Read the rejection reason. Open the claim and select Edit & Reapply. Correct the details or attachments and submit again. The settlement month stays the same. Both reviews restart with Hardik.');
note('EXAMPLE: OCTOBER SETTLEMENT','Reapply for a rejected claim by 5 November.\nApproved claims become payable from 7 November.\nCheck Paid status to confirm payment is recorded.');
text('The 5th is the deadline for reapplying for rejected claims. Actual payment depends on approval and processing.',10,false,C.muted);check();

page('07 / Managers and approvers','Review and record decisions','Use the approval options assigned to your account.');
heading('Leave, WFH and arrival requests');
step(1,'Open your assigned approval screen','Check Team approvals / Review requests, or the approval screen available to you. Review pending requests regularly.');
step(2,'Review the full request','Check the employee, request type, dates and reason. For late arrival, also check the expected arrival time.');
step(3,'Choose decisions and save','Approve or reject every requested date, then save. Explain the decision to the employee if you reject a request or approve only some dates.');
heading('Expense review responsibilities');
table(['Approver','Action'],[['Hardik','Check the purpose, amount and receipts. Verify eligible claims, then forward the selected verified claims to Tarun.'],['Tarun','Review forwarded claims. Record final approval or rejection.'],['Authorised payment recorder','Record payment only after it is made. Enter the payment reference.']],{0:{cellWidth:46},1:{cellWidth:126}});
note('BEFORE YOU FINISH','Check that the decision was saved. Verification alone does not forward an expense. Manager access does not automatically include every approval permission.');
text('For your own attendance, requests and expenses, follow the same staff process wherever those options are available to your account.',10.5);check();

page('08 / Quick reference','Rules, deadlines and help','Keep this page handy for day-to-day use.');
table(['Item','Rule'],[['Attendance','Record it daily. Report missing or incorrect entries promptly.'],['Leave / WFH dates','Use today or future dates. Past start dates are blocked.'],['Late / half-day arrival','Submit by 8:00 AM IST on the requested day. Approval is required.'],['Expense attachments','PDF, JPG or PNG; up to 5 files, maximum 5 MB each.'],['Rejected expense claim','Use Edit & Reapply by the 5th of the month following the claim settlement month.'],['Expense payment','Approved claims become payable from the following month\'s 7th. Check Paid status.']],{0:{cellWidth:53},1:{cellWidth:119}});
heading('Who should you contact?');
text('Login, account access or missing WFH option: your manager/admin.\nAttendance or pending request: your reporting manager or assigned approver.\nRejected or unpaid expense: the finance reviewer. Share the claim details.',11);
note('SEND USEFUL DETAILS WHEN ASKING FOR HELP','Share your name, the date, the request or claim details, and the error message or screenshot. Keep your password private.');
text('WhatsApp or a call can communicate an urgent issue. Also keep the request and approval recorded in SimKit wherever the app allows it.',10.5);
text('App rules checked against the project implementation on 23 October 2026. Salary, deductions and exceptional arrangements follow company policy. A request approval alone does not confirm a payroll adjustment.',9.5,false,C.muted);check();

for(let i=1;i<=pages.length;i++){pdf.setPage(i);pdf.setDrawColor(C.line);pdf.line(19,281,191,281);pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(C.muted);pdf.text('SIMKIT OPS  |  Internal staff guide  |  Version 1.1',19,287);pdf.text(`${i} / ${pages.length}`,191,287,{align:'right'});}
pdf.setProperties({title:'SimKit Ops | Staff User Guide',subject:'Attendance, leave, WFH, late requests and expenses',author:'SimKit Ops',creator:'SimKit Ops'});
pdf.save(path.join(dir,'SimKit-Ops-Staff-User-Guide.pdf'));
writeFileSync(path.join(dir,'guide-pages.json'),JSON.stringify(pages,null,2));
console.log(`Created professional staff guide: ${pages.length} pages.`);
