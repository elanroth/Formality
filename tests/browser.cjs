/* Optional local browser smoke test. npm install playwright, or set
   PROOF_TREE_PLAYWRIGHT to the installed Playwright package directory. */
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PROOF_TREE_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PROOF_TREE_CHROME?{executablePath:process.env.PROOF_TREE_CHROME}:{})});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const initial=JSON.parse(await fs.readFile(path.join(root,'runs/cantor-expanded.json'),'utf8'));
    await page.goto((process.argv[2]||'http://127.0.0.1:8765')+'/?run='+initial.provenance.runId);
    await page.locator('#title').filter({hasText:'Diagonal.cantor'}).waitFor();
    await page.screenshot({path:path.join(root,'runs/app-cantor.png'),fullPage:true});
    const response=async action=>{const pending=page.waitForResponse(r=>r.url().endsWith('/api/extract'),{timeout:180000});await action();const r=await pending;const data=await r.json();if(!r.ok())throw Error(data.error);return data;};
    await page.selectOption('#examples','soundness');
    const sound=await response(()=>page.click('#generate'));
    assert.equal(sound.declaration,'Propositional.soundness');assert.equal(sound.kernelChecked,true);
    await page.locator('#title').filter({hasText:'Propositional.soundness'}).waitFor();
    let download=page.waitForEvent('download');await page.click('#export-svg');let file=await download;
    const svgPath=path.join(root,'runs/browser-soundness.svg');await file.saveAs(svgPath);
    assert.ok((await fs.readFile(svgPath,'utf8')).includes('Propositional.soundness'));
    download=page.waitForEvent('download');await page.click('#export-png');file=await download;await file.saveAs(path.join(root,'runs/browser-soundness.png'));
    await page.selectOption('#examples','induction');await page.selectOption('#mode','compact');await page.fill('#numeral','20');await page.check('#normalize');
    const induction=await response(()=>page.click('#generate'));
    assert.deepEqual(induction.specialized,['n']);assert.equal(induction.kernelChecked,true);
    assert.ok(!induction.nodes.some(n=>n.rule==='recursor'));
    await page.locator('#title').filter({hasText:'Induction.iterate'}).waitFor();
    await page.screenshot({path:path.join(root,'runs/app-induction.png'),fullPage:true});
    await page.fill('#source','theorem invalid : False := by exact True.intro');await page.fill('#declaration','invalid');await page.fill('#numeral','');
    const badPending=page.waitForResponse(r=>r.url().endsWith('/api/extract'));await page.click('#generate');const bad=await badPending;assert.equal(bad.status(),400);
    await page.locator('#error').waitFor();assert.equal(await page.locator('#title').textContent(),'Induction.iterate');
    for(const width of [320,736,1440]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Overflow at '+width);}
    assert.deepEqual(errors,[]);
    const blocked=await page.request.post(new URL('/api/extract',page.url()).href,{data:{declaration:'Nat.zero_add'}});assert.equal(blocked.status(),403);
    console.log('Browser passed: source generation, imported saved tree, induction unfolding, SVG/PNG downloads, error preservation, responsive layouts, local POST protection.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
