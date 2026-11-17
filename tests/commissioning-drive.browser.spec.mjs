import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('updated local application opens the normal sign-in screen',async({page})=>{
  await page.goto('/auth');
  await expect(page.getByRole('button',{name:'Sign In',exact:true})).toBeVisible({timeout:15000});
});
test('Drive UI displays missing configuration and media results without invoking approval',async({page})=>{
  const requests=[];const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const {browserHash}=JSON.parse(await readFile('node_modules/.vite/simkit-ops/deps/_metadata.json','utf8'));
  await page.route('**/__commissioning-ui-test',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><title>Commissioning UI test</title></head><body><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const ReactModule=await import('/node_modules/.vite/simkit-ops/deps/react.js?v=${browserHash}');const React=ReactModule.default||ReactModule;
    const Dom=await import('/node_modules/.vite/simkit-ops/deps/react-dom_client.js?v=${browserHash}');const {createRoot}=Dom.default||Dom;
    await import('/src/styles.css');
    const {CommissioningDriveCheck}=await import('/src/components/business-consultant/CommissioningDriveCheck.tsx');
    const root=createRoot(document.getElementById('root'));
    const props={siteId:'00000000-0000-4000-8000-000000000010',canConfigure:true,onFolderResolved:folder=>{window.__detectedFolder=folder;},onVerificationStarted:()=>{window.__verificationStarted=(window.__verificationStarted||0)+1;}};
    root.render(React.createElement(CommissioningDriveCheck,props));
    window.__enableAutomatic=()=>root.render(React.createElement(CommissioningDriveCheck,{...props,automatic:true}));
  </script></body></html>`}));
  await page.route('**/src/integrations/supabase/client.ts*',route=>route.fulfill({contentType:'application/javascript',body:`export const supabase={functions:{invoke:async(name,args)=>{const response=await fetch('/__commissioning-test-result',{method:'POST',body:JSON.stringify({name,...args})});return {data:await response.json(),error:null};}}};`}));
  await page.route('**/__commissioning-test-result',async route=>{
    const input=route.request().postDataJSON();requests.push(input);
    await route.fulfill({json:requests.length===1
      ? {status:'setup_required',messages:['Add GOOGLE_SERVICE_ACCOUNT_JSON to Supabase Edge Function Secrets.'],read_only:true}
      : requests.length===2 ? {status:'checked',messages:['At least 4 unique video clips are required; found 0.','Video duration metadata is unavailable. Retry after Drive finishes processing.','Read-only precheck complete. No status or dates were changed.'],photo_count:7,video_count:0,video_average_seconds:null,certificate_count:1,folder_url:'https://drive.google.com/drive/folders/company',read_only:true}
      : {status:'checked',messages:['Read-only precheck complete. No status or dates were changed.'],photo_count:4,video_count:4,video_average_seconds:120,certificate_count:1,
        ...(requests.length>=4?{commissioning_state:requests.length===4?'setup_required':requests.length===5?'queued':'approved',commissioning_message:'Commissioning letter verification needs setup.'}:{}),
        videos:[{name:'machine-demo.mp4',duration_seconds:120}],certificates:[{name:'Commissioning Letter.pdf'}],folder_url:'https://drive.google.com/drive/folders/company',read_only:true}});
  });
  await page.goto('/__commissioning-ui-test');
  const button=page.getByRole('button',{name:'Check Drive evidence',exact:true});
  await expect(button).toBeVisible().catch(error=>{throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}`);});expect(requests).toHaveLength(0);
  await button.click();await expect(page.getByRole('alert')).toHaveText('Drive setup incomplete. Contact your manager.');
  await expect(page.getByText(/Add GOOGLE_SERVICE_ACCOUNT_JSON/)).toHaveCount(0);
  expect(await page.evaluate(()=>window.__detectedFolder)).toBeUndefined();
  await button.click();await expect(page.getByRole('alert')).toHaveText('Upload at least four video clips.');
  const [red,green,blue]=await page.getByRole('alert').evaluate(element=>{
    const canvas=document.createElement('canvas');canvas.width=1;canvas.height=1;
    const context=canvas.getContext('2d');context.fillStyle=getComputedStyle(element).color;context.fillRect(0,0,1,1);
    return Array.from(context.getImageData(0,0,1,1).data).slice(0,3);
  });
  expect(red).toBeGreaterThan(green*2);expect(red).toBeGreaterThan(blue*2);
  await expect(page.getByText(/Video duration metadata is unavailable|Read-only precheck complete/)).toHaveCount(0);
  await page.screenshot({path:'.tmp/commissioning-ui-browser/short-video-error.png',fullPage:true});
  await button.click();await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Photos: 4 · Videos: 4 · Letters: 1')).toBeVisible();
  await expect(page.getByText('Average video: 120.0 seconds')).toBeVisible();
  await expect(page.getByText('Media checked. Letter approval still required.')).toBeVisible();
  expect(await page.evaluate(()=>window.__detectedFolder)).toBe('https://drive.google.com/drive/folders/company');
  expect(await page.evaluate(()=>window.__verificationStarted)).toBeUndefined();
  expect(requests.map(request=>request.name)).toEqual(['commissioning-drive-check','commissioning-drive-check','commissioning-drive-check']);
  await page.evaluate(()=>window.__enableAutomatic());
  const automatic=page.getByRole('button',{name:'Verify and commission',exact:true});
  await automatic.click();await expect(page.getByRole('alert')).toHaveText('Letter verification needs setup. Contact manager.');
  expect(await page.evaluate(()=>window.__verificationStarted)).toBeUndefined();
  await automatic.click();await expect(page.getByText('Verifying commissioning evidence. Please wait.')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__verificationStarted)).toBe(1);
  await automatic.click();await expect(page.getByText('Commissioned successfully.',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__verificationStarted)).toBe(2);
  expect(requests.slice(3).every(request=>request.body.action==='commission')).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({path:'.tmp/commissioning-ui-browser/evidence-check.png',fullPage:true});
});
