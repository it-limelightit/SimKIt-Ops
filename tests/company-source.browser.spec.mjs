import {test,expect} from '@playwright/test';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
const worker='00000000-0000-4000-8000-000000000002';
const district='00000000-0000-4000-8000-000000000030';
const locality='00000000-0000-4000-8000-000000000031';
function site(id,name,source,status='Submitted'){
 return {id,name,company_name:name,...(source?{company_source:source}:{}),city:'Ahmedabad',district_id:district,locality_id:locality,address:'Factory Road',assigned_worker_id:worker,assigned_at:'2026-10-01T10:00:00Z',created_at:'2026-10-01T10:00:00Z',consultant_stage:status==='Submitted'?'Completion':null,task_notes:`[METADATA:${JSON.stringify({status,worker_ids:[worker]})}]`};
}
async function mock(page){
 const user={id:'00000000-0000-4000-8000-000000000001',email:'manager@example.test',role:'authenticated',aud:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}};
 const token=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'})).toString('base64url'),'signature'].join('.');
 await page.addInitScript(({user,token})=>{sessionStorage.setItem('sb-finance-test-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));localStorage.setItem('themeMode','light');},{user,token});
 const sites=[site('npc-1','NPC One','npc'),site('npc-2','NPC Two','npc','Not Started Yet'),site('legacy-1','Legacy NPC',undefined),site('lead-1','Sales Lead One','lead'),site('lead-2','Sales Lead Two','lead','Not Started Yet')];
 const writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https:\/\/fonts\./,r=>r.abort());
 await page.route('**/*.supabase.co/**',async route=>{
  const request=route.request(),url=new URL(request.url()),name=url.pathname.split('/').pop();let data=[];
  if(url.pathname==='/auth/v1/user')data=user;
  else if(name==='user_roles')data=url.searchParams.has('role')?[{user_id:worker,role:'worker'}]:[{user_id:user.id,role:'supervisor'}];
  else if(name==='profiles')data=url.searchParams.has('id')?{name:'Manager',is_active:true}:[{id:worker,name:'Associate',is_active:true}];
  else if(name==='site_districts')data=[{id:district,name:'Ahmedabad'}];
  else if(name==='site_localities')data=[{id:locality,district_id:district,name:'Ahmedabad'}];
  else if(name==='sites'){
   if(request.method()==='POST'){const input=request.postDataJSON();writes.push(input);data={id:'created-lead'};sites.push({...input,id:'created-lead',created_at:'2026-10-23T10:00:00Z'});}
   else if(request.method()==='PATCH'){const input=request.postDataJSON();writes.push(input);data=null;}
   else if(url.searchParams.has('name')||url.searchParams.has('company_name'))data=[];
   else data=sites;
  }else if(name==='field_ops_board')data={today:'2026-10-23',users:[],attendance:[],rates:[],earnings:[],visits:[],payments:[],sites:[],date_changes:[]};
  else if(name==='attendance_my_wfh_eligibility')data=false;
  else if(name==='activity_logs'&&request.method()==='POST')data=null;
  await route.fulfill({status:200,json:data});
 });
 return {writes,errors};
}

test('overview separates counts, submitted lists and exports and clears filters when switching source',async({page})=>{
 test.setTimeout(90000);
 const {errors}=await mock(page);await page.goto('/manager');
 const source=page.getByRole('group',{name:'Choose company source'});
 await expect(source.getByRole('button',{name:'NPC',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByText('Showing 3 of 3 NPC records.')).toBeVisible();
 await expect(page.getByRole('cell',{name:'Sales Lead One',exact:false})).toHaveCount(0);
 await page.locator('button.overview-kpi-card').filter({has:page.getByText('Submitted',{exact:true})}).click();
 await expect(page.getByText('Showing 2 of 3 NPC records.')).toBeVisible();
 await source.getByRole('button',{name:'Lead',exact:true}).click();
 await expect(page.getByText('Showing 2 of 2 Lead records.')).toBeVisible();
 await expect(page.getByRole('cell',{name:'NPC One',exact:false})).toHaveCount(0);
 await page.locator('button.overview-kpi-card').filter({has:page.getByText('Submitted',{exact:true})}).click();
 await expect(page.getByText('Showing 1 of 2 Lead records.')).toBeVisible();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Excel',exact:true}).click();
 const download=await downloaded;expect(download.suggestedFilename()).toMatch(/^lead-/);
 const {Workbook}=await import('exceljs').then(m=>m.default??m);const workbook=new Workbook();await workbook.xlsx.readFile(await download.path());
 const values=JSON.stringify(workbook.getWorksheet('Detailed Report').getSheetValues());
 expect(values).toContain('Sales Lead One');expect(values).not.toContain('NPC One');expect(values).not.toContain('Sales Lead Two');
 await page.screenshot({path:'.tmp/company-source-browser/lead-overview.png',fullPage:true,animations:'disabled'});
 await source.getByRole('button',{name:'NPC',exact:true}).click();
 await expect(page.getByText('Showing 3 of 3 NPC records.')).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await expect(source.getByRole('button',{name:'NPC',exact:true})).toBeVisible();
 await source.getByRole('button',{name:'Lead',exact:true}).click();
 await expect(page.getByText('Showing 2 of 2 Lead records.')).toBeVisible();
 expect(errors).toEqual([]);
});

test('Add Site saves a lead source and shows NPC assessor fields only for NPC',async({page})=>{
 const {writes,errors}=await mock(page);await page.goto('/manager/sites');
 await page.getByRole('button',{name:'New Site',exact:true}).click();
 const form=page.locator('div.scroll-mt-6').filter({has:page.getByRole('heading',{name:'New Site Details'})});
 await expect(form.getByLabel('Company source *')).toHaveValue('npc');
 await expect(form.getByRole('heading',{name:'NPC Assessor'})).toBeVisible();
 await form.getByLabel('Company source *').selectOption('lead');
 await expect(form.getByRole('heading',{name:'NPC Assessor'})).toHaveCount(0);
 await expect(form.getByRole('button',{name:'Upload .eml'})).toHaveCount(0);
 await form.locator('input:not([type=file])').first().fill('New Sales Factory');
 await form.getByPlaceholder('Company that owns this factory').fill('New Sales Company');
 const selects=form.locator('select');
 await selects.nth(1).selectOption(district);await selects.nth(2).selectOption(locality);
 await page.screenshot({path:'.tmp/company-source-browser/add-lead.png',fullPage:true});
 await form.getByRole('button',{name:'Create Site',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0].company_source).toBe('lead');
 expect(writes[0].company_name).toBe('New Sales Company');
 await expect(form).toHaveCount(0);
 await page.getByRole('button',{name:'New Site',exact:true}).click();
 await expect(page.getByLabel('Company source *')).toHaveValue('npc');
 await page.getByRole('button',{name:'Close site form'}).click();
 await page.getByRole('row').filter({hasText:'Sales Lead One'}).getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.getByLabel('Company source *')).toHaveValue('lead');
 await page.getByRole('button',{name:'Save Details',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1].company_source).toBe('lead');
 expect(errors).toEqual([]);
});
