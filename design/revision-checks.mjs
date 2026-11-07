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
 check(!body.includes('feat/workspace ')&&body.includes('feat/workspace/app-shell'),'Iris is always on her team branch');
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

const result={passed:checks.length,failed:failures.length,failures,errors,checks};
writeFileSync('design/previews/revision-checks.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({passed:checks.length,failed:failures.length,failures,errors},null,1));
await browser.close();
if(failures.length||errors.length)process.exitCode=1;
