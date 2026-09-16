// Real lab server and isolated test accounts. No mocked business endpoints.
import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.CUSTODY_FIXTURE || '/tmp/custody-browser-fixture.json','utf8'));
const base='https://doco-mirror.lab.xoloitzcuintles.com';
const output=process.env.CUSTODY_OUTPUT || '/tmp/cash-custody-e2e';await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
const errors=[];const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
try {
 const login=await context.request.post(base+'/api/method/login',{form:{usr:fixture.users[1],pwd:fixture.password}});
 expect(login.ok()).toBeTruthy();
 await context.addInitScript(t=>{localStorage.setItem('posa_device_identifier',t.terminal_id);localStorage.setItem('posa_terminal_secret',t.terminal_token);},fixture.terminal);
 await page.goto(base+'/posapp/cash-custody',{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(9000);
 for(const name of [/set up later/i,/dismiss/i]) {const b=page.getByRole('button',{name}).first();if(await b.isVisible())await b.click();}
 await expect(page.getByTestId('cash-custody')).toBeVisible();
 const resume=process.env.CUSTODY_RESUME==='1';
 let seal='QA-BROWSER-'+Date.now();
 if(!resume){
 await expect(page.getByTestId('drawer-guidance-suggested')).toContainText('200');
 await page.getByTestId('drawer-guidance-return').click();
 const form=page.getByTestId('cash-custody').locator('form');
 seal='QA-BROWSER-'+Date.now();
 await form.getByLabel('Bag seal / ID').fill(seal);
 await form.getByTestId('cash-count-override-toggle').click();
 await form.getByLabel('Counted amount',{exact:true}).fill('90');
 await form.getByLabel('Why was the total overridden?').fill('Real browser QA physical count');
 // Reload before sending: the unfinished handover must survive without moving money.
 await page.reload({waitUntil:'domcontentloaded'});
 await expect(form).toBeVisible({timeout:20000});
 await expect(form.getByLabel('Bag seal / ID')).toHaveValue(seal);
 await expect(form.getByLabel('Counted amount',{exact:true})).toHaveValue('90');
 await expect(form.getByLabel('Why was the total overridden?')).toHaveValue('Real browser QA physical count');
 let lost=false;
 await page.route('**/api/method/posawesome.posawesome.api.cash_custody.service.command',async route=>{
  if(!lost){lost=true;const response=await route.fetch();expect(response.ok()).toBeTruthy();await route.abort('failed');}
  else await route.continue();
 });
 const primary=page.getByTestId('band-primary').filter({visible:true});
 await expect(primary).toContainText(/Return|safe/i);
 await primary.click();
 await expect(primary).toContainText('Retry unconfirmed action',{timeout:15000});
 await primary.click();
 await expect(page.getByRole('button',{name:/Retry unconfirmed action/})).toHaveCount(0);
 await expect(page.getByRole('button').filter({hasText:seal})).toHaveCount(1);
 await expect(page.getByTestId('drawer-guidance-ok')).toBeVisible();
 await page.screenshot({path:output+'/cashier-recovered-drop.png',fullPage:true});
 }
 await page.locator('[data-rail-destination="closing"]').click();
 const closing=page.getByTestId('cash-closing-allocation');
 await expect(closing).toBeVisible({timeout:20000});
 if(resume) await expect(closing.getByTestId('cash-closing-saved')).toBeVisible({timeout:20000});
 if(!await closing.getByLabel('Counted amount',{exact:true}).first().isVisible())
  await closing.getByTestId('cash-count-override-toggle').first().click();
 await closing.getByLabel('Counted amount',{exact:true}).first().fill('910');
 await closing.getByLabel('Why was the total overridden?').first().fill('Real browser QA closing cash count');
 await closing.getByRole('button',{name:'Save drawer count'}).click();
 await expect(closing.getByRole('button',{name:'Save drawer count',exact:true})).toBeEnabled();
 await expect(closing.getByTestId('cash-closing-saved')).toBeVisible();
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-rail-destination="closing"]').click();
 await expect(closing.getByTestId('cash-closing-saved')).toBeVisible({timeout:20000});
 await expect(closing.getByTestId('cash-closing-conflict')).toHaveCount(0);
 // Another save of this cashier's draft must be reviewed, not silently overwritten.
 await page.evaluate(async fixture=>{
  const method='posawesome.posawesome.api.cash_custody.service.';
  const state=(await window.frappe.call({method:method+'context',args:{pos_profile:fixture.profile}})).message;
  const draft=state.counts.find(row=>row.scope==='Drawer' && row.opening_shift===fixture.opening && row.state==='Draft');
  if(!draft)throw Error('QA drawer draft missing');
  await window.frappe.call({method:method+'command',args:{action:'save_drawer',payload:{
   pos_profile:fixture.profile,opening_shift:fixture.opening,...fixture.terminal,
   request_id:crypto.randomUUID(),cash_count:draft.name,modified:draft.modified,
   count:{source:'manual',amount:920,reason:'QA concurrent count for explicit conflict recovery'},
  }}});
 },fixture);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-rail-destination="closing"]').click();
 await expect(closing.getByTestId('cash-closing-conflict')).toBeVisible({timeout:20000});
 await expect(closing.getByLabel('Counted amount',{exact:true}).first()).toHaveValue('910');
 await closing.getByTestId('cash-closing-keep-local').click();
 await closing.getByRole('button',{name:'Save drawer count'}).click();
 await expect(closing.getByRole('button',{name:'Save drawer count',exact:true})).toBeEnabled();
 await expect(closing.getByTestId('cash-closing-conflict')).toHaveCount(0);
 await closing.getByLabel('Bag seal / ID').fill(seal+'-CLOSE');
 await expect(closing.getByText('Count saved and bags allocated. Complete the payment reconciliation and close the shift.')).toBeVisible();
 await page.locator('.closing-body').evaluate(element=>{element.scrollTop=0;});
 await page.screenshot({path:output+'/closing-count.png',fullPage:true});
 const submit=page.getByTestId('destination-closing').getByTestId('band-primary');
 await expect(submit).toBeEnabled({timeout:10000});
 await submit.click();
 await page.waitForTimeout(5000);
 const saved=await page.evaluate(async profile=>(await window.frappe.call({method:'posawesome.posawesome.api.cash_custody.service.context',args:{pos_profile:profile}})).message,fixture.profile);
 const evidence=saved.counts.find(row=>row.scope==='Drawer' && row.opening_shift===fixture.opening);
 expect(evidence.state).toBe('Final');expect(evidence.amount).toBe(910);expect(evidence.difference).toBe(0);expect(evidence.closing_shift).toBeTruthy();
 await page.screenshot({path:output+'/closed.png',fullPage:true});
 await writeFile(output+'/final.txt',(await page.locator('body').innerText()).slice(-15000));
 console.log(JSON.stringify({url:page.url(),seal,errors}));
} catch(error){
 await page.screenshot({path:output+'/cashier-failure.png',fullPage:true});
 await writeFile(output+'/cashier-failure.txt',await page.locator('body').innerText());
 throw error;
} finally{await browser.close();}
