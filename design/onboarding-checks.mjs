// Checks the first run with real clicks, from the login page to the lead's first message.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.MOCK_URL||'http://127.0.0.1:4178/workbench.html';
const browser=await chromium.launch(),errors=[],passed=[],failures=[];
const check=(ok,label)=>{(ok?passed:failures).push(label)};
const fresh=async({query='?sample=first',width=1440,height=900,scheme='dark'}={})=>{
 const context=await browser.newContext({viewport:{width,height},colorScheme:scheme}),page=await context.newPage();
 page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(query+': '+e.message));
 await page.goto(base+query);await page.waitForFunction(()=>window.lgcodeReady);
 return page;
};
const logIn=async page=>{await page.fill('#login-password','secret');await page.click('#login-submit')};
const title=page=>page.locator('#setup-title').textContent();
const wide=page=>page.evaluate(()=>{const s=document.querySelector('#setup');return Math.max(document.documentElement.scrollWidth-innerWidth,s.scrollWidth-s.clientWidth)});
const toFound=async page=>{await logIn(page);await page.click('text=Get started');await page.waitForSelector('#setup-harnesses')};
const toProject=async page=>{await toFound(page);await page.click('[data-setup-go=project]');await page.waitForSelector('#project-name:visible')};

// The whole path, in order.
{
 const page=await fresh();
 check(await page.locator('#auth-gate').isVisible(),'A first run starts at the login page');
 check(!await page.locator('#setup').isVisible()&&!await page.locator('.app').isVisible(),'Nothing else shows before login');
 check(await page.locator('#auth-title').textContent()==='Sign in to LGcode','A first visit is asked to sign in, not welcomed back');
 await logIn(page);
 check(await title(page)==='LGcode'&&await page.locator('#setup').isVisible(),'Login opens the first page');
 check(!await page.locator('.app').isVisible(),'The empty app stays hidden during setup');
 check(await page.locator('.setup-pairs div').count()===3,'The first page shows three paired promises');
 check(await page.locator('#setup input,#setup select,#setup textarea').filter({visible:true}).count()===0,'The first page asks for nothing');
 check(await page.evaluate(()=>document.activeElement.id)!=='login-password','Focus leaves the login field');
 await page.click('text=Get started');
 check(await title(page)==='Found on this computer','Get started opens what was found');
 check(await page.locator('[role=status]',{hasText:'Looking at'}).isVisible(),'The scan says what it is doing');
 check(await page.locator('[data-setup-go=welcome]').isVisible(),'The scan can be left while it runs');
 await page.waitForSelector('#setup-harnesses');
 check(await page.locator('#setup input,#setup select,#setup textarea').filter({visible:true}).count()===0,'What was found asks for nothing');
 check(await page.locator('.setup-rows li',{hasText:'Claude Code'}).locator('.setup-state').textContent()==='Signed in','A signed-in harness says so');
 check(await page.locator('.setup-rows li',{hasText:'Codex'}).getByRole('button',{name:'Sign in'}).isVisible(),'An installed harness offers its sign-in in place');
 check(await page.locator('.setup-rows li',{hasText:'Cursor'}).locator('.setup-state').textContent()==='Not installed','A missing harness says so');
 check(await page.locator('.setup-rows li',{hasText:'lumen-web'}).isVisible(),'Repositories in the folder are listed');
 check(await page.locator('#setup-repositories').textContent()==='Repositories in ~/projects','The folder is named');
 await page.click('[data-setup-go=project]');
 check(await title(page)==='First project','Continue opens the first project');
 check(await page.locator('#project-repo').inputValue()==='lumen-web','The most recent repository is chosen');
 check(await page.locator('#project-name').inputValue()==='Lumen web','The project name starts from the repository');
 check(await page.locator('#project-worktree').isChecked(),'A worktree is the default');
 check(!await page.locator('#project-machine').isVisible(),'One computer is not offered as a choice');
 check(!await page.locator('#project-lead-field').isVisible(),'One signed-in harness is not offered as a choice');
 check((await page.locator('#project-location-preview').textContent()).includes('~/projects/lumen-web/.worktrees/lumen-web'),'The preview says where work will go');
 await page.selectOption('#project-repo','billing-api');
 check(await page.locator('#project-name').inputValue()==='Billing api','The name follows the repository until it is edited');
 await page.fill('#project-name','Invoice export');
 await page.selectOption('#project-repo','lumen-web');
 check(await page.locator('#project-name').inputValue()==='Invoice export','An edited name is kept');
 await page.click('#project-submit');
 await page.waitForSelector('#setup',{state:'hidden'});
 check(await page.locator('.app').isVisible(),'Creating the project opens the app');
 check(await page.locator('#project-dialog').evaluate(d=>!!d.querySelector('#project-form')),'The form returns to its dialog');
 check(await page.evaluate(()=>state.view)==='chat'||await page.evaluate(()=>!!isChat()),'The owner lands in the lead conversation');
 check((await page.locator('#view-body').textContent()).includes('What would you like to build for Invoice export?'),'The lead greets the new project');
 check(await page.evaluate(()=>document.activeElement.id)==='message-input','The composer has the focus');
 check((await page.locator('#sidebar').textContent()).includes('Invoice export'),'The sidebar shows the project');
 check((await page.locator('#sidebar').textContent()).includes('billing-api')||await page.evaluate(()=>repositories.length)===3,'The other repositories stay known');
 await page.fill('#message-input','Build the export');await page.click('#send-message');
 await page.waitForFunction(()=>document.querySelector('#view-body').textContent.includes('captured that direction'));
 check(true,'The first message gets a reply');
 const rows=await page.evaluate(()=>api.debug.events().map(r=>r.event_type));
 check(rows.filter(t=>t==='project.SetupFinished').length===1,'Finishing is recorded once');
 check(rows.filter(t=>t==='project.SetupProgressed').length===2,'Each step is recorded once');
 for(const tab of ['board','terminal','source-control','workspace-settings']){await page.evaluate(v=>go({view:v}),tab);check(await page.locator('#view-body').isVisible(),'The new project opens '+tab)}
 await page.click('#new-project');
 check(await page.locator('#project-dialog [data-close="project-dialog"]').first().isVisible()&&await page.locator('#project-form footer button.secondary').textContent()==='Cancel','The usual dialog is back to normal');
 await page.click('#project-form footer button.secondary');
 await page.reload();await page.waitForFunction(()=>window.lgcodeReady);
 await logIn(page);
 check(await title(page)==='LGcode','Finished setup leaves no step behind to resume');
 await page.context().close();
}
// Leaving midway, and going back.
{
 const page=await fresh();
 await toProject(page);
 await page.locator('#project-form footer [data-setup-back]').click();
 check(await title(page)==='Found on this computer','Back works from the first project');
 await page.reload();await page.waitForFunction(()=>window.lgcodeReady);
 await page.waitForSelector('#project-name:visible');
 check(await title(page)==='First project','Back does not lower how far the owner got');
 check(await page.locator('#auth-gate').isHidden(),'A reload in the same tab stays logged in');
 await page.click('#setup-log-out');
 check(await page.locator('#auth-gate').isVisible()&&await page.locator('#setup').isHidden(),'Log out works during setup');
 await logIn(page);await page.waitForSelector('#project-name:visible');
 check(await title(page)==='First project','Logging back in resumes at the same step');
 await page.context().close();
}
// Looking around first, and coming back.
{
 const page=await fresh({query:'?sample=first&setup=both'});
 await logIn(page);
 await page.click('text=Look around first');await page.waitForFunction(()=>window.lgcodeReady);
 check(await page.locator('.app').isVisible()&&await page.evaluate(()=>projects.length)>0,'Look around first opens the sample');
 check(await page.locator('#auth-gate').isHidden(),'Looking around asks for no second login');
 check(await page.locator('#back-to-setup').isVisible(),'The sample offers its way back');
 await page.click('#back-to-setup');await page.waitForFunction(()=>window.lgcodeReady);
 check(await title(page)==='LGcode'&&page.url().includes('setup=both'),'Coming back returns to setup in the same state');
 await page.context().close();
 const plain=await fresh({query:''});
 check(await plain.locator('#back-to-setup').isHidden(),'The normal sample shows no way back to setup');
 check(await plain.evaluate(()=>H.setup.step==='welcome'&&!api.setup.needed()),'The normal sample never needs setup');
 check(await plain.locator('#setup').isHidden(),'The normal sample does not draw setup');
 await plain.evaluate(()=>document.querySelector('#notes').showModal());
 const links=await plain.locator('.first-run-links a').evaluateAll(all=>all.map(a=>a.getAttribute('href')));
 check(links.length===7&&links.every(l=>l.includes('reset=1')),'Design notes reach all seven first-run states');
 await plain.locator('.first-run-links a').first().click();await plain.waitForFunction(()=>window.lgcodeReady);
 check(await plain.locator('#auth-gate').isVisible()&&!plain.url().includes('reset'),'A Design notes link really opens a first run, and a reload will not reset it');
 await plain.context().close();
}
// Every state of what the scan can find.
{
 const out=await fresh({query:'?sample=first&setup=signed-out'});
 await toFound(out);
 check(await out.locator('[data-setup-go=project]').isDisabled(),'Continue waits for a signed-in harness');
 check((await out.locator('#setup-body').textContent()).includes('needs a harness that is signed in'),'It says why Continue waits');
 await out.locator('.setup-rows li',{hasText:'Claude Code'}).getByRole('button',{name:'Sign in'}).click();
 check(await out.locator('#subscription-login').isVisible()&&(await out.locator('#subscription-login-title').textContent()).includes('Claude Code'),'Sign in uses the existing sign-in dialog');
 await out.waitForFunction(()=>document.querySelector('#sign-in-status').textContent.startsWith('Signed in'));
 await out.click('#sign-in-close');
 check(await out.locator('.setup-rows li',{hasText:'Claude Code'}).locator('.setup-state').textContent()==='Signed in','The row updates after sign-in');
 check(await out.locator('[data-setup-go=project]').isEnabled(),'Continue opens after sign-in');
 await out.reload();await out.waitForFunction(()=>window.lgcodeReady);await out.waitForSelector('#setup-harnesses');
 check(await out.locator('.setup-rows li',{hasText:'Claude Code'}).locator('.setup-state').textContent()==='Signed in','A sign-in survives a reload');
 await out.context().close();

 const none=await fresh({query:'?sample=first&setup=none'});
 await toFound(none);
 check(await none.locator('.setup-rows code').count()===4,'With nothing installed, each harness shows its install command');
 check(await none.locator('[data-setup-go=project]').isDisabled()&&(await none.locator('#setup-body').textContent()).includes('Install one, then check again'),'It says what is missing');
 await none.locator('[data-setup-rescan]').click();await none.waitForSelector('#setup-harnesses');
 check(await none.locator('.setup-rows code').count()===0&&await none.locator('.setup-rows li',{hasText:'Codex'}).getByRole('button',{name:'Sign in'}).isVisible(),'Check again finds a newly installed harness');
 await none.context().close();

 const failed=await fresh({query:'?sample=first&setup=failed'});
 await logIn(failed);await failed.click('text=Get started');await failed.waitForSelector('#setup-body [role=alert]');
 check((await failed.locator('#setup-body [role=alert]').textContent()).includes('no permission'),'A failed scan says why');
 check(await failed.locator('[data-setup-go=project]').count()===0,'A failed scan offers no Continue');
 check(await failed.locator('[data-setup-go=welcome]').isVisible(),'A failed scan can be left');
 await failed.click('text=Try again');await failed.waitForSelector('#setup-harnesses');
 check(await failed.locator('[data-setup-go=project]').isEnabled(),'Try again recovers');
 await failed.context().close();

 const empty=await fresh({query:'?sample=first&setup=empty'});
 await toFound(empty);
 check((await empty.locator('#setup-body').textContent()).includes('None in this folder'),'An empty folder says so');
 await empty.click('[data-setup-go=project]');await empty.waitForSelector('#project-name:visible');
 check(await empty.locator('#project-repo').inputValue()==='__new'&&await empty.locator('#project-new-repo').isVisible(),'An empty folder starts a new repository');
 check(await empty.locator('#project-submit').isDisabled(),'A new repository needs a name');
 await empty.fill('#project-new-repo','Field Notes');await empty.fill('#project-name','Notes');
 check((await empty.locator('#project-location-preview').textContent()).includes('~/projects/field-notes'),'The new repository goes in the folder');
 await empty.click('#project-submit');await empty.waitForSelector('#setup',{state:'hidden'});
 check(await empty.evaluate(()=>repositories.some(r=>r.id==='field-notes')),'The new repository exists');
 await empty.context().close();

 const moved=await fresh({query:'?sample=first&setup=empty'});
 await toFound(moved);
 await moved.click('[data-setup-folder]');
 check(await moved.locator('#setup-folder-input').inputValue()==='~/projects','Change folder starts from the current one');
 await moved.click('[data-setup-folder-cancel]');
 check(await moved.locator('#setup-folder-input').count()===0,'Change folder can be cancelled');
 await moved.click('[data-setup-folder]');
 await moved.fill('#setup-folder-input','~/code');await moved.click('text=Look here');
 await moved.waitForSelector('#setup-repositories');
 check(await moved.locator('#setup-repositories').textContent()==='Repositories in ~/code'&&await moved.locator('.setup-rows li',{hasText:'lumen-web'}).isVisible(),'Another folder is scanned');
 await moved.click('[data-setup-go=project]');await moved.waitForSelector('#project-name:visible');
 check((await moved.locator('#project-location-preview').textContent()).includes('~/code/lumen-web'),'The project uses the chosen folder');
 await moved.locator('#project-form footer [data-setup-back]').click();await moved.waitForSelector('#setup-harnesses');
 await moved.click('[data-setup-folder]');await moved.fill('#setup-folder-input','~/work');await moved.click('text=Look here');await moved.waitForSelector('#setup-repositories');
 await moved.click('[data-setup-go=project]');await moved.waitForSelector('#project-name:visible');
 check((await moved.locator('#project-location-preview').textContent()).includes('~/work/lumen-web')&&await moved.evaluate(()=>repositories.length)===3,'Changing folder again forgets the old list');
 await moved.context().close();

 const both=await fresh({query:'?sample=first&setup=both'});
 await toProject(both);
 check(await both.locator('#project-lead-field').isVisible()&&await both.locator('#project-account option').count()===2,'Two signed-in harnesses offer a choice');
 check(await both.locator('#project-account').inputValue()==='claude-local','The choice has a default');
 await both.selectOption('#project-account','codex-local');await both.click('#project-submit');await both.waitForSelector('#setup',{state:'hidden'});
 check(await both.evaluate(()=>projects[0].lead.tool)==='Codex','The chosen harness runs the lead');
 await both.context().close();

 const codex=await fresh({query:'?sample=first&setup=codex-only'});
 await toProject(codex);await codex.click('#project-submit');await codex.waitForSelector('#setup',{state:'hidden'});
 check(await codex.evaluate(()=>projects[0].lead.tool)==='Codex','With only Codex signed in, the lead runs on Codex, not Claude Code');
 check((await codex.locator('#composer-account option').first().textContent()).startsWith('Codex'),'The composer names the harness that runs the lead');
 await codex.context().close();
}
// Each page at phone width, in both palettes.
for(const [scheme,name] of [['dark','Dusk'],['light','Field']]){
 for(const query of ['?sample=first','?sample=first&setup=none','?sample=first&setup=both']){
  const page=await fresh({query,width:390,height:844,scheme});
  await logIn(page);
  check(await wide(page)<=0,`${name} first page fits a phone, ${query}`);
  await page.click('text=Get started');await page.waitForSelector('#setup-harnesses');
  check(await wide(page)<=0,`${name} found page fits a phone, ${query}`);
  const box=await page.locator('[data-setup-go=welcome]').boundingBox();
  check(box.height>=44,`${name} phone buttons are large enough, ${query}`);
  if(await page.locator('[data-setup-go=project]').isEnabled()){
   await page.click('[data-setup-go=project]');await page.waitForSelector('#project-name:visible');
   check(await wide(page)<=0,`${name} project page fits a phone, ${query}`);
   await page.click('#project-submit');await page.waitForSelector('#setup',{state:'hidden'});
   check(await page.locator('#message-input').isVisible(),`${name} phone reaches the lead, ${query}`);
  }
  await page.context().close();
 }
}
await browser.close();
console.log(JSON.stringify(failures.length?{passed:passed.length,failures,errors}:{passed:passed.length,errors}));
process.exit(failures.length||errors.length?1:0);
