import {chromium,expect} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(process.env.CUSTODY_FIXTURE || '/tmp/custody-browser-fixture.json','utf8'));
const base='https://doco-mirror.lab.xoloitzcuintles.com';const out=process.env.CUSTODY_OUTPUT || '/tmp/cash-custody-e2e';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const login=await context.request.post(base+'/api/method/login',{form:{usr:fixture.users[2],pwd:fixture.password}});expect(login.ok()).toBeTruthy();
 await page.goto(base+'/app/pos-cash-bag/'+fixture.available_bag,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Send to bank',exact:true}).click({timeout:30000});
 let dialog=page.locator('.modal:visible');
 await dialog.locator('textarea[data-fieldname="note"]').fill('Courier received the sealed bag for deposit');
 await dialog.getByRole('button',{name:'Send to bank',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm bank receipt',exact:true})).toBeVisible({timeout:15000});
 await page.screenshot({path:out+'/manager-in-transit.png',fullPage:true});
 await page.getByRole('button',{name:'Confirm bank receipt',exact:true}).click();
 dialog=page.locator('.modal:visible');
 await dialog.locator('input[data-fieldname="reference"]').fill('LAB-BANK-'+Date.now());

 await dialog.getByRole('button',{name:'Confirm deposit',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm bank receipt',exact:true})).toHaveCount(0,{timeout:15000});
 const html=await page.evaluate(async bag=>(await window.frappe.call({method:'posawesome.posawesome.api.cash_custody.printing.evidence',args:{doctype:'POS Cash Bag',name:bag}})).message,fixture.available_bag);
 expect(html).toContain('Deposited at the bank');expect(html).toContain('LAB-BANK-');
 await writeFile(out+'/bag-handover.html',html);
 const label=await page.evaluate(async bag=>(await window.frappe.call({method:'posawesome.posawesome.api.cash_custody.printing.evidence',args:{doctype:'POS Cash Bag',name:bag,layout:'label'}})).message,fixture.available_bag);
 await writeFile(out+'/bag-label.html',label);
 const printPage=await context.newPage();
 await printPage.setContent(label);
 const pdf=await printPage.pdf({path:out+'/bag-label.pdf',preferCSSPageSize:true,printBackground:true});
 const pages=(pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length;
 expect(pages,'One physical bag label').toBe(1);
 await printPage.close();
 await page.screenshot({path:out+'/manager-bank-confirmed.png',fullPage:true});
 console.log(JSON.stringify({journey:'Desk bag → dispatch → bank receipt → printable evidence',errors}));
}catch(error){await page.screenshot({path:out+'/manager-failed.png',fullPage:true});await writeFile(out+'/manager-failed.txt',await page.locator('body').innerText());throw error;}
finally{await browser.close();}
