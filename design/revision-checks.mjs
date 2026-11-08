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
await page.goto(url);await page.waitForFunction(()=>window.lgcodeReady);

await run('names',async()=>{
 check(await text('.brand')==='LGcode'&&(await page.title()).startsWith('LGcode'),'The product is named LGcode');
 check(!/shephrd|sheprd/i.test(await page.content()),'The old names are gone from the page');
 check(await text('[data-home-new-project]')==='New project'&&await text('#new-project')==='New project'&&await text('#project-submit')==='Create project','One name for starting a project');
 await click('.project-select[data-project="workspace"]');
 check(await text('#workspace-tab-source-control')==='Git','The Git tab is named Git');
 check((await text('#workspace-tab-workspace-settings')).includes('Project settings'),'Project settings are named for their scope');
 check(await page.locator('.project-select[data-project="workspace"] .project-label').textContent()==='Agent console','The sample project no longer reads as a workspace');
});

await run('tabs',async()=>{
 const lefts=[];for(const view of ['board','chat','terminal','source-control','workspace-settings']){await click(`[data-main-view="${view}"]`);lefts.push((await box('#tab-board')).left)}
 check(new Set(lefts).size===1,'The tab row stays still between views: '+lefts.join(','));
 await page.setViewportSize({width:2560,height:1300});await click('[data-main-view="board"]');
 check((await box('#participants')).left===(await box('#tab-board')).left,'The header line and tabs share an edge on a wide monitor');
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
 check(await page.locator('#close-home-detail').count()===0,'The expanded row closes from its own row, with no second close button');
 check(await page.locator('#home-detail .request h2').evaluate(e=>getComputedStyle(e).display==='none'),'The expanded row does not repeat its own title');
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
 check(await text('#alerts-count')==='1'&&(await page.locator('[data-system-page="alerts"]').getAttribute('aria-label'))==='Phone notifications, 1 failed','The phone notifications badge counts failed notifications, not requests');
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
 await heavy.goto(url+'?sample=heavy');await heavy.waitForFunction(()=>window.lgcodeReady);
 const counts=await heavy.evaluate(()=>({projects:projects.length,agents:projects.flatMap(agents).length,open:homeItems().filter(i=>i.status==='open').length}));
 check(counts.projects===10,'The heavy sample has 10 projects');check(counts.agents>=30,'The heavy sample has at least 30 agents: '+counts.agents);check(counts.open>=10,'The heavy sample has a real queue: '+counts.open);
 await heavy.evaluate(()=>{repositories.forEach(r=>expandedRepos.add(r.id));renderSidebar()});
 check(await heavy.locator('#repo-tree').evaluate(e=>e.classList.contains('more-below')),'A long sidebar shows there is more below');
 await heavy.locator('[data-project-toggle="workspace"]').click();
 await heavy.locator('.project-select[data-project="workspace"]').click();await heavy.locator('[data-main-view="chat"]').click();
 check(await heavy.locator('#view-body .turn').count()>=14,'The lead has a long working conversation');
 check(await heavy.locator('#view-body .work-activity').count()>=5,'Tool activity is grouped in the long conversation');
 check(await heavy.locator('#view-body').evaluate(e=>e.scrollTop>0),'A long conversation opens at its latest message');
 await heavy.close();
});

await run('designer findings',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 const fromHome=await fresh();await fromHome.evaluate(()=>openAgent('sage','workspace'));
 check(await fromHome.locator('#view-body').evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight<=4)&&await fromHome.locator('#latest-button').isHidden(),'A thread opened from Home starts at its end');
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
 check((await at('.repo-heading:has([data-open-repo="lgcode"]) .attention-number').textContent()).match(/^\d+$/),'A repository rolls up attention');
 const bell=Number(await at('#attention-count').textContent()),rolled=await q.locator('.project-select .attention-number').allTextContents();
 check(rolled.map(Number).reduce((a,b)=>a+b,0)===bell,'The sidebar counts add up to the bell');
 // THREAD-2, at a window short enough that the thread scrolls
 await q.setViewportSize({width:1440,height:700});await at('.project-select[data-project="workspace"]').click();await q.waitForTimeout(40);
 const gap=s=>q.locator(s).evaluate(e=>e.scrollHeight-e.scrollTop-e.clientHeight);
 check(await gap('#lead-chat-body')<=2,'The lead panel opens at its true end');
 await at('#lead-toggle').click();await at('#lead-toggle').click();await q.waitForTimeout(40);
 check(await gap('#lead-chat-body')<=2,'Reopening the lead panel keeps the end in view');
 await at('[data-main-view="chat"]').click();await q.waitForTimeout(40);
 check(await gap('#view-body')<=2,'The Chat tab opens at the end after the panel');
 await q.locator('#view-body').evaluate(e=>{e.scrollTop=0});await q.waitForTimeout(40);
 check(await at('#latest-button').isVisible(),'Scrolling up offers a way back to the latest message');
 check((await at('#latest-button').textContent()).includes('below'),'The Latest button says when a request is below');
 await at('#latest-button').click();check(await gap('#view-body')<=2&&!await at('#latest-button').isVisible(),'The Latest button returns to the end');await q.setViewportSize({width:1440,height:900});
 // COMP-2
 await at('.project-select[data-project="workspace"]').click();await at('[data-main-view="chat"]').click();
 const input=at('#message-input');await input.fill('first line');await input.press('Shift+Enter');check((await input.inputValue()).includes('\n'),'Shift and Enter adds a new line');
 await input.fill('Enter sends this');await input.press('Enter');check(await input.inputValue()==='','Enter sends the message');
 check((await at('#composer-hint').textContent()).startsWith('Enter sends')&&(await at('#message-input').getAttribute('aria-describedby'))==='composer-hint'&&(await at('#send-message').getAttribute('title')).includes('Enter'),'The composer says how to send, to screen readers and on Send');
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
 check(await m.locator('#approve-main-merge').isDisabled()&&(await m.locator('#merge-evidence').textContent()).includes('Loading'),'The merge review cannot be approved while its results are loading');
 await m.locator('#approve-main-merge:not([disabled])').waitFor();
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
 // EMPTY-1 and BELL-1: an empty bell says so, with no link to an empty list.
 await h.locator('#attention-toggle').click();check(await h.locator('.attention-row').count()===0&&(await h.locator('#attention-list').textContent()).trim()==='Nothing needs your attention.'&&!await h.locator('#attention-home').isVisible(),'An empty bell says so and offers no list to view');await h.keyboard.press('Escape');
 await h.locator('#attention-filter').click();check((await h.locator('#tree-empty').textContent())==='Nothing needs you.'&&await h.locator('.project-group:not([hidden])').count()===0,'Only projects needing you says so when nothing does');await h.locator('#attention-filter').click();check(await h.locator('#tree-empty').count()===0,'Turning the filter off removes that line');
 await h.close();
 // THREAD-7
 const t=await fresh();await t.locator('#design-notes').click();await t.locator('#preview-start-reason').selectOption('model-refused');await t.locator('[data-preview="failed-start"]').click();await t.waitForTimeout(40);
 const failed=await t.locator('.request.is-failed').first().textContent();
 check(failed.includes('rejected this model on Buildbox')&&!failed.includes('Adapter')&&await t.locator('#agent-controls .composer-halt .tool-menu').count()===2,'A refused model names the machine and offers the choice in the composer');
 await t.locator('#agent-controls [data-tool-menu="model"]').click();await t.locator('#tool-menu [data-menu-choice]').nth(1).click();await t.locator('#agent-controls [data-agent-command="resume"]').click();check(await t.locator('.request.is-failed').count()===0,'Trying again with another model clears the failure');
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

// The designer's visual foundations: type, spacing, shape, controls, colour, icons, motion, focus, tabs, and dialogs.
await run('visual foundations',async()=>{
 const {readFileSync}=await import('node:fs');
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 const html=readFileSync(new URL('./workbench.html',import.meta.url),'utf8'),js=readFileSync(new URL('./workbench.js',import.meta.url),'utf8');
 const css=html.slice(html.indexOf('<style>')+7,html.indexOf('</style>'));
 const decls=[...css.matchAll(/([a-z-]+):([^;{}]+)/g)].map(m=>[m[1],m[2].trim()]);
 // TYPE-2: five sizes, three weights, and no raw size in the stylesheet or the script.
 check(/--text-xs:11px; --text-sm:12px; --text-md:13px; --text-lg:15px; --text-xl:20px; --text-input:16px;/.test(css)&&readFileSync(new URL('./tokens.css',import.meta.url),'utf8').includes('--text-md:13px'),'The type scale is 11, 12, 13, 15, and 20 pixels, with 16 for phone fields');
 const rawSizes=decls.filter(([p,v])=>p==='font-size'&&!/^var\(--text-(xs|sm|md|lg|xl|input)\)$/.test(v)&&v!=='inherit'||p==='font'&&v!=='inherit'&&!/(^|\s)var\(--text-(xs|sm|md|lg|xl|input)\)/.test(v));
 check(!rawSizes.length,'No raw font size appears in the stylesheet: '+rawSizes.map(d=>d.join(':')).slice(0,3).join(' | '));
 check(!/font-size:\s*\d|font:\s*\d/.test(js),'The script writes no raw font size');
 check(decls.filter(([p,v])=>p==='font-weight'&&!/^\d+ \d+$/.test(v)).every(([,v])=>/^var\(--weight-(body|medium|strong)\)$/.test(v)),'Every weight in the stylesheet is a token');
 // SPACE-1: three radii and a 4 pixel grid.
 check(decls.filter(([p])=>p==='border-radius').every(([,v])=>v.split(/\s+/).every(x=>x==='0'||/^var\(--radius-(sm|md|pill)\)$/.test(x))),'Every radius is 4 pixels, 8 pixels, or full');
 const offGrid=decls.filter(([p,v])=>/^(padding|margin|gap|row-gap|column-gap)(-[a-z-]+)?$/.test(p)&&v.replace(/var\([^)]*\)|calc\([^)]*\)|clamp\([^)]*\)/g,'').split(/\s+/).some(x=>/px/.test(x)&&!/^(1|2)px/.test(x)&&parseFloat(x)%4!==0));
 check(!offGrid.length,'Spacing sits on the 4 pixel grid: '+offGrid.map(d=>d.join(':')).slice(0,3).join(' | '));
 const audit=p=>p.evaluate(()=>{const sizes=new Set(),weights=new Set(),radii=new Set(),phoneSizes=[];for(const e of document.querySelectorAll('body *')){const r=e.getBoundingClientRect();if(!r.width||!r.height||e.closest('svg,.sr-only'))continue;const c=getComputedStyle(e),text=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())||/INPUT|TEXTAREA|SELECT/.test(e.tagName);if(text){sizes.add(c.fontSize+(/INPUT|TEXTAREA|SELECT/.test(e.tagName)?' field':''));weights.add(c.fontWeight)}radii.add(c.borderTopLeftRadius)}return {sizes:[...sizes],weights:[...weights],radii:[...radii]}});
 const views=[[''],['workspace'],['git'],['machines'],['settings']];
 for(const width of [1440,390]){const p=await fresh('',{width,height:900});for(const [v] of views){if(v==='workspace'||v==='git')await p.evaluate(()=>openBoard('workspace'));if(v==='git')await p.locator('[data-main-view="source-control"]').first().click();if(v==='machines'||v==='settings')await p.evaluate(s=>document.querySelector(`[data-system-page="${s}"]`).click(),v);
  const a=await audit(p),bad=a.sizes.filter(s=>!['11px','12px','13px','15px','20px','12px field','13px field','15px field'].includes(s)&&!(width<=700&&s==='16px field'));
  check(!bad.length,`${width}: ${v||'home'} renders only scale sizes: ${bad.join(',')}`);
  check(a.weights.every(w=>['400','500','600'].includes(w)),`${width}: ${v||'home'} uses three weights: ${a.weights.join(',')}`);
  check(a.radii.every(r=>['0px','4px','8px','999px'].includes(r)),`${width}: ${v||'home'} uses three radii: ${a.radii.join(',')}`)}await p.close()}
 // TYPE-1: Inter and JetBrains Mono are self-hosted, with tabular numbers.
 const f=await fresh();
 check(await f.evaluate(async()=>{await document.fonts.ready;return ['Inter','JetBrains Mono'].every(n=>[...document.fonts].some(x=>x.family.replace(/"/g,'')===n&&x.status==='loaded'))}),'Inter and JetBrains Mono load from the repository');
 check(await f.evaluate(()=>getComputedStyle(document.body).fontFamily.startsWith('Inter')&&getComputedStyle(document.body).fontVariantNumeric==='tabular-nums'&&getComputedStyle(document.querySelector('.repo-label')).fontFamily.startsWith('"JetBrains Mono"')),'Interface text is Inter with tabular numbers, and paths are JetBrains Mono');
 // TYPE-3: a page title is 15 pixels at weight 600.
 check(await f.locator('#view-title').evaluate(e=>getComputedStyle(e).fontSize==='15px'&&getComputedStyle(e).fontWeight==='600'),'A page title is 15 pixels at weight 600');
 // ICON-1: no text characters stand in for icons, and the shortcut matches the system.
 check(!/[×←→↗⌘✓＋]/.test(await f.evaluate(()=>[...document.querySelectorAll('button,kbd')].map(b=>b.textContent).join(''))),'Buttons use drawn icons instead of text characters');
 check((await f.locator('#quick-open-key').textContent())==='Ctrl K','The switcher shortcut reads Ctrl K off Apple systems');
 const mac=await browser.newPage({viewport:{width:1440,height:900}});await mac.addInitScript(()=>{Object.defineProperty(Navigator.prototype,'platform',{get:()=>'MacIntel'});Object.defineProperty(Navigator.prototype,'userAgentData',{get:()=>({platform:'macOS'})})});await mac.goto(url);await mac.waitForFunction(()=>window.lgcodeReady);
 check(await mac.locator('#quick-open-key svg').count()===1&&(await mac.locator('#quick-open-key').textContent()).endsWith('K'),'The switcher shortcut shows the Command icon on Apple systems');await mac.close();
 check(await f.locator('[data-system-page="alerts"] svg rect').count()===1,'Alerts, which go to a phone, use a phone icon');
 // COLOR-1: amber is for attention, and the modified letter is quiet.
 const colors=await f.evaluate(()=>{const token=v=>{const d=document.createElement('i');d.style.color=`var(${v})`;document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c};openBoard('workspace');document.querySelector('[data-main-view="source-control"]').click();const m=document.querySelector('.source-file small');return {m:m?getComputedStyle(m).color:null,muted:token('--color-muted'),warn:token('--color-warn'),alerts:getComputedStyle(document.querySelector('#alerts-count')).color,primary:token('--color-primary')}});
 check(colors.m===colors.muted,'The Modified letter in Git uses the muted colour');
 check(colors.alerts!==colors.warn,'The failed alerts count is not amber');
 await f.evaluate(()=>openBoard('workspace'));
 check(await f.locator('#lead-agent-controls [data-agent-command="stop"]').evaluate(b=>b.classList.contains('secondary')&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)'),'Stop agent is a neutral outline button');
 // BTN-1: a disabled button is an outline with readable muted text, and Commit says why.
 const disabled=await f.locator('#send-message').evaluate(b=>{const lum=c=>{const [r,g,bl]=c.match(/\d+/g).slice(0,3).map(x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*bl};const bg=getComputedStyle(document.querySelector('#message-form')).backgroundColor,fg=getComputedStyle(b).color,[a,c]=[lum(fg),lum(bg)].sort((x,y)=>y-x);return {disabled:b.disabled,fill:getComputedStyle(b).backgroundColor,ratio:(a+.05)/(c+.05)}});
 check(disabled.disabled&&disabled.fill==='rgba(0, 0, 0, 0)'&&disabled.ratio>=3,'A disabled Send is an outline with text at 3 to 1 or more: '+disabled.ratio.toFixed(2));
 await f.locator('[data-main-view="source-control"]').first().click();
 check(await f.locator('#git-commit').isDisabled()&&(await f.locator('#git-commit-reason').textContent())==='Add a message and stage a file.','Disabled Commit says what it needs');
 await f.locator('#git-message').fill('Tighten the thread');check((await f.locator('#git-commit-reason').textContent())==='Stage a file to commit.','The reason updates as the message is typed');
 // BTN-2: two control heights.
 check(await f.locator('#context-toggle').evaluate(e=>Math.round(e.getBoundingClientRect().height))===28&&await f.locator('.git-sync button').first().evaluate(e=>Math.round(e.getBoundingClientRect().height))===28,'The top bar picker and Git sync buttons are 28 pixels');
 await f.evaluate(()=>showNewProject());
 check(new Set(await f.locator('#project-dialog input:not([type=checkbox]):visible,#project-dialog select:visible,#project-dialog footer button').evaluateAll(es=>es.map(e=>Math.round(e.getBoundingClientRect().height)))).size===1,'Inputs, selects, and buttons in one form share one height');
 await f.locator('#project-dialog footer [data-close]').click();
 // BTN-3: anything that changes state is a button.
 await f.evaluate(()=>openHome('attention'));await f.locator('#home-search').fill('Rowan');
 check(await f.locator('#home-clear-filters').evaluate(b=>b.classList.contains('secondary')&&!b.classList.contains('inline-link')),'Clear filters is a button, not a link');await f.locator('#home-clear-filters').click();
 // DLG-1 and ADDSUB-1: every dialog has Cancel or Close left of its action.
 const dialogs=await f.evaluate(()=>[...document.querySelectorAll('dialog:not(#quick-dialog)')].map(d=>{const footers=[...d.querySelectorAll('footer')];return [d.id,footers.some(ft=>{const bs=[...ft.querySelectorAll('button')];const c=bs.findIndex(b=>/^(Cancel|Close)$/.test(b.textContent.trim())&&b.classList.contains('secondary'));const a=bs.findIndex(b=>b.classList.contains('primary'));return c>=0&&(a<0||c<a)})||d.id==='machine-dialog'&&!!d.querySelector('#pair-start footer [data-close]')]}));
 check(dialogs.every(([,ok])=>ok),'Every dialog closes with Cancel or Close left of its action: '+dialogs.filter(([,ok])=>!ok).map(([id])=>id).join(','));
 await f.evaluate(()=>{document.querySelector('[data-system-page="subscriptions"]').click()});await f.locator('#add-subscription').click();
 check(await f.evaluate(()=>{const s=document.querySelector('#subscription-machine'),p=s.nextElementSibling;return p.getBoundingClientRect().top-s.getBoundingClientRect().bottom>=16}),'Add subscription leaves 16 pixels between the select and its note');
 await f.locator('#subscription-dialog footer [data-close]').click();
 // COLOR-2: the toast is a neutral surface at the top right, below the bell.
 await f.evaluate(()=>toast('Saved.'));
 const t=await f.evaluate(()=>{const r=document.querySelector('#toast').getBoundingClientRect(),bell=document.querySelector('#attention-toggle').getBoundingClientRect(),d=document.createElement('i');d.style.color='var(--color-surface)';document.body.append(d);const surface=getComputedStyle(d).color;d.remove();return {right:innerWidth-r.right,top:r.top,bell:bell.bottom,bg:getComputedStyle(document.querySelector('#toast')).backgroundColor,surface}});
 check(t.right<=24&&t.top>=t.bell&&t.top<80&&t.bg===t.surface,'The toast is a raised neutral surface at the top right, below the bell');
 // MOTION-1: rows open and leave in 120 milliseconds, unless motion is reduced.
 await f.evaluate(()=>openHome('attention'));await f.locator('[data-home-item="question:nav-decision"]').click();
 check(await f.locator('#home-detail').evaluate(e=>getComputedStyle(e).animationName==='row-open'&&getComputedStyle(e).animationDuration==='0.12s'),'An expanded row eases open in 120 milliseconds');
 await f.locator('#home-detail [data-resolve-request]').first().click();
 check(await f.locator('.row-leaving').count()===1&&await f.locator('.row-leaving [data-home-item]').count()===0,'An answered request leaves its place instead of vanishing');
 await f.waitForTimeout(450);check(await f.locator('.row-leaving').count()===0,'The leaving row is gone after its animation');
 await f.emulateMedia({reducedMotion:'reduce'});await f.locator('[data-home-item]').first().click();
 check(await f.locator('#home-detail').evaluate(e=>getComputedStyle(e).animationName==='none'),'Reduced motion turns the row animation off');
 // FOCUS-1: the tree has room for the focus ring.
 check(await f.evaluate(()=>{const t=document.querySelector('#repo-tree'),d=t.querySelector('.disclosure');return d.getBoundingClientRect().left-t.getBoundingClientRect().left>=5}),'A tree disclosure has room for its whole focus ring');
 // TAB-2 and TAB-3: tabs stay still, and hover changes colour without a fill.
 await f.evaluate(()=>openBoard('workspace'));const rows=[];
 for(const view of ['board','chat','terminal','source-control','workspace-settings']){await f.locator(`[data-main-view="${view}"]`).first().click();rows.push(await f.locator('#workspace-tabs [role=tab]').evaluateAll(ts=>ts.map(t=>Math.round(t.getBoundingClientRect().left)).join(',')))}
 check(new Set(rows).size===1,'Selecting a tab moves no other tab: '+rows[0]);
 await f.locator('[data-main-view="chat"]').first().hover();
 check(await f.locator('[data-main-view="chat"]').first().evaluate(e=>getComputedStyle(e).backgroundColor==='rgba(0, 0, 0, 0)'),'A hovered tab changes colour without a fill');
 // DISC-2: the resize handles show a grip on hover.
 const handle=f.locator('#sidebar-resize'),hb=await handle.boundingBox();
 check(await handle.evaluate(e=>getComputedStyle(e,'::after').opacity==='0'),'The resize grip is hidden at rest');
 await f.mouse.move(hb.x+hb.width/2,hb.y+300);await f.waitForTimeout(200);
 check(hb.width===8&&await handle.evaluate(e=>getComputedStyle(e).cursor==='col-resize'&&getComputedStyle(e,'::after').opacity==='1'),'Hovering the 8 pixel resize target shows a grip and the resize cursor');
 await f.close();
});

// The application shell: sidebar, top bar, tab row, and switchers, from the designer's critique of 2026-11-06.
await run('application shell',async()=>{
 const fresh=async(path='',size={width:1440,height:900},init)=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));if(init)await p.addInitScript(init);await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 const f=await fresh(),at=s=>f.locator(s).first(),rect=s=>at(s).evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,height:r.height,width:r.width}});
 const clipped=s=>at(s).evaluate(e=>e.getBoundingClientRect().width<=1||e.closest('.conversation-header').getBoundingClientRect().width<=1),txt=s=>at(s).textContent();
 // WHOLE-1: Control + B folds the sidebar into a 48 pixel rail of icons, and the browser remembers it.
 await f.evaluate(()=>openBoard('workspace'));await f.locator('body').click({position:{x:700,y:600}});await f.keyboard.press('Control+b');
 check(Math.round((await rect('#sidebar')).width)===48,'Control and B fold the sidebar into a 48 pixel rail');
 check(!await at('#repo-tree').isVisible()&&await at('[data-system-page="machines"]').isVisible()&&await at('#home-link').isVisible()&&(await at('#home-link').getAttribute('title'))==='Home','The rail keeps Home and the service pages as icons, with their names on hover');
 check(await at('#collapse-sidebar').getAttribute('aria-expanded')==='false','The collapse button says the navigation is folded');
 await f.reload();await f.waitForFunction(()=>window.lgcodeReady);
 check(Math.round((await rect('#sidebar')).width)===48,'The rail is remembered in this browser');
 await at('#collapse-sidebar').click();check((await rect('#sidebar')).width>200,'The collapse button opens the sidebar again');
 await f.evaluate(()=>{openBoard('workspace');document.querySelector('[data-main-view="terminal"]').click()});await at('#terminal-command').focus();await f.keyboard.press('Control+b');
 check((await rect('#sidebar')).width>200,'Control and B stay with a program in the terminal');
 // WHOLE-1 and TYPE-3: Home and Chat repeat no title; a sprint keeps its 15 pixel title.
 await f.evaluate(()=>openHome());check(await clipped('#view-title')&&(await txt('#view-title'))==='Home','Home shows no title under the top bar that already names it');
 check(await at('[data-home-new-project]').isVisible(),'Home keeps New project, in its tab row');
 for(const page2 of ['machines','alerts']){await f.evaluate(s=>document.querySelector(`[data-system-page="${s}"]`).click(),page2);check(await clipped('#view-title'),`${page2} shows no title under the top bar`)}
 await f.evaluate(()=>openBoard('workspace'));check(await clipped('#view-title')&&await at('#participants').isVisible(),'The board keeps its summary line without repeating the project name');
 await f.evaluate(()=>openSprint('sp-02'));check(await at('#view-title').evaluate(e=>e.getBoundingClientRect().width>1&&getComputedStyle(e).fontSize==='15px'),'A sprint keeps its own title at 15 pixels');
 // WHOLE-1: the branch shows once, in the top bar.
 await f.evaluate(()=>openBoard('workspace'));
 const branchPlaces=await f.evaluate(()=>[...document.querySelectorAll('#sidebar,#conversation-header,#composer-wrap,#context-toggle')].filter(e=>e.textContent.includes('feat/workspace')).map(e=>e.id));
 check(branchPlaces.join()==='context-toggle','The branch shows once, in the top bar: '+branchPlaces.join());
 // TAB-4: Chat has one 32 pixel line under the tabs with the agent, its role, and its status.
 await f.evaluate(()=>openAgent('rowan','workspace'));
 const line=await rect('#conversation-header'),tabs=await rect('#workspace-tabs'),lineText=await txt('#conversation-header');
 check(Math.round(line.height)===32&&line.top>=tabs.bottom-1,'The chat header is one 32 pixel line under the tabs: '+line.height);
 check(lineText.includes('Rowan')&&lineText.includes('Team lead')&&lineText.includes('Needs answer'),'The chat line names the agent, its role, and its status');
 // SIDE-2: rows are one line of 28 pixels, and only the selected project shows its lead.
 await f.evaluate(()=>{expandedProjects.add('recovery');openBoard('workspace')});
 check(Math.round((await rect('.project-heading:has([data-project="recovery"])')).height)===28,'A project row is one line of 28 pixels');
 check(await f.locator('.project-lead').count()===1&&(await txt('.project-select[data-project="workspace"] .project-lead'))==='Sage leads','Only the selected project shows its lead');
 check(await f.locator('.system-nav button').evaluateAll(bs=>bs.every(b=>Math.round(b.getBoundingClientRect().height)===40&&!b.textContent.replace(/\d/g,'').trim()))&&new Set(await f.locator('.system-nav button').evaluateAll(bs=>bs.map(b=>Math.round(b.getBoundingClientRect().top)))).size===1,'Service pages are one row of 40 pixel icons');
 // SIDE-3: the color mode is in Service settings as Light, Dark, and Match system.
 check(await f.locator('#sidebar [data-theme-choice]').count()===0&&await at('#design-notes').isVisible(),'The sidebar has no color mode row, and Design notes keeps its button');
 await f.evaluate(()=>document.querySelector('[data-system-page="settings"]').click());
 const choices=await f.locator('[data-theme-choice]').allTextContents();
 check(choices.join()==='Light,Dark,Match system'&&(await txt('.theme-choice')).match(/Field|Dusk/)===null,'Appearance offers Light, Dark, and Match system, without the palette names');
 await at('[data-theme-choice="dark"]').click();
 check(await f.evaluate(()=>document.documentElement.dataset.theme==='dark'&&localStorage.getItem('lgcode-theme')==='dark')&&await at('[data-theme-choice="dark"]').getAttribute('aria-pressed')==='true','Choosing Dark applies and remembers it');
 await f.emulateMedia({colorScheme:'light'});await at('[data-theme-choice="system"]').click();
 check(await f.evaluate(()=>document.documentElement.dataset.theme==='light'&&localStorage.getItem('lgcode-theme')===null),'Match system follows the device and forgets the manual choice');
 await f.emulateMedia({colorScheme:'dark'});await f.waitForTimeout(50);check(await f.evaluate(()=>document.documentElement.dataset.theme==='dark'),'Match system keeps following the device');
 await f.evaluate(()=>setTheme('light'));
 // SIDE-4: only the current row is filled; its ancestors are bold, and a row is one hover target.
 await f.evaluate(()=>openTeam('app-shell','workspace'));
 const fills=await f.evaluate(()=>{const bg=s=>getComputedStyle(document.querySelector(s)).backgroundColor,w=s=>getComputedStyle(document.querySelector(s)).fontWeight;return {team:bg('.team-heading:has([data-team="app-shell"])'),project:bg('.project-heading:has([data-project="workspace"])'),weight:w('.project-select[data-project="workspace"] .project-label')}});
 check(fills.team!=='rgba(0, 0, 0, 0)'&&fills.project==='rgba(0, 0, 0, 0)'&&fills.weight==='600','A selected team fills its own row, and its project is bold without a fill');
 await at('.project-heading:has([data-project="recovery"]) .project-select').hover();
 check(await f.evaluate(()=>{const h=document.querySelector('.project-heading:has([data-project="recovery"])');return getComputedStyle(h).backgroundColor!=='rgba(0, 0, 0, 0)'&&[...h.querySelectorAll('button')].every(b=>getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')}),'A hovered project row is one surface, with no seam between its parts');
 // SIDE-5: a project with no teams has no disclosure and no tree line.
 await f.evaluate(()=>{expandedRepos.add('atlas-docs');expandedProjects.add('docs');renderSidebar()});
 check(await f.locator('[data-project-toggle="docs"]').count()===0&&await f.locator('#project-docs').count()===0,'A project with no teams has no disclosure and no tree line');
 // REPO-2: the selected repository uses the same fill as a selected project.
 await f.evaluate(()=>openRepository('lgcode'));
 check(await f.evaluate(()=>{const h=document.querySelector('.repo-heading:has([data-open-repo="lgcode"])'),d=document.createElement('i');d.style.color='var(--color-selected)';document.body.append(d);const c=getComputedStyle(d).color;d.remove();return getComputedStyle(h).backgroundColor===c&&h.getBoundingClientRect().height>=28}),'The selected repository fills its whole row');
 // TOP-1: every place in the top bar opens.
 await f.evaluate(()=>openAgent('rowan','workspace'));
 check(await f.locator('#breadcrumb button').count()===3,'The repository, project, and team in the top bar are buttons');
 await at('#breadcrumb [data-crumb-team]').click();check(await f.evaluate(()=>state.view==='chat'&&state.teamId==='app-shell'&&!state.agentId),'The team in the top bar opens the team');
 await at('#breadcrumb [data-crumb-project]').click();check(await f.evaluate(()=>state.view==='board'&&state.projectId==='workspace'),'The project in the top bar opens its board');
 await at('#breadcrumb [data-crumb-repo]').click();check(await f.evaluate(()=>state.view==='repository'&&state.repoId==='lgcode'),'The repository in the top bar opens its projects');
 // TOP-2 and PICKER-1: the picker says Inspecting, points down, and lists one line per worktree.
 await f.evaluate(()=>openBoard('workspace'));
 check((await txt('.context-label'))==='Inspecting'&&(await at('#context-toggle svg:last-child').innerHTML()).includes('m6 9 6 6 6-6'),'The picker says Inspecting and its chevron points down');
 await at('#context-toggle').click();
 const rows=await f.locator('.workspace-option').evaluateAll(es=>es.map(e=>({h:Math.round(e.getBoundingClientRect().height),text:e.textContent,depth:e.className.match(/depth-(\d)/)[1],left:e.querySelector('.ws-label').getBoundingClientRect().left})));
 check(rows.every(r=>r.h===32),'Each worktree is one line of 32 pixels');
 const mains=rows.filter(r=>r.text.startsWith('Main checkout'));
 check(mains.length===2&&mains.some(r=>r.text.includes('Studio'))&&mains.some(r=>r.text.includes('Buildbox')),'Two main checkouts are told apart by their machines');
 check(rows.some(r=>r.depth==='1'&&r.text.startsWith('Build team'))&&rows.find(r=>r.depth==='1').left>rows.find(r=>r.depth==='0').left,'Team worktrees are indented under their project');
 check(await f.locator('#context-menu footer').count()===0&&await at('#workspace-search').evaluate(e=>e===document.activeElement),'The picker opens on a search field and has no footer');
 await f.keyboard.type('review');check(await f.locator('.workspace-option').count()===1&&(await txt('.workspace-option')).includes('feat/workspace/review'),'Search narrows the worktrees');
 check(await at('.workspace-option code').evaluate(e=>getComputedStyle(e).direction==='rtl'),'A long branch is cut at its start, keeping the end');
 await f.keyboard.press('Escape');
 // TAB-1: Tasks comes last, so no shared tab moves when a team is selected.
 const lefts=async()=>f.locator('#workspace-tabs [role=tab]').evaluateAll(ts=>ts.map(t=>t.textContent+':'+Math.round(t.getBoundingClientRect().left)));
 await f.evaluate(()=>openAgent('sage','workspace'));const project=await lefts();await f.evaluate(()=>openTeam('app-shell','workspace'));const team=await lefts();
 check(team.at(-1).startsWith('Tasks')&&project.every((t,i)=>team[i]===t),'Tasks is the last tab, and no shared tab moves for it: '+team.join(' '));
 // ALERT-1: phone notifications are named for where they go.
 await f.evaluate(()=>document.querySelector('[data-system-page="alerts"]').click());
 check((await txt('#breadcrumb'))==='Phone notifications'&&(await at('[data-system-page="alerts"]').getAttribute('aria-label')).startsWith('Phone notifications')&&!(await txt('#view-body')).includes('Alert'),'Alerts are named Phone notifications everywhere');
 // QUICK-1: names only, prefix first, 36 pixel rows with attention, and no header.
 await f.evaluate(()=>showQuickOpen());await f.locator('#quick-search').fill('ro');
 check((await txt('#quick-results [role=option] strong'))==='Rowan','A name that starts with the query comes first');
 check(!(await f.locator('#quick-results [role=option] strong').allTextContents()).includes('Agent console'),'The switcher matches names only, not kinds');
 check(Math.round((await rect('#quick-results [role=option]')).height)===36&&(await txt('#quick-results [role=option] .attention-number'))==='1','Switcher rows are 36 pixels and show what needs attention');
 check(await f.locator('#quick-dialog header,#quick-dialog [data-close]').count()===0,'The switcher has no header and no close button');
 await f.keyboard.press('Escape');check(!await at('#quick-dialog').isVisible(),'Escape closes the switcher');
 // NOTES-1: Design notes is titled for what it is, with its previews grouped.
 await at('#design-notes').click();
 check((await txt('#notes-title'))==='Design notes'&&(await f.locator('#notes h3').allTextContents()).filter(h=>['Session','Connection','Requests'].includes(h)).length===3,'Design notes groups its previews as Session, Connection, and Requests');
 await at('#notes footer [data-close]').click();await f.close();
 // SIDE-6: after a navigation, the current row sits clear of the bottom fade.
 const h=await fresh('?sample=heavy',{width:1440,height:800});
 await h.evaluate(()=>{repositories.forEach(r=>expandedRepos.add(r.id));projects.forEach(p=>expandedProjects.add(p.id));const last=projects.at(-1);openAgent((last.teams.at(-1)?.agents.at(-1)||last.lead).id,last.id)});await h.waitForTimeout(60);
 const clear=await h.evaluate(()=>{const t=document.querySelector('#repo-tree').getBoundingClientRect(),r=document.querySelector('#repo-tree .current').getBoundingClientRect();return t.bottom-r.bottom});
 check(clear>=43,'The current row sits 8 pixels above the tree fade: '+Math.round(clear));
 await h.close();
 // The phone drawer still opens and closes.
 const phone=await fresh('',{width:390,height:844});
 await phone.locator('#menu').click();check(await phone.locator('#sidebar').isVisible()&&!await phone.locator('#collapse-sidebar').isVisible(),'The phone drawer opens, without the rail button');
 await phone.keyboard.press('Escape');check(!await phone.locator('#sidebar').isVisible(),'Escape closes the phone drawer');
 await phone.close();
});

// Connection, the bell, and empty states, from the designer's critique of 2026-11-06. The connection itself is in operations-checks.
await run('bell, terminal notice, and empty states',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 // TERM-3: the reconnect notice sits in the terminal's own bar, so the grid keeps its rows.
 const f=await fresh();await f.evaluate(()=>{openBoard('workspace');document.querySelector('[data-main-view="terminal"]').click()});await f.evaluate(async()=>{const s=getComputedStyle(document.querySelector('#terminal-screen'));await document.fonts.load(s.fontSize+' '+s.fontFamily)});await f.waitForTimeout(150);
 const size=await f.locator('#terminal-size').textContent();
 await f.evaluate(()=>document.querySelector('[data-preview="reconnect"]').click());await f.waitForTimeout(100);
 check((await f.locator('#terminal-size').textContent())===size&&await f.locator('.terminal-top .terminal-paused').isVisible()&&await f.locator('#terminal-screen .terminal-paused').count()===0,'The reconnect notice sits in the terminal bar, and the grid keeps its size: '+size);
 check(Math.round(await f.locator('.terminal-top').evaluate(e=>e.getBoundingClientRect().height))===36,'The terminal bar keeps its height with the notice');
 await f.evaluate(()=>document.querySelector('[data-preview="live"]').click());
 // EMPTY-1: a filtered Home is one sentence and one action, and a sprint shows no empty evidence section.
 await f.evaluate(()=>openHome());await f.locator('#home-search').fill('nothing matches this');
 check((await f.locator('.home-empty h2').textContent())==='No matching requests.'&&await f.locator('.home-empty p').count()===0&&await f.locator('.home-empty button').count()===1,'A filtered empty Home is one sentence and one action');
 await f.locator('.home-empty [data-home-clear]').click();check(await f.locator('[data-home-item]').count()>0&&(await f.locator('#home-search').inputValue())==='','Its action clears the filters');
 await f.evaluate(()=>openSprint('sp-02'));check(!(await f.locator('#view-body').textContent()).includes('Completion evidence'),'An unfinished sprint shows no empty evidence section');
 await f.evaluate(()=>openSprint('sp-01'));check((await f.locator('#view-body').textContent()).includes('Completion evidence'),'A merged sprint shows its evidence');
 await f.close();
 // BELL-1: Home's kinds and order, 44 pixel rows with the age, at most six rows, and View all with the count.
 const h=await fresh('?sample=heavy');await h.locator('#attention-toggle').click();
 const rows=await h.locator('.attention-row').evaluateAll(rs=>rs.map(r=>({h:Math.round(r.getBoundingClientRect().height),kind:r.querySelector('.attention-kind').textContent,age:r.querySelector('time').textContent}))),count=Number(await h.locator('#attention-count').textContent());
 check(count>6&&rows.length===6&&rows.every(r=>r.h===44&&r.age),'The bell shows six rows of 44 pixels, each with its age');
 check((await h.locator('#attention-home').textContent()).trim()==='View all '+count,'The bell ends with View all and the count');
 check(rows.every(r=>['Question','Approval','Merge','Failed start'].includes(r.kind)),"The bell uses Home's kind names");
 const minutes=t=>(+(t.match(/(\d+) day/)?.[1]||0))*1440+(+(t.match(/(\d+) hr/)?.[1]||0))*60+(+(t.match(/(\d+) min/)?.[1]||0)),rest=rows.filter(r=>r.kind!=='Failed start');
 check(rows[0].kind==='Failed start'&&rows.findIndex(r=>r.kind!=='Failed start')===rows.length-rest.length&&rest.every((r,i)=>!i||minutes(rest[i-1].age)>=minutes(r.age)),'The bell lists failed starts first, then the longest wait: '+rows.map(r=>r.age).join(', '));
 check(await h.evaluate(()=>typeof byAttention==='function'&&attentionQueue().length===Number(document.querySelector('#attention-count').textContent)),'Home and the bell can share one order, byAttention');
 await h.close();
});

// STATUS-3 and HOME-8: one request block for questions, approvals, and failed starts, in threads and on Home.
await run('request block',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 for(const theme of ['light','dark'])for(const width of [390,1440]){const t=await fresh('',{width,height:900});await t.evaluate(x=>setTheme(x),theme);
  const tone=v=>t.evaluate(v=>{const d=document.createElement('i');d.style.color=v;document.body.append(d);const c=getComputedStyle(d).color;d.remove();return c},v);
  const shape=async(agent,project)=>{await t.evaluate(([a,p])=>openAgent(a,p),[agent,project]);await t.waitForTimeout(60);return t.locator('#view-body .request').first().evaluate(e=>{const r=e.getBoundingClientRect(),turn=document.querySelector('#view-body .turn:not(.user-turn)')?.getBoundingClientRect()||document.querySelector('#view-body').getBoundingClientRect(),s=getComputedStyle(e);return {left:Math.round(r.left),width:Math.round(r.width),turnLeft:Math.round(turn.left),turnWidth:Math.round(turn.width),rule:s.borderLeftStyle+' '+s.borderLeftWidth,ruleColor:s.borderLeftColor,top:s.borderTopStyle,label:e.querySelector('.request-label').textContent,labelColor:getComputedStyle(e.querySelector('.request-label')).color}})};
  const q=await shape('rowan','workspace'),a=await shape('iris','workspace'),f=await shape('ash','recovery'),warn=await tone('var(--color-warn)'),error=await tone('var(--color-error)');
  check([q,a,f].every(s=>s.rule==='solid 2px'&&s.top==='none'),`${theme} ${width}: questions, approvals, and failed starts have one left rule and no top rule`);
  check([q,a].every(s=>s.left===s.turnLeft&&s.width===s.turnWidth)&&q.width===a.width,`${theme} ${width}: a question and an approval span the same thread width: ${q.left}/${q.width}, ${a.left}/${a.width}`);
  check(q.label.startsWith('Question')&&a.label==='Approval'&&f.label==='Failed start',`${theme} ${width}: the label names the kind`);
  check(q.ruleColor===warn&&a.ruleColor===warn&&q.labelColor===warn&&f.ruleColor===error&&f.labelColor===error,`${theme} ${width}: the rule and label are amber for a question or approval and red for a failed start`);
  await t.close()}
 const t=await fresh();await t.evaluate(()=>openAgent('iris','workspace'));await t.waitForTimeout(60);const p=t.locator('#permission-perm-iris');
 check(await p.locator('.request-fields dt').allTextContents().then(x=>x.join()==='Command,Folder')&&!(await p.innerText()).includes('Request:')&&!(await p.innerText()).includes('call-iris'),'HOME-8: The thread permission shows Command and Folder and hides identifiers');
 await p.locator('.request-details summary').click();check((await p.innerText()).includes('call-iris')&&(await p.locator('.request-details pre').textContent()).includes('"command"'),'HOME-8: Details shows the identifiers and the raw input');
 await t.evaluate(()=>openHome('approvals'));await t.locator('[data-home-item="approval:perm-iris"]').click();check(await t.locator('#home-detail .request.is-approval').count()===1,'STATUS-3: Home expands the same request block');
 await t.close();
});

// COMP-1, COMP-3 to COMP-6, THREAD-3 to THREAD-6, BOARD-4, and CTX-1: the composer, Add context, and what a thread shows besides messages.
await run('composer and threads',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 const t=await fresh();const at=s=>t.locator(s).first();
 const shape=()=>t.evaluate(()=>{const f=document.querySelector('#message-form').getBoundingClientRect(),w=getComputedStyle(document.querySelector('#composer-wrap'));return {height:Math.round(f.height),rule:w.borderTopWidth+' '+w.borderTopStyle,tools:!!document.querySelector('#message-form .composer-tools #send-message')}});
 await t.evaluate(()=>openAgent('iris','workspace'));await t.waitForTimeout(40);const chat=await shape();
 await t.evaluate(()=>openBoard('workspace'));await t.waitForTimeout(40);const lead=await shape();
 check(chat.height>=70&&chat.height<=80&&lead.height===chat.height&&chat.tools&&lead.tools,`COMP-1: the composer is one input over one tool row, about 76 pixels, in Chat and the lead panel: ${chat.height}, ${lead.height}`);
 check(await t.locator('#recipient-label, #composer-worktree, .composer-meta').count()===0,'COMP-1: the composer has no recipient line and no worktree line');
 check(chat.rule==='1px solid'&&lead.rule==='1px solid','COMP-4: Chat and the lead panel both draw a top rule above the composer');
 await t.evaluate(()=>openProject('desktop'));await t.waitForTimeout(40);
 check(await t.locator('#lead-agent-controls').isHidden()&&await t.locator('[data-agent-command="stop"]').count()===0,'BOARD-4: an idle lead shows no status line and no Stop');
 await t.evaluate(()=>openAgent('iris','workspace'));await t.waitForTimeout(40);
 check(await at('#agent-controls').isVisible()&&(await at('#agent-controls').textContent()).includes('Waiting for approval')&&await at('#agent-controls [data-agent-command="stop"]').isVisible(),'BOARD-4: an agent waiting on a tool shows its status and Stop');
 const account=await at('#composer-account').textContent();
 check(account==='Codex · Personal'&&!account.includes('Host profile'),'COMP-3: the subscription shows its own name: '+account);
 check((await at('#composer-model').textContent())==='GPT-6'&&(await at('#composer-effort').textContent())==='Medium'&&/^\d+% context$/.test(await at('#context-use').textContent()),'COMP-3: the tool row shows the model, the effort, and the context in use');
 const fit=await t.locator('.composer-tools .tool-menu:not([hidden])').evaluateAll(bs=>bs.map(b=>{const s=b.querySelector('span').getBoundingClientRect(),c=b.querySelector('svg').getBoundingClientRect();return {gap:Math.round(c.left-s.right),fits:b.scrollWidth<=b.clientWidth}}));
 check(fit.length===3&&fit.every(x=>x.fits&&x.gap<=8),'COMP-6: each menu button fits its label, with no gap before its chevron: '+JSON.stringify(fit));
 const before=await t.evaluate(()=>api.debug.events().length);
 await at('#composer-model').click();check(await at('#tool-menu').evaluate(m=>m.matches(':popover-open'))&&(await at('#composer-model').getAttribute('aria-expanded'))==='true','COMP-3: the model button opens its menu');
 await t.keyboard.press('Escape');check(await t.evaluate(()=>document.activeElement.id)==='composer-model','COMP-3: Escape closes the menu and returns to its button');
 await at('#composer-model').click();await t.keyboard.press('ArrowDown');await t.keyboard.press('Enter');
 const chosen=await t.evaluate(b=>api.debug.events().slice(b).map(r=>r.event_type+' '+r.payload_json),before);
 check((await at('#composer-model').textContent())==='GPT-6 Luna'&&chosen.some(r=>r.startsWith('project.ModelChosen')&&r.includes('gpt-6-luna')),'COMP-3: choosing a model stores it for the agent through the data layer');
 await t.evaluate(()=>openBoard('workspace'));await t.evaluate(()=>openAgent('iris','workspace'));check((await at('#composer-model').textContent())==='GPT-6 Luna','COMP-3: the agent keeps its model when the thread is opened again');
 // CTX-1
 await at('#attach-context').click();const rows=await t.locator('#context-items label').evaluateAll(ls=>ls.map(l=>Math.round(l.getBoundingClientRect().height)));
 check(await at('#context-search').evaluate(e=>e===document.activeElement)&&(await t.locator('.context-group h3').allTextContents()).join()==='Tasks,Files'&&rows.every(h=>h===32),'CTX-1: Add context opens on a search field, with Tasks and Files groups and rows of 32 pixels');
 await at('#context-search').fill('sidebar');check(await t.locator('#context-items label:not([hidden])').count()===1&&await t.locator('.context-group:not([hidden]) h3').allTextContents().then(x=>x.join()==='Files'),'CTX-1: search narrows the list and hides an empty group');
 await at('#context-search').fill('zzzz');check(await at('.context-none').isVisible(),'CTX-1: a search with no match says so');
 await t.locator('#attach-dialog [data-close]').last().click();
 await at('#message-input').fill('');await at('#message-input').pressSequentially('See @');check(await at('#attach-dialog').evaluate(d=>d.open),'CTX-1: typing @ opens Add context');
 await t.locator('[data-context-item="task:SH-15"]').check();await at('#apply-context').click();
 check((await at('#message-input').inputValue())==='See '&&(await at('#composer-context').textContent()).includes('SH-15'),'CTX-1: adding context removes the @ that opened it and attaches the item');
 // THREAD-3 and THREAD-4
 check(await t.locator('#view-body .thread-detail[data-tool-call]').count()===0&&await t.locator('#permission-perm-iris [data-tool-call="call-iris"]').count()===1,'THREAD-3: the tool call sits inside its approval, so the command shows once');
 const delivery=await at('[data-delivery="delivery-iris"]').evaluate(d=>{const s=d.querySelector('summary'),cs=getComputedStyle(s),m=document.createElement('i');m.style.color='var(--color-muted)';document.body.append(m);const muted=getComputedStyle(m).color;m.remove();return {text:s.textContent,size:cs.fontSize,muted:cs.color===muted,open:d.open}});
 check(delivery.text==='Delivery details'&&delivery.size==='12px'&&delivery.muted&&!delivery.open,'THREAD-3: delivery history is a muted 12 pixel Details disclosure: '+JSON.stringify(delivery));
 await t.evaluate(()=>{api.debug.emit('DeliveryReturned',{agentId:'iris',deliveryId:'delivery-iris',sender:{_tag:'owner'},reason:'session ended'});render()});
 check((await at('[data-delivery="delivery-iris"]').textContent()).includes('Message not delivered')&&await at('[data-delivery="delivery-iris"]').evaluate(d=>d.open&&d.classList.contains('delivery-failed')),'THREAD-3: a returned message shows its delivery history open, as a failure');
 check((await at('#large-item-iris h3').textContent()).replace(/\s+/g,' ')==='Review trace (192 kilobytes)'&&!(await at('#large-item-iris').textContent()).includes('Large thread item'),'THREAD-3: a large item is named by its content and size');
 await at('[data-load-large="iris"]').click();await t.waitForTimeout(80);
 check(await at('#large-item-iris [data-open-large]').isVisible()&&await at('#large-item-iris [data-copy-large]').isVisible()&&await at('#large-item-iris pre').evaluate(e=>e.scrollHeight<=e.clientHeight+1),'THREAD-4: a loaded item offers Open in full and Copy, with no nested scroller');
 await at('[data-open-large="iris"]').click();check(await at('#large-text-iris').evaluate(e=>getComputedStyle(e).overflowY==='visible'&&getComputedStyle(e).maxHeight==='none')&&await at('#composer-wrap').isHidden()&&await t.evaluate(()=>document.activeElement.id)==='large-full-title','THREAD-4: Open in full fills the main area with one plain block');
 await at('[data-close-large]').click();check(await at('#large-item-iris').isVisible()&&await at('#message-input').isVisible(),'THREAD-4: the link back returns to the thread');
 await t.close();
 // COMP-5 and THREAD-5
 const s=await fresh();const sat=x=>s.locator(x).first();
 await s.evaluate(()=>openAgent('ash','recovery'));await s.waitForTimeout(40);
 check(await sat('#message-form').isHidden()&&(await sat('#agent-controls .composer-halt').textContent()).includes('Ash failed to start')&&await sat('#agent-controls [data-sign-in-agent="ash"]').evaluate(b=>b.classList.contains('primary'))&&await sat('#agent-controls [data-agent-command="resume"]').isVisible(),'COMP-5: a failed agent shows its state, Sign in, and Resume in place of the input');
 check(await s.locator('#view-body .request.is-failed button').count()===0,'COMP-5: the failed-start record in the thread does not repeat the controls');
 await s.evaluate(()=>openAgent('rowan','workspace'));await s.waitForTimeout(40);await sat('#message-input').fill('Keep this draft');
 await sat('#agent-controls [data-agent-command="stop"]').click();if(await s.locator('#stop-dialog[open]').count())await sat('#confirm-stop-agent').click();
 const resume=sat('#agent-controls .composer-halt [data-agent-command="resume"]');
 check(await sat('#message-form').isHidden()&&await resume.evaluate(b=>b.classList.contains('primary')&&b.getBoundingClientRect().height>=32)&&(await sat('#agent-controls').textContent()).includes('Your draft is kept'),'THREAD-5: a stopped agent offers Resume as a primary button in place of the input, and keeps the draft');
 const row=await sat('#sidebar [data-agent="rowan"]').evaluate(b=>({title:b.title,dot:b.querySelector('.dot').className,text:b.querySelector('small').textContent}));
 check(row.title.startsWith('Stopped · Needs answer')&&row.dot.includes('stopped')&&row.dot.includes('wait')&&row.text.endsWith('Needs answer'),'THREAD-5: a stopped row with a waiting question says both states: '+JSON.stringify(row));
 await resume.click();check((await sat('#message-input').inputValue())==='Keep this draft'&&await sat('#message-input').isVisible(),'COMP-5: Resume brings the input back with the draft');
 // THREAD-6
 await s.evaluate(()=>openAgent('finch','workspace'));await sat('#design-notes').click();await sat('[data-preview="held-permission"]').click();await s.waitForTimeout(40);
 check((await sat('#permission-perm-finch').textContent()).includes('Held by Sage, the project lead')&&await sat('#permission-perm-finch [data-project-chat="workspace"]').isVisible(),'THREAD-6: a held request names its holder with a link');
 check((await sat('#sidebar [data-agent="finch"] small').textContent())==='Waiting on Sage'&&(await sat('#agent-controls').textContent()).includes('Waiting on Sage'),'THREAD-6: the sidebar and the composer agree that Finch waits on Sage');
 await s.evaluate(()=>openAgent('iris','workspace'));await sat('#design-notes').click();await sat('[data-preview="large-failure"]').click();await sat('[data-load-large="iris"]').click();
 check((await sat('#large-item-iris [data-load-large]').textContent())==='Retry','THREAD-6: a failed large item offers Retry, with no arrow');
 await s.close();
 // Phones and the drawer keep every control in view.
 for(const width of [390,768]){const m=await fresh('',{width,height:844});await m.evaluate(()=>openAgent('iris','workspace'));await m.waitForTimeout(40);
  const over=await m.evaluate(()=>[...document.querySelectorAll('.composer-tools > :not([hidden])')].filter(e=>e.scrollWidth>e.clientWidth+1||e.getBoundingClientRect().right>document.querySelector('#message-form').getBoundingClientRect().right).map(e=>e.id));
  check(over.length===0&&await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`COMP-3: at ${width} pixels every tool fits the composer: ${over}`);await m.close()}
});

await run('board, sprint, task, tables, and wide screens',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 const t=await fresh();const at=s=>t.locator(s).first();
 // BOARD-1, BOARD-2, and BOARD-3
 await t.evaluate(()=>openBoard('workspace'));await t.waitForTimeout(40);
 const card=await at('.sprint-card[data-sprint="sp-02"]').evaluate(c=>{const warn=document.createElement('i');warn.style.color='var(--color-warn)';document.body.append(warn);const w=getComputedStyle(warn).color;warn.remove();const goal=c.querySelector('.sprint-goal');return {first:c.firstElementChild.className,rule:getComputedStyle(c).borderLeftColor===w&&getComputedStyle(c).boxShadow.includes(w.replace(/\s/g,'').replace('rgb(','rgb(')),oneLine:getComputedStyle(goal).whiteSpace==='nowrap'&&goal.getBoundingClientRect().height<24,owner:c.querySelector('.sprint-owner strong')?.textContent,id:c.querySelector('.sprint-id').textContent}});
 check(card.first==='sprint-note'&&card.oneLine&&card.owner==='Rowan'&&card.id.startsWith('SP-02'),'BOARD-1: a card leads with its attention line, then its identifier, a one-line goal, and its owner: '+JSON.stringify(card));
 check(await at('.sprint-card[data-sprint="sp-02"]').evaluate(c=>{const s=getComputedStyle(c);return s.borderLeftColor===s.color||s.boxShadow!=='none'})&&await t.locator('.sprint-card.needs-attention').count()===2,'BOARD-1: the two cards that need the owner wear an amber left rule');
 check(await at('.sprint-card[data-sprint="sp-04"]').evaluate(c=>!c.querySelector('.sprint-progress')&&!/0\/\d/.test(c.textContent)&&c.textContent.includes('1 task')),'BOARD-1: a sprint with no finished task shows its task count without an empty bar');
 check(await t.locator('.column-heading .dot').count()===0,'BOARD-3: column headings have no dot');
 check(await t.locator('#expand-lead-chat').count()===0&&await at('#close-lead-panel').isHidden()&&await t.locator('#tab-row #lead-toggle').isVisible(),'BOARD-2: the toggle at the end of the tab row is the panel’s only open and close control');
 // SPRINT-1 and SPACE-2
 await t.evaluate(()=>openSprint('sp-02'));await t.waitForTimeout(40);
 const sprint=await t.evaluate(()=>{const body=document.querySelector('#view-body'),blockers=body.querySelector('.detail-blockers'),summary=body.querySelector('.detail-summary');return {line:document.querySelector('#participants').textContent,first:!!blockers&&!!(blockers.compareDocumentPosition(summary)&Node.DOCUMENT_POSITION_FOLLOWING),question:!!blockers?.querySelector('#request-nav-decision [data-resolve-request]'),approval:!!blockers?.querySelector('#permission-perm-iris [data-permission-answer]'),plan:[...body.querySelectorAll('dt')].some(d=>d.textContent==='Plan'),primaries:body.querySelectorAll('.primary').length,blocked:[...body.querySelectorAll('.task-list tr')].find(r=>r.textContent.includes('SH-15'))?.querySelector('.task-status').textContent}});
 check(sprint.line.includes('In progress')&&sprint.line.includes('2 requests need you'),'SPRINT-1: the sprint’s status and blockers are in the line under its title: '+sprint.line);
 check(sprint.first&&sprint.question&&sprint.approval&&!sprint.plan&&sprint.primaries===1,'SPRINT-1: the question and the approval come first and can be answered there, with one primary button and no Plan line: '+JSON.stringify(sprint));
 check(sprint.blocked==='Blocked by an approval','SPRINT-1: a task blocked by its owner’s approval says so');
 const base=await t.evaluate(()=>{const h=document.querySelector('.detail-section .section-heading'),r=document.createRange(),rect=n=>{r.selectNodeContents(n);return r.getBoundingClientRect().bottom};const b=h.querySelector('#add-task'),text=[...b.childNodes].find(n=>n.nodeType===3);return Math.abs(rect(h.querySelector('h2'))-rect(text))});
 check(base<=2,'SPACE-2: Add task sits on its heading’s baseline: '+base);
 await at('#request-nav-decision [data-resolve-request]').click();await t.waitForTimeout(40);
 check(await t.evaluate(()=>state.view==='sprint'&&!document.querySelector('#request-nav-decision')),'SPRINT-1: answering on the sprint page records the answer and keeps the page');
 // TASK-1
 await t.evaluate(()=>openTask('SH-15'));await t.waitForTimeout(40);
 const task=await t.evaluate(()=>{const talk=document.querySelector('.page-actions [data-talk-agent="iris"]'),path=document.querySelector('.detail-sidebar code.tail[title*=".worktrees"]');return {top:talk.getBoundingClientRect().top,right:innerWidth-talk.getBoundingClientRect().right,times:document.querySelectorAll('.task-timeline li time').length,steps:document.querySelectorAll('.task-timeline li').length,owner:!!document.querySelector('.detail-sidebar [data-talk-agent="iris"]'),cut:path&&path.scrollWidth>path.clientWidth&&getComputedStyle(path).direction==='rtl'&&path.title.endsWith('workspace-app-shell'),dts:[...document.querySelectorAll('.detail-sidebar dt')].map(d=>d.textContent)}});
 check(task.top<240&&task.right<40,'TASK-1: Talk to Iris sits at the top right of the page: '+JSON.stringify(task));
 check(task.times===task.steps&&task.steps>0,'TASK-1: every activity step has its time');
 check(task.owner&&task.cut&&!task.dts.includes('Task')&&!task.dts.includes('Status'),'TASK-1: the owner is a link, the folder is cut at its start with the full path on hover, and the metadata does not repeat the line under the title');
 // TEAMTASKS-1 and ROW-1
 await t.evaluate(()=>openTeam('app-shell','workspace','tasks'));await t.waitForTimeout(40);
 const team=await t.evaluate(()=>{const rows=[...document.querySelectorAll('.task-list tbody tr')].map(r=>r.getBoundingClientRect().height);return {left:document.querySelector('.task-list').getBoundingClientRect().left,tab:document.querySelector('#workspace-tabs [role=tab]').getBoundingClientRect().left,max:Math.max(...rows),heads:[...document.querySelectorAll('.task-list th')].map(h=>h.textContent)}});
 check(Math.abs(team.left-team.tab)<=2,'TEAMTASKS-1 and SPACE-2: team tasks start at the tab row’s left edge: '+JSON.stringify(team));
 check(team.max<=46&&team.heads.join()==='Task,Title,Status,Owner','ROW-1: team task rows are one line of at most 46 pixels, with identifier, title, status, and owner columns');
 await t.evaluate(()=>openHome('projects'));await t.waitForTimeout(40);
 const all=await t.evaluate(()=>({max:Math.max(...[...document.querySelectorAll('.project-table tbody tr')].map(r=>r.getBoundingClientRect().height)),heads:[...document.querySelectorAll('.project-table th')].map(h=>h.textContent)}));
 check(all.max<=46&&all.heads.includes('Lead')&&all.heads.includes('Branch'),'ROW-1: All projects rows are one line of at most 46 pixels, with lead and branch columns: '+JSON.stringify(all));
 await t.evaluate(()=>openRepository('lgcode'));await t.waitForTimeout(40);
 const repo=await t.evaluate(()=>({table:!!document.querySelector('#view-body .project-table'),max:Math.max(...[...document.querySelectorAll('.project-table tbody tr')].map(r=>r.getBoundingClientRect().height)),heads:[...document.querySelectorAll('.project-table th')].map(h=>h.textContent),text:document.querySelector('#main').textContent,recovery:document.querySelector('[data-project-inbox="recovery"]').textContent}));
 check(repo.table&&repo.max<=46&&!repo.heads.includes('Repository')&&repo.heads.includes('Stage'),'REPO-1: the repository page is the All projects table with the repository filtered: '+JSON.stringify(repo.heads));
 check(!repo.text.includes('One lead per project')&&!repo.text.includes('Each has its own lead')&&!repo.text.includes('Next step')&&repo.recovery.startsWith('Needs attention'),'REPO-1: no filler, and a project with a failed agent says Needs attention');
 // Leftovers from the composer batch: a lead's status counts its team's requests, and a held request leaves the bell.
 await t.evaluate(()=>openAgent('sage','workspace'));await t.waitForTimeout(40);
 const leadLine=await at('#participants .agent-state').textContent(),composerLine=await at('#agent-controls').textContent();check(/^Waiting on \d requests?$/.test(leadLine)&&composerLine.includes(leadLine),'A lead’s status line counts its team’s open requests, as the composer line does: '+leadLine);
 const before=Number(await at('#attention-count').textContent());await t.evaluate(()=>openAgent('finch','workspace'));await at('#design-notes').click();await at('[data-preview="held-permission"]').click();await t.waitForTimeout(40);
 check(Number(await at('#attention-count').textContent())===before-1,'A request held by the lead leaves the bell’s count');
 await t.evaluate(()=>openHome('attention'));await t.waitForTimeout(40);check(Number(await at('#home-tab-attention small').textContent())===before-1&&!(await at('#home-results').textContent()).includes('Read the review trace'),'A request held by the lead leaves Home’s Needs attention, so Home and the bell agree');
 // WHOLE-5: Git keeps the current agent's thread available, closed by default below 1801 pixels.
 await t.evaluate(()=>openAgent('iris','workspace'));await at('[data-main-view="source-control"]').click();await t.waitForTimeout(40);
 check(await at('#lead-toggle').isVisible()&&(await at('#lead-toggle').textContent()).includes('Iris')&&await at('#lead-panel').isHidden(),'WHOLE-5: Git offers Iris’s thread at 1440 pixels, closed until asked');
 await at('#lead-toggle').click();await t.waitForTimeout(40);
 check(await at('#lead-panel').isVisible()&&(await at('#lead-chat-title').textContent())==='Iris'&&await at('#lead-panel #message-input').isVisible()&&await t.locator('.git-workspace').isVisible(),'WHOLE-5: Iris’s thread docks beside Git with its composer');
 await t.evaluate(()=>openBoard('workspace'));await t.waitForTimeout(40);
 check(await at('#lead-panel').isVisible()&&(await at('#lead-chat-title').textContent())==='Sage','WHOLE-5: the board still opens with its lead beside it');
 await t.close();
 // WHOLE-2: above 1800 pixels the panel stays beside every project view, Chat shows the task and changed files, and cards stop at 300 pixels.
 for(const theme of ['light','dark']){const w=await fresh('',{width:2560,height:900});await w.evaluate(t=>{document.documentElement.dataset.theme=t},theme);const wat=s=>w.locator(s).first();
  const views={};for(const [name,go] of [['sprint',()=>{openBoard('workspace');openSprint('sp-02')}],['task',()=>{openBoard('workspace');openTask('SH-15')}],['terminal',()=>{openBoard('workspace');go({view:'terminal',tab:'chat'})}],['settings',()=>{openBoard('workspace');go({view:'workspace-settings',tab:'chat'})}],['git',()=>openGit('workspace-app-shell','workspace')],['team tasks',()=>openTeam('app-shell','workspace','tasks')]]){await w.evaluate(go);await w.waitForTimeout(30);views[name]=await wat('#lead-panel').isVisible()}
  check(Object.values(views).every(Boolean),`WHOLE-2: at 2560 pixels in ${theme} the thread panel stays open beside every project view: ${JSON.stringify(views)}`);
  await w.evaluate(()=>openAgent('iris','workspace'));await w.waitForTimeout(30);
  check(await wat('#lead-panel').isHidden()&&(await wat('#chat-context').textContent()).includes('SH-15')&&await w.locator('#chat-context [data-inspect-file]').count()===2,`WHOLE-2: at 2560 pixels in ${theme} Chat shows Iris’s task and changed files beside the thread`);
  await w.evaluate(()=>{for(let i=5;i<=7;i++)api.debug.emit('project.SprintAdded',{projectId:'workspace',sprintId:'sp-0'+i,label:'SP-0'+i,name:'Later work '+i,goal:'A later sprint.',phase:'Plan',owner:'rowan',needs:['sp-02']});openBoard('workspace')});await w.waitForTimeout(40);
  const cards=await w.evaluate(()=>[...document.querySelectorAll('.kanban-column[aria-label="Planned"] .sprint-card')].map(c=>{const r=c.getBoundingClientRect();return {w:r.width,top:Math.round(r.top)}}));
  check(cards.every(c=>c.w<=300)&&new Set(cards.map(c=>c.top)).size<cards.length&&await w.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`WHOLE-2: at 2560 pixels in ${theme} cards stop at 300 pixels and a busy column shows them side by side: ${JSON.stringify(cards)}`);
  await w.close()}
 // Narrow screens keep the drawer's close button, because the toggle is under the drawer.
 const m=await fresh('',{width:390,height:844});await m.evaluate(()=>openBoard('workspace'));await m.locator('#lead-toggle').click();
 check(await m.locator('#close-lead-panel').isVisible()&&await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'BOARD-2: the phone drawer keeps its close button');await m.close();
});

await run('git and the terminal',async()=>{
 const fresh=async(path='',size={width:1440,height:900})=>{const p=await browser.newPage({viewport:size});p.setDefaultTimeout(4000);p.on('pageerror',e=>errors.push(e.message));await p.goto(url+path);await p.waitForFunction(()=>window.lgcodeReady);return p};
 // GIT-2: 20 pixel diff rows, a 40 pixel worktree rail below 1600 pixels, and a commit pane that resizes from the keyboard.
 const g=await fresh();const at=s=>g.locator(s).first();
 await g.evaluate(()=>openBoard('workspace'));await at('[data-main-view="source-control"]').click();
 const row=await at('.unified-diff .diff-line.context').evaluate(e=>{const s=getComputedStyle(e);return {h:Math.round(e.getBoundingClientRect().height),pad:s.paddingTop+' '+s.paddingBottom}});
 check(row.h===20&&row.pad==='0px 0px','GIT-2: diff rows are 20 pixels with no row padding: '+JSON.stringify(row));
 check(Math.round((await at('.worktree-navigation').evaluate(e=>e.getBoundingClientRect().width)))===40&&await at('.worktree-navigation .wt-text').isHidden(),'GIT-2: below 1600 pixels the worktree list starts as a 40 pixel rail');
 await at('#worktree-fold').click();check(Math.round(await at('.worktree-navigation').evaluate(e=>e.getBoundingClientRect().width))===240&&await at('.worktree-navigation .wt-text').isVisible(),'GIT-2: the fold button opens the worktree list');
 await g.reload();await g.waitForFunction(()=>window.lgcodeReady);await g.evaluate(()=>openBoard('workspace'));await at('[data-main-view="source-control"]').click();
 check(await at('#worktree-fold').getAttribute('aria-expanded')==='true','GIT-2: the browser remembers the open worktree list');
 const pane=()=>at('.git-changes').evaluate(e=>Math.round(e.getBoundingClientRect().width));
 await at('#git-resize').focus();await g.keyboard.press('ArrowRight');check(await pane()===296&&await at('#git-resize').getAttribute('aria-valuenow')==='296','GIT-2: the arrow keys resize the commit pane');
 await g.keyboard.press('Home');check(await pane()===280,'GIT-2: Home restores the commit pane width');
 const wide=await fresh('',{width:1700,height:900});await wide.evaluate(()=>openGit('workspace','workspace'));
 check(Math.round(await wide.locator('.worktree-navigation').evaluate(e=>e.getBoundingClientRect().width))===240,'GIT-2: at 1600 pixels and above the worktree list starts open');
 // GIT-3: the machine and a labelled count on each worktree, and sync in the pane header.
 const wt=await wide.locator('[data-git-worktree="workspace"]').textContent();
 check(wt.includes('2 changes')&&wt.includes('Studio')&&(await wide.locator('[data-git-worktree="recovery"]').textContent()).includes('Buildbox'),'GIT-3: each worktree names its machine and labels its count: '+wt);await wide.close();
 check(await g.locator('.git-pane-head #git-fetch, .git-pane-head #git-pull, .git-pane-head #git-push').count()===3,'GIT-3: Fetch, Pull, and Push sit in the pane header');
 await at('#git-stage-all').click();check(await g.locator('[data-stage-file][aria-label^="Unstage"]').count()===2&&(await at('#git-commit').textContent()).trim()==='Commit 2 files','GIT-3: Stage all stages every changed file');
 await at('#git-unstage-all').click();check(await g.locator('[data-stage-file][aria-label^="Stage"]').count()===2,'GIT-3: Unstage all returns them');
 await at('#git-discard').click();check(await at('#discard-dialog').isVisible()&&(await at('#discard-title').textContent())==='Discard 2 changes?'&&await g.locator('#discard-files li').count()===2,'GIT-3: Discard asks first and lists the files');
 await at('#discard-dialog [data-close="discard-dialog"].secondary').click();check(await g.locator('[data-source-file]').count()===2,'GIT-3: Cancel keeps the changes');
 await at('#git-discard').click();await at('#confirm-discard').click();check(await g.locator('.git-changes [data-source-file]').count()===0&&(await at('#git-notice').textContent()).includes('Discarded 2 changes'),'GIT-3: confirming Discard removes the changes');
 await g.close();
 const h=await fresh('?sample=heavy');await h.evaluate(()=>openGit('heavy-invoices','invoices'));
 const pinned=await h.evaluate(()=>{const p=document.querySelector('.git-changes').getBoundingClientRect(),body=document.querySelector('.git-pane-body'),foot=document.querySelector('#git-integration').getBoundingClientRect(),head=document.querySelector('.git-pane-head').getBoundingClientRect();return {files:document.querySelectorAll('.git-changes [data-source-file]').length,scrolls:body.scrollHeight>body.clientHeight,foot:Math.abs(foot.bottom-p.bottom)<=1,head:Math.abs(head.top-p.top)<=1}});
 check(pinned.files>=20&&pinned.scrolls&&pinned.foot&&pinned.head,'GIT-3: with a long file list the sync row stays at the top and Integrate at the bottom: '+JSON.stringify(pinned));await h.close();
 // CONFLICT-1: Open in Terminal starts the editor on the conflicted file.
 const c=await fresh();await c.evaluate(()=>openGit('workspace-review','workspace'));
 await c.locator('[data-open-in-terminal]').click();check(await c.locator('#terminal-command').inputValue()==='vim app/workspace.tsx','CONFLICT-1: Open in Terminal puts the editor command in the worktree\'s terminal');
 await c.locator('#terminal-command').press('Enter');check((await c.locator('.terminal-alt').textContent()).includes('<<<<<<< feat/workspace/review'),'CONFLICT-1: the editor shows the conflict markers');
 // TERM-2: the full-screen program's status and command lines are rows of the grid, aligned with its edge, down to the bottom.
 const alt=await c.evaluate(()=>{const b=s=>document.querySelector(s).getBoundingClientRect(),pad=s=>parseFloat(getComputedStyle(document.querySelector(s)).paddingLeft);return {status:b('.terminal-alt-status').left+pad('.terminal-alt-status'),body:b('.terminal-alt-body').left+pad('.terminal-alt-body'),line:parseFloat(getComputedStyle(document.querySelector('#terminal-screen')).lineHeight),statusH:b('.terminal-alt-status').height,cmd:b('.is-alt .terminal-command'),screen:b('#terminal-screen').bottom}});
 check(alt.status===alt.body&&Math.abs(alt.statusH-alt.line)<1&&Math.abs(alt.cmd.height-alt.line)<1&&Math.abs(alt.cmd.bottom-alt.screen)<=1,'TERM-2: the status line lines up with the grid, and it and the command line are one row each: '+JSON.stringify(alt));
 await c.close();
 // TERM-1: close on hover, rename on double click, both through the data layer.
 const t=await fresh();await t.evaluate(()=>openBoard('workspace'));await t.locator('[data-main-view="terminal"]').first().click();
 check(await t.locator('.terminal-close').first().evaluate(e=>getComputedStyle(e).opacity)==='0','TERM-1: the close button waits for hover on a desktop');
 await t.locator('.terminal-tab').first().hover();check(await t.locator('.terminal-close').first().evaluate(e=>getComputedStyle(e).opacity)==='1','TERM-1: hovering a session shows its close button');
 await t.locator('[data-terminal-session]').first().dblclick();await t.locator('[data-rename-terminal]').fill('Build');await t.locator('[data-rename-terminal]').press('Enter');
 check((await t.locator('[data-terminal-session]').first().textContent())==='Build'&&await t.evaluate(()=>api.terminal.sessions(workspace().id)[0].name)==='Build','TERM-1: a double click renames a session, and the name is kept by the data layer');
 await t.locator('#new-terminal').click();check(await t.locator('[data-terminal-session]').count()===2,'A new session adds a tab');
 await t.locator('[data-close-terminal="2"]').click();check(await t.locator('[data-terminal-session]').count()===1&&await t.evaluate(()=>api.terminal.sessions(workspace().id).length)===1,'TERM-1: the close button ends a session');
 await t.locator('[data-close-terminal]').click();check((await t.locator('#terminal-screen').textContent()).includes('No terminal session is open.')&&await t.locator('#new-terminal-empty').isVisible(),'TERM-1: closing the last session leaves one action, New terminal');
 await t.locator('#new-terminal-empty').click();check(await t.locator('#terminal-command').isVisible(),'New terminal opens a session again');
 check(await t.locator('.terminal-keys').isHidden(),'TERM-4: a desktop has no row of special keys');
 await t.close();
 // TERM-4: the phone's special keys, and a prompt that wraps only at the column limit.
 const p=await fresh('',{width:390,height:844});await p.evaluate(()=>openBoard('workspace'));await p.locator('[data-main-view="terminal"]').first().click();
 check(await p.locator('.terminal-keys button').count()===7&&await p.locator('.terminal-keys').isVisible()&&await p.locator('.terminal-close').first().evaluate(e=>getComputedStyle(e).opacity)==='1','TERM-4 and TERM-1: a phone has Escape, Control, Tab, and arrow keys, and shows the close button');
 const wrap=await p.evaluate(()=>{const label=document.querySelector('#terminal-form label.terminal-prompt'),r=document.createRange();r.selectNodeContents(label);const rects=[...r.getClientRects()],right=document.querySelector('#terminal-form').getBoundingClientRect().right,lines=[...new Set(rects.map(x=>Math.round(x.top)))];const ends=lines.slice(0,-1).map(top=>Math.max(...rects.filter(x=>Math.round(x.top)===top).map(x=>x.right)));return {lines:lines.length,gaps:ends.map(e=>Math.round(right-e))}});
 check(wrap.lines>1&&wrap.gaps.every(gap=>gap<12),'TERM-4: the prompt fills each line to the column limit before it wraps: '+JSON.stringify(wrap));
 const cmd=p.locator('#terminal-command');await cmd.fill('ca');await p.locator('[data-terminal-key="Tab"]').click();check(await cmd.inputValue()==='cat ','TERM-4: Tab completes the word');
 await cmd.fill('pwd');await cmd.press('Enter');await p.locator('[data-terminal-key="ArrowUp"]').click();check(await cmd.inputValue()==='pwd','TERM-4: the Up key recalls the last command');
 await p.locator('[data-terminal-key="Control"]').click();check(await p.locator('[data-terminal-key="Control"]').getAttribute('aria-pressed')==='true'&&await cmd.evaluate(e=>e===document.activeElement),'TERM-4: Control stays pressed for the next key and keeps the focus in the terminal');
 await cmd.pressSequentially('c');check((await p.locator('#terminal-output').textContent()).includes('^C')&&await p.locator('[data-terminal-key="Control"]').getAttribute('aria-pressed')==='false','TERM-4: Control and a letter send that control key');
 check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'TERM-4: the phone terminal does not scroll sideways');
 await p.close();
 // A lost connection disables the new controls.
 const o=await fresh();await o.evaluate(()=>openBoard('workspace'));await o.locator('[data-main-view="source-control"]').first().click();await o.evaluate(()=>document.querySelector('[data-preview="reconnect"]').click());await o.waitForTimeout(60);
 check(await o.locator('#git-stage-all').isDisabled()&&await o.locator('#git-discard').isDisabled()&&(await o.locator('#git-discard').getAttribute('title')||'').includes('connection'),'Stage all and Discard wait for the connection');
 await o.locator('[data-main-view="terminal"]').first().click();check(await o.locator('[data-close-terminal]').first().isDisabled(),'Closing a terminal waits for the connection');await o.close();
});

const result={passed:checks.length,failed:failures.length,failures,errors,checks};
writeFileSync('design/previews/revision-checks.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:checks.length,failed:failures.length,failures,errors},null,1));
await browser.close();
if(failures.length||errors.length)process.exitCode=1;
