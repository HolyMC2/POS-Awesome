import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
const server = await createServer({ server: { host:'127.0.0.1',port:0 }, logLevel:'error' });
let browser;
try {
 await server.listen();
 browser = await chromium.launch();
 const page = await browser.newPage({ viewport: { width:1724,height:1025 } });
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/assets/posawesome/dist/js/tests/visual/fixtures/tender.html`);
 const presets = page.getByTestId('cobro-presets');
 await expect(presets).toBeVisible();
 for (const size of [{width:1724,height:1025},{width:1195,height:741}]) {
  await page.setViewportSize(size);
  const boxes = await presets.locator('button').evaluateAll(elements => elements.map(e => ({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height})));
  expect(boxes.length).toBeGreaterThan(1);
  for (const box of boxes) { expect(box.width).toBeGreaterThanOrEqual(64); expect(box.height).toBeGreaterThanOrEqual(48); }
  await expect(page.getByTestId('band-primary')).toBeInViewport();
  const bandBox = await page.getByTestId('action-band').boundingBox();
  const presetBox = await presets.boundingBox();
  expect(presetBox.y).toBeGreaterThanOrEqual(bandBox.y);
  expect(presetBox.y + presetBox.height).toBeLessThanOrEqual(bandBox.y + bandBox.height);
  await page.getByTestId('cobro-preset-500').click();
  await expect(page.getByTestId('band-value')).toContainText('350');
  await page.screenshot({path:`/tmp/pos-closing-review/touch-tender-${size.width}.png`});
 }
 console.log('PASS: 48×64 minimum targets, preset selection, visible charge action at desktop and laptop sizes.');
} finally { await browser?.close(); await server.close(); }
