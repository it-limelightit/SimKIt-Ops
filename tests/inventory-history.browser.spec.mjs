import {test,expect} from '@playwright/test';
process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY='1';
async function fixture(page,{empty=false,fail=false}={}){
 const user={id:'00000000-0000-4000-8000-000000000001',email:'manager@example.test',role:'authenticated',aud:'authenticated',email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email'},user_metadata:{}};
 const token=[Buffer.from('{"alg":"HS256"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated',aud:'authenticated'})).toString('base64url'),'signature'].join('.');
 await page.addInitScript(({user,token})=>{sessionStorage.setItem('sb-finance-test-auth-token',JSON.stringify({access_token:token,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));localStorage.setItem('themeMode','light');if('Notification' in window)Object.defineProperty(Notification,'permission',{get:()=> 'denied'});},{user,token});
 const sensor={id:'sensor-1',category:'CT Sensor',model:'',unit:'Nos',quantity:3,stock_before:50,stock_after:47,current_stock:41,item_key:'ct'};
 const wire={id:'wire-1',category:'2 Core Wire',model:'',unit:'Meter',quantity:12,stock_before:200,stock_after:188,current_stock:176,item_key:'wire'};
 const orders=[{issue_id:'issue-2',reference:'ISS-000002',company_name:'XYZ Factory',order_id:'00000000-0000-4000-8000-000000000102',issued_at:'2026-10-23T08:30:00Z',actor_name:'Inventory Manager',device_id:'DM-102',order_source:'simkit',order_created_at:'2026-10-21T10:00:00Z',status_at_issue:'packing',logistics_status:'Transit',order_exists:true,total_item_types:1,items:[{...sensor,id:'sensor-2',stock_before:47,quantity:6,stock_after:41}]},
 {issue_id:'issue-1',reference:'ISS-000001',company_name:'ABC Factory',order_id:'00000000-0000-4000-8000-000000000101',issued_at:'2026-10-23T06:00:00Z',actor_name:'Inventory Manager',device_id:'DM-101',order_source:'simkit',order_created_at:'2026-10-21T10:00:00Z',status_at_issue:'packing',logistics_status:'Packing',order_exists:true,total_item_types:2,items:[sensor,wire]}];
 const calls=[],errors=[];let shouldFail=fail;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(/^https:\/\/fonts\./,r=>r.abort());
 await page.route('**/*.supabase.co/**',async route=>{
  const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop();let data=[];
  if(url.pathname==='/auth/v1/user')data=user;
  else if(name==='profiles')data={name:'Manager',is_active:true};
  else if(name==='user_roles')data=[{role:'supervisor'}];
  else if(name==='inventory_history'){
   const args=req.postDataJSON();calls.push(args);
   if(shouldFail){shouldFail=false;await route.fulfill({status:500,json:{code:'XX000',message:'History temporarily unavailable'}});return;}
   let filtered=empty?[]:orders.filter(o=>!args._company||o.company_name===args._company).map(o=>({...o,items:o.items.filter(i=>!args._item||i.item_key===args._item)})).filter(o=>o.items.length);
   if(args._search)filtered=filtered.filter(o=>(o.reference+' '+o.company_name).toLowerCase().includes(args._search.toLowerCase()));
   const rows=filtered.flatMap(o=>o.items.map(i=>({...o,...i})));
   data={activated_at:'2026-10-23T04:30:00Z',refreshed_at:'2026-10-23T09:00:00Z',total_records:args._view==='item'?rows.length:filtered.length,issue_count:filtered.length,company_count:filtered.length,item_type_count:new Set(rows.map(i=>i.item_key)).size,companies:empty?[]:['ABC Factory','XYZ Factory'],products:empty?[]:[{key:'ct',category:'CT Sensor',model:'',unit:'Nos'},{key:'wire',category:'2 Core Wire',model:'',unit:'Meter'}],issues:args._view==='company'?filtered:[],item_rows:args._view==='item'?rows:[]};
  }
  await route.fulfill({status:200,json:data});
 });
 await page.goto('/manager/inventory');await page.getByRole('button',{name:'Inventory History',exact:true}).click();
 return {calls,errors};
}

test('company expansion, historical/current stock, order identity and item filtering work together',async({page})=>{
 const {calls,errors}=await fixture(page);
 await expect(page.getByRole('heading',{name:'Inventory History',exact:true})).toBeVisible();
 await expect(page.getByText('Recording from', {exact:false})).toBeVisible();
 const table=page.getByRole('table',{name:'Company stock issues',exact:true});
 await expect(table).toBeVisible();
 await page.getByRole('button',{name:'Expand items for ABC Factory',exact:true}).click();
 const details=page.getByRole('table',{name:'Items issued to ABC Factory',exact:true});
 const ct=details.getByRole('row').filter({hasText:'CT Sensor'});await expect(ct).toContainText('50 Nos');await expect(ct).toContainText('47 Nos');await expect(ct).toContainText('41 Nos');
 await page.getByRole('button',{name:'Order details for ISS-000001',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('00000000-0000-4000-8000-000000000101');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
 await page.screenshot({path:'.tmp/inventory-history-browser/company-history.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Item-wise',exact:true}).click();await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByLabel('Item / Model',{exact:true}).selectOption('ct');
 const movements=page.getByRole('table',{name:'Item stock movements',exact:true});
 await expect.poll(()=>calls.at(-1)?._item).toBe('ct');await expect(movements.getByRole('row')).toHaveCount(3);
 await expect(movements.getByText('2 Core Wire')).toHaveCount(0);
 await page.getByLabel('Company',{exact:true}).selectOption('ABC Factory');await expect(movements.getByRole('row')).toHaveCount(2);
 await page.screenshot({path:'.tmp/inventory-history-browser/item-history.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Clear filters'}).click();await expect(movements.getByRole('row')).toHaveCount(4);
 expect(errors).toEqual([]);
});

test('mobile keeps tables scrollable inside the panel and rows expand by keyboard',async({page})=>{
 await page.setViewportSize({width:390,height:844});const {errors}=await fixture(page);
 const expand=page.getByRole('button',{name:'Expand items for ABC Factory',exact:true});await expand.focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Collapse items for ABC Factory',exact:true})).toHaveAttribute('aria-expanded','true');
 const details=page.getByRole('table',{name:'Items issued to ABC Factory',exact:true});await expect(details).toBeVisible();
 await expect(details).toContainText('Before issue');await expect(details).toContainText('Current stock');
 const region=page.getByRole('region',{name:'Company stock issues',exact:true});expect(await region.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 await region.evaluate(el=>{el.scrollLeft=el.scrollWidth;});await expect(details.getByRole('columnheader',{name:'Current stock'})).toBeInViewport();
 await region.evaluate(el=>{el.scrollLeft=0;});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'.tmp/inventory-history-browser/mobile-history.png',fullPage:true,animations:'disabled'});expect(errors).toEqual([]);
});

test('empty prospective history explains the start point; failures have a working retry',async({page})=>{
 await fixture(page,{empty:true,fail:true});await expect(page.getByRole('alert')).toContainText('History temporarily unavailable');
 await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByRole('heading',{name:'No stock issues recorded yet'})).toBeVisible();
 await expect(page.getByText('Earlier completed issues will stay outside this history.',{exact:false})).toBeVisible();
});
