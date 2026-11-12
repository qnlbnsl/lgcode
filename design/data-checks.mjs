// Checks the data layer: which files load, what is derived, and what commands write.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const here=dirname(fileURLToPath(import.meta.url)),url=process.env.MOCK_URL||'http://127.0.0.1:4178/workbench.html';
const browser=await chromium.launch(),errors=[],passed=[],failures=[];
const check=(ok,label)=>{(ok?passed:failures).push(label)};
const temp=mkdtempSync(join(tmpdir(),'lgtm-data-'));
const load=name=>JSON.parse(readFileSync(join(here,'data',name),'utf8'));
const open=async(path='',prepare=null)=>{const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));if(prepare)await prepare(page);await page.goto(url+path);await page.waitForFunction(()=>window.lgtmReady);return page};
const serveProd=(page,files)=>page.route('**/data/prod/*',route=>{const name=route.request().url().split('/').at(-1).replace('.json','');return files[name]?route.fulfill({json:files[name]}):route.fulfill({status:404})});
const eventsOf=page=>page.evaluate(()=>api.debug.events());
const added=async(page,before)=>(await eventsOf(page)).slice(before).map(row=>row.event_type);

// Which files load.
{
 const page=await open();
 check(await page.evaluate(()=>H.source)==='sample','With no export, the page loads the small sample');
 check((await page.locator('#data-source').textContent()).includes('small sample'),'Design notes say which data loaded');
 const heavy=await open('?sample=heavy');
 check(await heavy.evaluate(()=>H.source)==='heavy','The heavy sample loads when asked for');
 const failing=await open('',p=>p.route('**/data/sample/*',route=>route.fulfill({status:404}))).catch(()=>null);
 check(failing===null,'Missing data files stop the app instead of drawing an empty one');
}
// Facts come from the events, not from a table of answers.
{
 const meta=load('sample/meta.json'),page=await open('',p=>p.route('**/data/sample/meta.json',route=>route.fulfill({json:{...meta,clock:meta.clock+10*60000}})));
 check((await page.locator('[data-home-item="question:nav-decision"]').textContent()).includes('28 min'),'A wait time comes from when the question was raised');
 check((await page.locator('[data-home-item="approval:perm-iris"]').textContent()).includes('Blocks SH-15'),'A blocked task comes from what the agent is working on');
 const small=await open();
 check((await small.locator('[data-home-item="question:nav-decision"]').textContent()).includes('18 min'),'The small sample shows 18 minutes at its own clock');
 await small.click('[data-system-page="subscriptions"]');
 check((await small.locator('[data-account-name="Team"]').textContent()).includes('5 agents'),'An active agent count comes from which agents use the account');
}
// Commands write events, and the page shows what they did.
{
 const page=await open();let before=(await eventsOf(page)).length;
 await page.evaluate(()=>resolveRequest('nav-decision'));
 const answered=await added(page,before);
 check(['QuestionAnswered','project.TaskChanged','client.AlertCleared','TurnStarted','ThreadItem','TurnEnded','board.PostWritten'].every(tag=>answered.includes(tag)),'Answering a question records it, finishes the task, clears the alert, and starts the reactions');
 await page.click('.project-select[data-project="workspace"]');
 check((await page.locator('#lead-chat-body').textContent()).includes('Your navigation decision is recorded'),'The lead reacts to the answer');
 await page.evaluate(()=>openTeam('app-shell','workspace','chat'));
 check((await page.locator('#view-body').textContent()).includes('Your direction is recorded: agent conversations open in the main view'),'The team chat reacts to the answer');
 await page.evaluate(()=>openTask('SH-15'));
 check((await page.locator('.task-timeline').textContent()).includes('Owner direction recorded'),'The task timeline reacts to the answer');
 await page.evaluate(()=>openAgent('iris','workspace'));before=(await eventsOf(page)).length;
 await page.fill('#message-input','Please check the drawer again.');await page.press('#message-input','Enter');
 check((await added(page,before)).join()==='DeliveryQueued,DeliverySent,PromptSent','Sending a message writes the delivery and the prompt');
 await page.locator('.sample-response').last().waitFor();
 check((await added(page,before)).includes('DeliveryAccepted'),'A reply records that the agent accepted the delivery');
 check((await page.locator('#view-body').textContent()).includes('Please check the drawer again.'),'The thread shows the prompt from its event');
 before=(await eventsOf(page)).length;
 await page.click('.agent-command');if(await page.locator('#stop-dialog').isVisible())await page.click('#confirm-stop-agent');
 const stopped=await added(page,before);
 check(stopped.includes('PermissionCancelled')&&stopped.includes('AgentStopped'),'Stopping an agent cancels its approvals and records the stop');
 await page.click('.agent-command');
 check((await added(page,before)).includes('SessionOpened'),'Resuming an agent opens a session');
 // Every command, then the contract check over all the rows it wrote.
 await page.evaluate(async()=>{
  const sage=projects[0].lead.id;
  await api.permissions.answer('perm-finch','deny');
  await api.project.create({name:'Audit',repoId:'lgtm',plan:{machineId:'studio',base:workspaces.find(w=>w.id==='main'),branch:'audit',path:'~/projects/lgtm-studio/.worktrees/audit'},useWorktree:true});
  await api.project.create({name:'Fresh',repoId:'__new',plan:{fresh:true,machineId:'buildbox',slug:'fresh-repo',branch:'main',path:'~/work/fresh-repo'},useWorktree:false});
  await api.project.addTask('workspace',{title:'Audit task',owner:'iris',teamId:'app-shell',sprintId:'sp-02'});
  await api.accounts.add({harness:'cursor',name:'Audit',machineId:'studio'});
  await api.accounts.setEnabled('codex-work',false);
  await api.settings.setPush('board.post',false);
  await api.settings.saveCarrier({server:'https://push.example',topic:'audit-topic'});
  await api.settings.setToken('never-stored-token');await api.settings.clearToken();await api.settings.clearCarrier();
  await api.settings.saveWeb({enabled:true,port:9000,heartbeat:30,proxy:true,publicAddress:'https://lgtm.example'});
  await api.machines.setRole('laptop','Worker');await api.machines.confirm('laptop');await api.machines.place('docs','studio');await api.machines.join('https://studio.example');
  await api.project.savePreferences('workspace',{shell:'zsh'});
  await api.client.prompt({channelId:'ch-workspace-app-shell'},'Team note',{context:['SH-15']});await api.client.stopReply({channelId:'ch-workspace-app-shell'});
  await api.client.prompt({agentId:sage},'Lead note');await api.client.stopReply({agentId:sage});
  await api.agents.choose('iris',{model:'gpt-6-luna',effort:'high'});
 });
 const rows=await eventsOf(page),file=join(temp,'after-commands.json');
 writeFileSync(file,JSON.stringify(rows));
 check(!JSON.stringify(rows).includes('never-stored-token'),'A carrier token never reaches an event');
 check(rows.some(r=>r.event_type==='AgentStarted'&&JSON.parse(r.payload_json).model)&&rows.some(r=>r.event_type==='project.ModelChosen'),'Agents start with a model and effort, and a change of either is an event');
 check(await page.evaluate(()=>{const a=findAgent('iris',projects[0]),u=api.agents.usage('sage');return a.model==='gpt-6-luna'&&a.effort==='high'&&u.percent===34&&api.agents.usage('ash')===null}),'The reducer applies a model choice, and context use comes from the reads');
 try{execFileSync(process.execPath,[join(here,'data/validate.mjs'),file],{encoding:'utf8',env:process.env});check(true,'Every row a command wrote matches the engine contracts')}catch(e){check(false,'Every row a command wrote matches the engine contracts: '+String(e.stdout).slice(0,600))}
}
// A real database: built with the engine's own migrations, exported, and loaded.
{
 const database=join(temp,'events.sqlite'),db=new DatabaseSync(database),source=readFileSync(resolve(here,'../packages/engine/src/log/migrations.ts'),'utf8');
 for(const [,sql] of source.slice(0,source.indexOf('CREATE TABLE IF NOT EXISTS schema_migrations')).matchAll(/[`"]((?:CREATE|ALTER|DROP) [\s\S]*?)[`"]/g))db.exec(sql);
 db.exec("CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY);INSERT INTO schema_migrations(id) VALUES (1),(2),(3);INSERT INTO agent_tokens(token_hash,agent_id) VALUES ('secret-token-hash','iris')");
 const rows=load('sample/events.json').filter(row=>!row.event_type.startsWith('project.')),insert=db.prepare('INSERT INTO events (sequence,event_id,caller,caller_rule,request_id,agent_id,thread_agent_id,event_type,occurred_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?,?)');
 for(const r of rows){const payload=JSON.parse(r.payload_json);if(payload._tag==='AccountChanged')payload.account.secret='account-secret-reference';insert.run(r.sequence,r.event_id,r.caller,r.caller_rule,r.request_id,r.agent_id,r.thread_agent_id,r.event_type,r.occurred_at,JSON.stringify(payload))}
 db.close();
 const out=join(temp,'prod');
 execFileSync(process.execPath,[join(here,'data/export.mjs'),database,out],{encoding:'utf8'});
 const exported=readFileSync(join(out,'events.json'),'utf8'),events=JSON.parse(exported),meta=JSON.parse(readFileSync(join(out,'meta.json'),'utf8'));
 check(events.length===rows.length&&meta.row_counts.events===rows.length,'The export keeps every row');
 check(!exported.includes('secret-token-hash')&&!exported.includes('account-secret-reference'),'The export holds no token and no account secret');
 try{execFileSync(process.execPath,[join(here,'data/validate.mjs'),join(out,'events.json')],{encoding:'utf8',env:process.env});check(true,'Exported rows match the engine contracts')}catch(e){check(false,'Exported rows match the engine contracts: '+String(e.stdout).slice(0,400))}
 const page=await open('',p=>serveProd(p,{events,meta}));
 check(await page.evaluate(()=>H.source)==='prod','An export takes priority over the sample');
 check((await page.locator('#data-source').textContent()).includes('export'),'Design notes say the export is showing');
 check((await page.evaluate(()=>projects.map(x=>x.id))).includes('workspace'),'Projects come from agent groups when no project events exist');
 await page.evaluate(()=>openAgent('iris','workspace'));
 check((await page.locator('#view-body').textContent()).includes('The reading view for SH-15 is ready'),'A real thread shows its items');
 await page.evaluate(()=>openHome('attention',true));
 check((await page.locator('#home-results').textContent()).includes('Rowan'),'Home lists open questions from a real export');
 const forced=await open('?sample=small',p=>serveProd(p,{events,meta}));
 check(await forced.evaluate(()=>H.source)==='sample','The sample can still be asked for when an export exists');
}
await browser.close();
console.log(JSON.stringify({passed:passed.length,failed:failures.length,failures,errors},null,1));
process.exit(failures.length||errors.length?1:0);
