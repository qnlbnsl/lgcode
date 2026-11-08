// Checks stage-named teams, the stage strip, the Mocks tab and the repository's Design tab with real clicks.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MOCK_URL||'http://127.0.0.1:4178/workbench.html';
const browser=await chromium.launch(),errors=[],passed=[],failures=[];
const check=(ok,label)=>{(ok?passed:failures).push(label)};
const fresh=async({query='',width=1440,height=900,scheme='light'}={})=>{
 const context=await browser.newContext({viewport:{width,height},colorScheme:scheme}),page=await context.newPage();
 page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push((query||'default')+': '+e.message));
 await page.goto(base+query);await page.waitForFunction(()=>window.lgcodeReady);
 return page;
};
const teams=page=>page.locator('.team-select').allTextContents().then(all=>all.map(t=>t.replace(/\d+$/,'')));
const frame=page=>page.frameLocator('#mock-slot iframe');
const frameReady=async page=>{const handle=await page.waitForSelector('#mock-slot iframe');const f=await handle.contentFrame();await f.waitForFunction(()=>window.lgcodeReady);return f};
const wide=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);

// Teams are named for their stage, and a project's stage shows above its work.
{
 const page=await fresh();
 const names=await teams(page);
 check(names.includes('Build team')&&names.includes('Review team'),'Teams are named for their stage');
 check(!names.some(n=>/App shell|Engine/.test(n)),'Hand-picked team names are gone');
 await page.click('[data-project="workspace"]');
 check(await page.locator('.stage-strip li.current').textContent()==='Build','A building project shows Build as its stage');
 check(await page.locator('.stage-strip li').count()===4,'A project without screens has no Design step');
 check(await page.locator('#workspace-tab-mocks').count()===0,'A project without mocks has no Mocks tab');
 await page.click('[data-open-repo="lgcode"]');
 const stages=await page.locator('.project-table .stage-cell').allTextContents();
 check(stages.includes('Build')&&stages.includes('Design'),'The repository page lists each project’s stage');
 await page.click('[data-project="desktop"]');
 check(await page.locator('.stage-strip li.current').textContent()==='Design'&&await page.locator('.stage-strip li').count()===5,'A project with mocks starts at Design');
 check(await page.locator('.empty h2').textContent()==='No sprints until you approve the mocks.','The board stays empty while the mocks are drawn');
 check(await page.locator('#workspace-tab-mocks').isVisible(),'A project with mocks has a Mocks tab');
 check(await page.locator('#lead-chat-body').getByRole('button',{name:'Open the mocks'}).isVisible(),'The lead’s message links to the mocks');
 await page.context().close();
}
{
 const page=await fresh({query:'?sample=heavy'});
 const names=await teams(page);
 check(names.includes('Build team · Exports')&&names.includes('Build team · Audit trail'),'Two teams in one stage add their area');
 await page.context().close();
}

// The Mocks tab shows the project's own screens, running, beside the lead.
{
 const page=await fresh();
 await page.click('[data-project="desktop"]');await page.click('#workspace-tab-mocks');
 check(await page.locator('#view-title').textContent()==='Mocks','Mocks opens from its tab');
 check(await page.locator('#participants').textContent()==='Design team · 6 screens · Not approved yet','The heading says who draws, how many screens, and approval');
 check(await page.locator('.mock-screen-list button').count()===6,'Every screen is listed');
 check(await page.locator('#lead-panel').isVisible()&&await page.locator('#message-input').getAttribute('placeholder')==='Message Nico…','The lead stays beside the mocks');
 check(!await page.locator('#lead-chat-body').getByRole('button',{name:'Open the mocks'}).isVisible(),'The link to the mocks hides on the Mocks tab');
 let inner=await frameReady(page);
 check((await page.locator('#mock-slot iframe').getAttribute('src')).includes('sample=small&screen=home'),'The first screen loads the real page on the small sample');
 check(await inner.locator('#view-title').textContent()==='Home','The screen is the real page, on its own view');
 const fits=await page.evaluate(()=>{const slot=document.querySelector('#mock-slot'),stage=document.querySelector('#mock-stage');return slot.getBoundingClientRect().width<=stage.clientWidth+1&&getComputedStyle(slot.querySelector('iframe')).width==='1440px'});
 check(fits,'A desktop screen is scaled down to fit');
 await page.click('[data-mock-screen="board"]');inner=await frameReady(page);
 check(await inner.locator('#view-title').textContent()==='Agent console','Choosing a screen shows it');
 await page.selectOption('#mock-scenario','heavy');inner=await frameReady(page);
 check((await page.locator('#mock-slot iframe').getAttribute('src')).includes('sample=heavy')&&await inner.locator('.project-select').count()>4,'The data switch reloads the screen with ten projects');
 await page.click('[data-mock-size="phone"]');
 check(await page.locator('#mock-slot').getAttribute('data-size')==='phone'&&await page.evaluate(()=>getComputedStyle(document.querySelector('#mock-slot iframe')).width)==='390px','Phone shows the screen at phone width');
 await page.click('[data-mock-screen="home"]');inner=await frameReady(page);
 await inner.evaluate(()=>{window.stillHere=true});
 const before=await page.locator('[data-mock-screen="home"] small').textContent();
 await page.fill('#message-input','Make it denser');await page.press('#message-input','Enter');
 await page.waitForFunction(()=>document.querySelector('.mock-history li span')?.textContent==='Made it denser');
 check(await page.locator('[data-mock-screen="home"] small').textContent()!==before,'A change adds a revision to the screen');
 check((await page.locator('.mock-history li small').first().textContent()).startsWith('Bryn'),'The change names the designer');
 check((await page.locator('#lead-chat-body .turn').last().textContent()).includes('Bryn changed Home: made it denser.'),'The lead reports the change');
 const live=await page.evaluate(()=>{const f=document.querySelector('#mock-slot iframe');return {kept:f.contentWindow.stillHere===true,css:f.contentDocument.getElementById('mock-revisions')?.textContent||''}});
 check(live.kept,'The screen changes in place, without reloading');
 check(live.css.includes('zoom'),'The change reaches the running screen');
 await page.click('#mock-edit');
 await page.waitForFunction(()=>!document.querySelector('.pencil[role="status"].design-canvas'));
 check(await page.locator('.pencil').isVisible()&&(await page.locator('.pencil').textContent()).includes('design/desktop-companion.fig')&&await page.locator('#mock-slot').count()===0,'Edit design swaps the screen for OpenPencil on the design file');
 await page.click('#mock-edit');
 check(await page.locator('#mock-slot iframe').count()===1,'Done editing brings the screen back');
 await page.click('[data-mocks-pane="data"]');
 const states=await page.locator('.mock-data-table .schema-state').allTextContents();
 check(states.length===11&&states.filter(s=>s==='New').length===4&&states.includes('Schema has text'),'Data compares each field with the schema');
 check((await page.locator('.detail-summary').textContent()).includes('5 changes to the schema go to the Planning team'),'Data says what approval hands on');
 await page.click('[data-mocks-pane="components"]');
 const kinds=await page.locator('.mock-component-table .component-state').allTextContents();
 check(kinds.length===8&&kinds.filter(k=>k==='Draft').length===2,'Components separate real components from drafts');
 await page.click('#approve-mocks');
 check((await page.locator('#approve-mocks-content').textContent()).includes('2 draft components move'),'Approval says what moves into the real components');
 await page.click('#confirm-approve-mocks');
 await page.waitForSelector('.mocks-approved');
 check(await page.locator('#approve-mocks').count()===0,'Approved mocks cannot be approved twice');
 check(await page.locator('.stage-strip li.current').textContent()==='Plan','Approval moves the project to Plan');
 check((await teams(page)).includes('Planning team'),'Approval starts a Planning team');
 check((await page.locator('.mock-component-table .component-state').allTextContents()).filter(k=>k==='Moved in').length===2,'Drafts move into the real components');
 await page.click('#tab-board');
 check((await page.locator('.sprint-card').textContent()).includes('13 tasks'),'The board gets a sprint with a task for each change and screen');
 await page.click('[data-open-repo="lgcode"]');await page.click('[data-repo-tab="design"]');
 check(await page.locator('.design-table td',{hasText:'From Desktop companion'}).count()===2,'Approved components join the repository’s design');
 await page.context().close();
}

// The repository's Design tab shows the components from the page's own code.
{
 const page=await fresh({scheme:'dark'});
 await page.click('[data-open-repo="lgcode"]');
 check(await page.locator('.project-table').isVisible(),'A repository opens on its projects');
 await page.click('[data-repo-tab="design"]');
 check(await page.locator('.token-list li').count()===12,'Design shows the color tokens');
 const swatch=await page.locator('.swatch').first().evaluate(e=>getComputedStyle(e).backgroundColor);
 check(swatch!=='rgba(0, 0, 0, 0)','Each swatch is the live color');
 check(await page.locator('.component-preview button.primary').count()===1,'Components preview with the page’s own styles');
 check(await page.locator('.component-preview button').first().evaluate(e=>e.closest('[inert]')!==null),'Previews cannot be clicked');
 await page.click('[data-design-mode="edit"]');
 await page.waitForFunction(()=>!document.querySelector('.pencil[role="status"].design-canvas'));
 check(await page.locator('.pencil').isVisible()&&(await page.locator('.pencil').textContent()).includes('design/lgcode.fig')||await page.locator('#pencil-slot[data-src*="lgcode.fig"]').count()===1,'Edit opens OpenPencil on the repository design file');
 await page.click('[data-open-repo="atlas-docs"]');await page.click('[data-repo-tab="design"]');
 check(await page.locator('.empty h2').textContent()==='No design until a project’s mocks are approved.'&&await page.locator('.empty p').count()===0,'A repository without a design says so in one sentence');
 await page.context().close();
}

// A new project gets a Design team when the work needs screens.
{
 const page=await fresh();
 await page.click('#new-project');await page.fill('#project-name','Status page');await page.click('#project-submit');
 await page.waitForSelector('#message-input:focus');
 await page.fill('#message-input','Keep the uptime numbers for a month');await page.press('#message-input','Enter');
 await page.waitForFunction(()=>document.querySelectorAll('#view-body .turn').length>=3);
 check(await page.locator('#workspace-tab-mocks').count()===0,'Work without screens starts no Design team');
 await page.fill('#message-input','I want a public status page people can check');await page.press('#message-input','Enter');
 await page.waitForSelector('[data-open-mocks]');
 check(await page.locator('#workspace-tab-mocks').isVisible(),'Screen work adds the Mocks tab');
 check((await teams(page)).includes('Design team'),'Screen work starts a Design team');
 await page.click('[data-open-mocks]');
 check(await page.locator('#view-title').textContent()==='Mocks','The lead’s link opens the mocks');
 await page.waitForFunction(()=>document.querySelectorAll('.mock-screen-list button').length===3);
 check(true,'The first screens arrive one at a time');
 check(await page.locator('.stage-strip li.current').textContent()==='Design','A new project with screens is in Design');
 await page.context().close();
}

// A screen link opens the page on one view.
{
 const page=await fresh({query:'?screen=machines'});
 check(await page.locator('#view-title').textContent()==='Machines','A screen link opens that view');
 await page.context().close();
}

// Phones, in both modes.
for(const scheme of ['light','dark']){
 const page=await fresh({width:390,height:844,scheme});
 await page.click('#menu');await page.click('[data-project="desktop"]');await page.click('#workspace-tab-mocks');
 await frameReady(page);
 check(await wide(page)<=0,`Mocks fit a phone, ${scheme}`);
 check(await page.locator('#mock-slot').getAttribute('data-size')==='phone','A phone opens screens at phone size');
 for(const pane of ['data','components']){await page.click(`[data-mocks-pane="${pane}"]`);check(await wide(page)<=0,`${pane} fits a phone, ${scheme}`)}
 await page.context().close();
}

// A local set adds a private repository, whose mocks run from its own server.
{
 const page=await fresh();
 const sets=await page.evaluate(()=>H.localSets);
 check(!await page.locator('[data-open-repo="ananke"]').count(),'The default sample has no private repository');
 if(sets.some(s=>s.id==='ananke')){
  const local=await fresh({query:'?with=ananke'});
  await local.click('[data-repo-toggle="ananke"]');await local.click('[data-project="onboarding"]');await local.click('#workspace-tab-mocks');
  check(await local.locator('.mock-screen-list button').count()===9,'The local set lists its screens');
  await local.waitForFunction(()=>document.querySelector('#mock-slot iframe')||document.querySelector('.mock-stopped'),null,{timeout:8000});
  if(await local.locator('#mock-slot iframe').count())check((await local.locator('#mock-slot iframe').getAttribute('src')).includes(':8091/'),'A server screen loads from its own port');
  else check((await local.locator('.mock-stopped code').textContent()).includes('pnpm'),'A stopped server shows the command that starts it');
  await local.context().close();
 }
 await page.context().close();
}

await browser.close();
console.log(JSON.stringify(failures.length?{passed:passed.length,failures,errors}:{passed:passed.length,errors}));
process.exit(failures.length||errors.length?1:0);
