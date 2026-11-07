// Layout and behavior from the 2026-11-06 review: terminal, Git height, naming, density, new repositories, and load.
import {writeFileSync} from 'node:fs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
const url=process.env.MOCK_URL||'http://127.0.0.1:4178/workbench.html';
const checks=[],failures=[],errors=[];
const check=(value,name)=>{if(value)checks.push(name);else failures.push(name)};
const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(4000);page.on('pageerror',e=>errors.push(e.message));
const click=s=>page.locator(s).first().click(),text=s=>page.locator(s).first().textContent(),box=s=>page.locator(s).first().evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width}});
const run=async(name,steps)=>{try{await steps()}catch(e){failures.push(name+': '+e.message.split('\n')[0])}};
await page.goto(url);

await run('names',async()=>{
 check(await text('.brand')==='Sheprd'&&(await page.title()).startsWith('Sheprd'),'The product is named Sheprd');
 check(!/shephrd/i.test(await page.content()),'The old spelling is gone from the page');
 check(await text('#page-action')==='New project'&&await text('#project-submit')==='Create project','One name for starting a project');
 await click('.project-select[data-project="workspace"]');
 check(await text('#workspace-tab-source-control')==='Git','The Git tab is named Git');
 check((await text('#workspace-tab-workspace-settings')).includes('Project settings'),'Project settings are named for their scope');
 check(await page.locator('.project-select[data-project="workspace"] .project-label').textContent()==='Agent console','The sample project no longer reads as a workspace');
});

await run('tabs',async()=>{
 const lefts=[];for(const view of ['board','chat','terminal','source-control','workspace-settings']){await click(`[data-main-view="${view}"]`);lefts.push((await box('#tab-board')).left)}
 check(new Set(lefts).size===1,'The tab row stays still between views: '+lefts.join(','));
 await page.setViewportSize({width:2560,height:1300});await click('[data-main-view="board"]');
 check((await box('#view-title')).left===(await box('#tab-board')).left,'Title and tabs share an edge on a wide monitor');
 await page.setViewportSize({width:1440,height:900});
});

await run('terminal',async()=>{
 await click('[data-main-view="terminal"]');
 check(await page.locator('#terminal-form button').count()===0,'A terminal has no Enter button');
 check(!await page.locator('#terminal-command').getAttribute('placeholder'),'A terminal has no placeholder prompt');
 const screen=await box('#terminal-screen');
 check(screen.top<=125,'The terminal starts near the top of the window: '+screen.top);
 check(Math.abs(screen.bottom-900)<=1,'The terminal reaches the bottom of the window: '+screen.bottom);
 check((await box('#terminal-form')).top<screen.top+60,'The prompt starts at the top of an empty terminal');
 await page.locator('#terminal-command').fill('ls');await page.locator('#terminal-command').press('Enter');
 check(await page.locator('#terminal-screen #terminal-output').count()===1&&await page.locator('#terminal-screen #terminal-form').count()===1,'Output and prompt share one screen');
 check((await box('#terminal-form')).top<screen.top+160,'The prompt follows the last output instead of staying at the bottom');
 check(/^\d+×\d+$/.test(await text('#terminal-size')),'The session shows its size in columns and rows');
 await page.locator('#terminal-command').fill('vim app/sidebar.tsx');await page.locator('#terminal-command').press('Enter');
 check(await page.locator('.terminal-alt').count()===1,'A full-screen program takes over the terminal');
 const alt=await box('.terminal-alt');check(alt.height>screen.height-40,'The full-screen program fills the terminal');
 check((await text('.terminal-alt')).includes('RepositoryTree'),'The full-screen program shows the file');
 await page.locator('#terminal-command').fill(':q');await page.locator('#terminal-command').press('Enter');
 check(await page.locator('.terminal-alt').count()===0&&await text('#terminal-output').then(t=>t.includes('ls')),'Quitting restores the earlier output');
 await click('#terminal-screen');check(await page.locator('#terminal-command').evaluate(e=>e===document.activeElement),'Clicking anywhere in the terminal focuses it');
});

await run('git',async()=>{
 await page.setViewportSize({width:2560,height:1300});await click('[data-main-view="source-control"]');
 check(await text('#view-title')==='Git','The Git page is named Git');
 const git=await box('.git-workspace');check(Math.abs(git.bottom-1300)<=1,'Git uses the full window height: '+git.bottom);
 check(git.top<=125,'Git starts near the top of the window: '+git.top);
 check(git.left<=280,'Git starts at the page edge on a wide monitor: '+git.left);
 await page.setViewportSize({width:1440,height:900});
 const rows=await page.locator('.worktree-row.depth-1 code').allTextContents();
 check(rows.some(t=>t.includes('app-shell'))&&rows.some(t=>t.includes('review')),'Team worktrees show the part of the branch that differs: '+rows.join(','));
 await click('[data-diff-scope="all"]');
 check(await page.locator('.diff-file').count()===2,'All files stacks every changed file in one pane');
 check(await page.locator('.diff-file-header').first().evaluate(e=>getComputedStyle(e).position==='sticky'),'File names stay visible while scrolling a long diff');
 check(await page.locator('.diff-line').count()>=40,'The sample diff is long enough to judge');
 await click('[data-diff-scope="file"]');
 check((await box('#git-commit-form')).top<(await box('.git-file-group')).top,'The commit message comes before the file list, as in VS Code');
});

await run('thread',async()=>{
 await click('[data-agent="iris"]');await page.waitForTimeout(60);
 const allow=await box('[data-permission-answer="allow"]'),composer=await box('#composer-wrap');
 check(allow.bottom<=composer.top,'Approval buttons are fully visible when the thread opens');
 const body=await text('#view-body');
 check(!body.includes('feat/workspace ')&&(await page.locator('[data-tool-call="call-iris"] .op-data').first().textContent()).includes('workspace-app-shell'),'Iris is always on her team branch');
 check(body.includes('.worktrees/workspace-app-shell'),'The approval runs in the team worktree');
 await click('[data-team="app-shell"]');
 check(!await page.locator('#composer-account').isVisible(),'A shared team chat has no subscription picker');
});

await run('board',async()=>{
 await click('.project-select[data-project="workspace"]');
 check(!await page.locator('.board-summary').isVisible(),'Column counts appear once on a desktop board');
 check((await text('[data-sprint="sp-02"]')).includes('Iris'),'A sprint card names who is working on it');
 await page.setViewportSize({width:390,height:844});
 check(await page.locator('.board-summary').isVisible(),'Phones keep the column jump strip');
 await page.setViewportSize({width:1440,height:900});
});

await run('task',async()=>{
 await click('[data-sprint="sp-04"]');await click('[data-task="SH-18"]');
 const body=await text('#view-body');
 check(!body.includes('is part of'),'A task page has no filler sentence');
 check(body.includes('Done when')&&body.includes('Activity'),'A task page says what done means and what happened');
});

await run('home',async()=>{
 await click('#home-link');
 const row=page.locator('[data-home-item="question:nav-decision"]');
 check((await row.textContent()).includes('18 min'),'A request shows how long it has waited');
 check((await row.textContent()).includes('Blocks SH-17'),'A request shows what it blocks');
 check(await row.evaluate(e=>e.getBoundingClientRect().height)<=44,'Rows stay single lines with the extra detail');
 await row.click();
 const close=await box('#close-home-detail'),detail=await box('#home-detail');
 check(detail.right-close.right<60,'The close button sits at the right edge of the expanded row');
 check(await page.locator('#home-detail .decision h2').evaluate(e=>getComputedStyle(e).display==='none'),'The expanded row does not repeat its own title');
 await row.click();
 await click('[data-home-tab="projects"]');
 const color=await page.locator('.project-attention-status').first().evaluate(e=>getComputedStyle(e).color),warn=await page.evaluate(()=>{const d=document.createElement('i');d.style.color='var(--color-warn)';document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c});
 check(color===warn,'Needs attention uses the attention color on All projects');
 await click('[data-home-tab="attention"]');
});

await run('type',async()=>{
 const smallest=async()=>page.evaluate(()=>{let min=99;const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(!n.textContent.trim())continue;const e=n.parentElement,r=e.getBoundingClientRect();if(!r.width||e.closest('.sr-only,[hidden]'))continue;min=Math.min(min,parseFloat(getComputedStyle(e).fontSize))}return min});
 check(await smallest()>=11,'No text on Home is under 11 pixels');
 await click('.project-select[data-project="workspace"]');check(await smallest()>=11,'No text on the board is under 11 pixels');
});

await run('service pages',async()=>{
 await click('[data-system-page="subscriptions"]');
 check(await page.locator('table.subscription-table').count()===1,'Subscriptions is a table');
 check(await page.locator('table.subscription-table tbody tr').first().evaluate(e=>e.getBoundingClientRect().height)<=46,'Subscription rows are single lines');
 check(!(await text('#view-body')).includes('1 active agents'),'Agent counts read correctly');
 await click('[data-system-page="alerts"]');
 check(await page.locator('table.alert-list').count()===1,'Alerts is a table');
 check(await page.locator('table.alert-list tbody tr').first().evaluate(e=>e.getBoundingClientRect().height)<=46,'Alert rows are single lines');
 check(await text('#alerts-count')==='1 failed','The Alerts badge counts failed notifications, not requests');
 await click('[data-system-page="machines"]');
 check((await text('.machine-table tbody tr')).includes(' of 8'),'Agent slots show how many are in use');
 for(const page2 of ['alerts','machines','subscriptions','settings']){await click(`[data-system-page="${page2}"]`);check(!(await text('#participants')).includes('Across all'),`${page2} has no filler subtitle`)}
 await click('#home-link');
});

await run('new repository',async()=>{
 await click('#new-project');
 check(await page.locator('#project-repo option[value="__new"]').count()===1,'New project offers a brand new repository');
 check((await page.locator('#project-repo optgroup').first().getAttribute('label')).includes('~/projects'),'Existing repositories are named as coming from the workspace folder');
 await page.locator('#project-repo').selectOption('__new');
 check(await page.locator('#project-new-repo').isVisible(),'A new repository asks for its name');
 await page.locator('#project-new-repo').fill('Billing API');await page.locator('#project-name').fill('First pass');
 check((await text('#project-location-preview')).includes('~/projects/billing-api'),'The preview shows the new folder');
 await click('#project-submit');
 check(await page.locator('[data-open-repo="billing-api"]').count()===1,'The new repository joins the sidebar');
 check(await text('#view-title')!=='Home','Creating the project opens its lead');
});

await page.close();
await run('heavy sample',async()=>{
 const heavy=await browser.newPage({viewport:{width:1440,height:900}});heavy.setDefaultTimeout(4000);heavy.on('pageerror',e=>errors.push(e.message));
 await heavy.goto(url+'?sample=heavy');
 const counts=await heavy.evaluate(()=>({projects:projects.length,agents:projects.flatMap(agents).length,open:homeItems().filter(i=>i.status==='open').length}));
 check(counts.projects===10,'The heavy sample has 10 projects');check(counts.agents>=30,'The heavy sample has at least 30 agents: '+counts.agents);check(counts.open>=10,'The heavy sample has a real queue: '+counts.open);
 check(await heavy.locator('#repo-tree').evaluate(e=>e.classList.contains('more-below')),'A long sidebar shows there is more below');
 await heavy.locator('[data-project-toggle="workspace"]').click();
 await heavy.locator('.project-select[data-project="workspace"]').click();await heavy.locator('[data-main-view="chat"]').click();
 check(await heavy.locator('#view-body .turn').count()>=14,'The lead has a long working conversation');
 check(await heavy.locator('#view-body .work-activity').count()>=5,'Tool activity is grouped in the long conversation');
 check(await heavy.locator('#view-body').evaluate(e=>e.scrollTop>0),'A long conversation opens at its latest message');
 await heavy.close();
});

await run('designer findings',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);return p};
 const q=await fresh();const at=s=>q.locator(s).first();
 // SIDE-1 and STATUS-1
 check((await at('.project-select[data-project="recovery"]').textContent()).trim().endsWith('1'),'A project with a failed agent shows a count');
 await at('[data-project-toggle="recovery"]').click();
 const ash=at('[data-agent="ash"]');
 check(await ash.locator('.dot').evaluate(e=>e.classList.contains('error'))&&(await ash.textContent()).includes('Failed to start'),'A failed agent has the error dot and says so');
 const green=await at('[data-agent="mira"], [data-agent="vale"]').locator('.dot').evaluate(e=>getComputedStyle(e).backgroundColor).catch(()=>'');
 check(await ash.locator('.dot').evaluate(e=>getComputedStyle(e).backgroundColor)!==green,'A failed agent does not share the running color');
 const reviewTeam=at('.team-select[data-team="review"]');
 check((await reviewTeam.locator('.attention-number').textContent())==='1'&&await reviewTeam.getAttribute('aria-current')===null,'A collapsed team shows its waiting request, not its member count');
 check((await at('.repo-heading:has([data-open-repo="sheprd"]) .attention-number').textContent()).match(/^\d+$/),'A repository rolls up attention');
 const bell=Number(await at('#attention-count').textContent()),rolled=await q.locator('.project-select .attention-number').allTextContents();
 check(rolled.map(Number).reduce((a,b)=>a+b,0)===bell,'The sidebar counts add up to the bell');
 // THREAD-2
 await at('.project-select[data-project="workspace"]').click();await q.waitForTimeout(40);
 const gap=s=>q.locator(s).evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);
 check(await gap('#lead-chat-body')<=2,'The lead panel opens at its true end');
 await at('#close-lead-panel').click();await at('#lead-toggle').click();await q.waitForTimeout(40);
 check(await gap('#lead-chat-body')<=2,'Reopening the lead panel keeps the end in view');
 await at('[data-main-view="chat"]').click();await q.waitForTimeout(40);
 check(await gap('#view-body')<=2,'The Chat tab opens at the end after the panel');
 await q.locator('#view-body').evaluate(e=>{e.scrollTop=0});await q.waitForTimeout(40);
 check(await at('#latest-button').isVisible(),'Scrolling up offers a way back to the latest message');
 check((await at('#latest-button').textContent()).includes('below'),'The Latest button says when a request is below');
 await at('#latest-button').click();check(await gap('#view-body')<=2&&!await at('#latest-button').isVisible(),'The Latest button returns to the end');
 // COMP-2
 await at('.project-select[data-project="workspace"]').click();await at('[data-main-view="chat"]').click();
 const input=at('#message-input');await input.fill('first line');await input.press('Shift+Enter');check((await input.inputValue()).includes('\n'),'Shift and Enter adds a new line');
 await input.fill('Enter sends this');await input.press('Enter');check(await input.inputValue()==='','Enter sends the message');
 check((await at('.keyboard-hint').textContent()).startsWith('Enter to send'),'The composer says how to send');
 // THREAD-1, PERM-1, STOP-1, PERM-2
 await at('[data-team-toggle="review"]').click();await at('[data-agent="finch"]').click();await q.waitForTimeout(40);
 const finch=await at('#view-body').textContent();
 check(!finch.includes('No owner action needed')&&await q.locator('#view-body .turn-state').count()===0,'A waiting thread has no contradicting status');
 check((await at('#permission-perm-finch [data-permission-answer="allow"]').textContent())==='Allow without seeing input'&&await at('#permission-perm-finch [data-permission-answer="allow"]').evaluate(e=>e.classList.contains('secondary')),'A blind approval looks different from an informed one');
 await at('[data-agent="iris"]').click();await q.waitForTimeout(40);
 await at('#agent-controls [data-agent-command="stop"]').click();
 check(await at('#stop-dialog').isVisible()&&(await at('#stop-title').textContent()).includes('cancel 1 approval request'),'Stopping an agent with a waiting request asks first and names it');
 await at('#stop-dialog footer [data-close]').click();check((await at('[data-agent="iris"]').textContent()).includes('Needs approval'),'Cancelling the stop changes nothing');
 await at('#agent-controls [data-agent-command="stop"]').click();await at('#confirm-stop-agent').click();
 const closed=await at('#permission-perm-iris').textContent();
 check(closed.includes('No answer was sent')&&!closed.includes('Answer recorded'),'A cancelled request does not claim an answer');
 check(await at('[data-agent="iris"] .dot').evaluate(e=>e.classList.contains('stopped')),'A stopped agent has a hollow dot');
 await q.close();
 // GIT-1
 const g=await fresh();await g.locator('.project-select[data-project="workspace"]').first().click();await g.locator('[data-main-view="source-control"]').first().click();await g.locator('[data-diff-mode="split"]').first().click();await g.waitForTimeout(60);
 const split=await g.locator('.split-diff').evaluate(e=>{const cells=[...e.querySelectorAll(':scope>.diff-line:not(.hunk)')];let aligned=true;for(let i=0;i+1<cells.length;i+=2)if(Math.abs(cells[i].getBoundingClientRect().top-cells[i+1].getBoundingClientRect().top)>1)aligned=false;return {aligned,even:cells.length%2===0,filler:e.querySelectorAll('.filler').length,columns:getComputedStyle(e).gridTemplateColumns.split(' ').length,nested:e.querySelectorAll(':scope>div').length}});
 check(split.aligned&&split.even&&split.columns===2,'Split rows line up across the two sides');
 check(split.filler>0&&split.nested===0,'Split fills gaps with blank rows and scrolls as one');
 check(await g.locator('.split-diff').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'Both sides of a split diff are visible without sideways scrolling');
 check((await g.locator('#split-note').textContent()).includes('hides the worktree list')&&!await g.locator('.worktree-navigation').isVisible(),'Split at 1440 pixels makes room and says so');
 await g.locator('[data-diff-mode="unified"]').first().click();check(await g.locator('.worktree-navigation').isVisible(),'Unified brings the worktree list back');
 await g.setViewportSize({width:1000,height:800});await g.locator('[data-diff-mode="split"]').first().click();await g.waitForTimeout(60);
 check(await g.locator('.split-diff').count()===0&&(await g.locator('#split-note').textContent()).includes('wider window'),'A narrow window falls back to unified and says so');
 await g.close();
 // MERGE-1
 const m=await fresh();await m.locator('.project-select[data-project="workspace"]').first().click();await m.locator('[data-main-view="source-control"]').first().click();
 await m.locator('[data-stage-file="app/workspace.tsx"]').click();await m.locator('[data-stage-file="app/sidebar.tsx"]').click();await m.locator('#git-message').fill('Keep drafts with their thread');await m.locator('#git-commit').click();await m.locator('#git-integrate').click();
 const review=await m.locator('#merge-dialog').textContent();
 check(review.includes('1 commit ')&&!review.includes('1 commits'),'The merge review counts one commit correctly');
 check(review.includes('app/workspace.tsx')&&await m.locator('#merge-dialog .unified-diff').count()===2,'The merge review shows every file and its diff');
 check(review.includes('Passed')&&review.includes('Approved by Finch')&&await m.locator('#merge-dialog [data-agent="finch"]').count()===1,'The merge review shows tests and links the review thread');
 check(await m.locator('#merge-dialog footer [data-close]').isVisible(),'The merge review can be cancelled');
 await m.close();
 // HOME-1, HOME-2, SIGN-1
 const h=await fresh();
 await h.locator('[data-home-item="failure:ash"]').click();const detail=()=>h.locator('#home-detail').textContent();
 check((await detail()).includes('Buildbox')&&await h.locator('#home-detail [data-sign-in-agent="ash"]').isVisible(),'A failed start offers sign-in on its machine');
 await h.locator('#home-detail [data-resume-agent="ash"]').click();check((await h.locator('#toast, .toast').first().textContent()).includes('Resume failed'),'Resume before sign-in explains why it failed');
 await h.locator('#home-detail [data-sign-in-agent="ash"]').click();
 check(await h.locator('#subscription-login').isVisible()&&(await h.locator('#sign-in-output').textContent()).includes('codex login')&&await h.locator('#finish-sample-signin').count()===0,'Sign-in runs the harness login, with no fake button');
 check((await h.locator('#sign-in-status').textContent()).includes('Waiting'),'Sign-in shows that it is waiting');
 await h.waitForFunction(()=>document.querySelector('#sign-in-status').textContent.startsWith('Signed in'));
 await h.locator('#sign-in-close').click();await h.locator('#home-detail [data-resume-agent="ash"]').click();
 check(await h.locator('[data-home-item="failure:ash"]').count()===0,'Signing in and resuming clears the failed start');
 for(const key of ['question:nav-decision','approval:perm-iris','approval:perm-finch']){await h.locator(`[data-home-item="${key}"]`).click();await h.locator('#home-detail [data-permission-answer="allow"], #home-detail [data-resolve-request]').first().click()}
 await h.waitForTimeout(60);const empty=await h.locator('#home-results').textContent();
 check(empty.includes('Nothing needs you')&&!empty.includes('Clear the filters'),'The empty queue is not blamed on filters');
 await h.close();
 // THREAD-7
 const t=await fresh();await t.locator('#design-notes').click();await t.locator('#preview-start-reason').selectOption('model-refused');await t.locator('[data-preview="failed-start"]').click();await t.waitForTimeout(40);
 const failed=await t.locator('.start-failure').first().textContent();
 check(failed.includes('rejected this model on Buildbox')&&!failed.includes('Adapter')&&await t.locator('.start-failure select').count()===2,'A refused model names the machine and offers the choice in place');
 await t.locator('.start-failure [data-resume-agent]').click();check(await t.locator('.start-failure').count()===0,'Trying again with another model clears the failure');
 await t.close();
 // PAIR-1 and MACH-1
 const f=await fresh();await f.locator('[data-system-page="machines"]').click();
 check(await f.locator('select#machine-mode').count()===0&&await f.locator('#machine-role').textContent()==='Master','The role is text, not a one-click select');
 await f.locator('#change-role').click();check((await f.locator('#role-impact').textContent()).includes('depend on Studio'),'Changing the role states who depends on it');await f.locator('#role-dialog footer [data-close]').click();check(await f.locator('#machine-role').textContent()==='Master','Cancelling keeps the role');
 await f.locator('#connect-machine').click();await f.locator('#machine-name').fill('Office worker');await f.locator('#pair-machine').click();
 check((await f.locator('#pair-code-value').textContent()).length>=20&&await f.locator('#machine-code').count()===0,'The master shows a code rather than asking for one');
 await f.waitForFunction(()=>document.querySelector('#pair-status').textContent.includes('connected'));check((await f.locator('.machine-table').textContent()).includes('Office worker'),'The worker appears after it connects');
 await f.close();
});

const result={passed:checks.length,failed:failures.length,failures,errors,checks};
writeFileSync('design/previews/revision-checks.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:checks.length,failed:failures.length,failures,errors},null,1));
await browser.close();
if(failures.length||errors.length)process.exitCode=1;
