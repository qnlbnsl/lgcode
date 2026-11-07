// Stand-ins for the engine's client API, fed by JSON files instead of a running service.
// design/data/README.md explains the files and maps each function to its real command.
//
// Reads return promises, as the real API will. The page awaits one snapshot at boot and
// keeps its live objects, which is the mock's stand-in for a snapshot plus a subscription.
// Commands append event rows and fold them at once, so `api.x(); render()` shows the result.
(function(){
const params=new URLSearchParams(location.search);
const S={
 repositories:[],workspaces:[],projects:[],requests:[],permissionItems:[],deliveryItems:[],machineItems:[],subscriptionItems:[],
 projectMachines:new Map(),futureProjectMachines:new Map(),repositoryLocations:new Map(),runtimeStates:new Map(),workspacePreferences:new Map(),
 threads:new Map(),channels:new Map(),alerts:[],taskStories:{},agents:new Map(),agentProjects:new Map(),openTurns:new Map(),
 setup:{step:'welcome',finished:false}
};
let reads=null,meta=null,source='sample',sequence=0,bootedAt=0;
const events=[],subscribers=new Set(),gitStates=new Map(),replyTimers=new Map(),signInTimers=new Map();
const counters={project:1,task:30,machine:1,account:1,git:1,delivery:1,item:1,post:1};

// First run. Where the owner has got to is stored; what the scan finds is read each time.
const setupSteps=['welcome','found','project'];
const setupScenario=()=>params.get('setup')||'ready';
const setupStore={
 key:()=>'sheprd-setup-'+setupScenario(),
 read(){try{return JSON.parse(localStorage.getItem(setupStore.key()))||{}}catch{return {}}},
 write(patch){try{localStorage.setItem(setupStore.key(),JSON.stringify({...setupStore.read(),...patch}))}catch{}},
 clear(){try{localStorage.removeItem(setupStore.key());sessionStorage.removeItem('sheprd-session')}catch{}}
};
let setupScans=0;
const fetchJson=async path=>{try{const response=await fetch(path,{cache:'no-cache'});return response.ok?await response.json():null}catch{return null}};
const fill=(text,values)=>text.replace(/\{(\w+)\}/g,(m,key)=>values[key]??m);
const owner={_tag:'owner'},asAgent=agentId=>({_tag:'agent',agentId});
const initials=name=>{const rest=name.slice(1).replace(/[^a-zA-Z]/g,''),consonant=rest.replace(/[aeiou]/gi,'')[0]||rest[0]||'';return (name[0]+consonant).toUpperCase()};
const toolName=harness=>reads.harness.labels[harness]||harness;
const projectById=id=>S.projects.find(project=>project.id===id);
const projectOfAgent=id=>projectById(S.agentProjects.get(id));
const threadOf=id=>{if(!S.threads.has(id))S.threads.set(id,[]);return S.threads.get(id)};
const nameOf=actor=>actor?._tag==='agent'?(S.agents.get(actor.agentId)?.name||actor.agentId):'Owner';
const delivery=id=>S.deliveryItems.find(item=>item.id===id);
const request=id=>S.requests.find(item=>item.id===id);
const permission=id=>S.permissionItems.find(item=>item.id===id);
const account=id=>S.subscriptionItems.find(item=>item.id===id);
const machine=id=>S.machineItems.find(item=>item.id===id);

// Engine events carry no projects or machines yet, so a real export gets a plain placement.
function localMachine(){if(!S.machineItems.length)S.machineItems.push({id:'local',name:'This computer',role:'Master',status:'Online',slots:8,workspaceFolder:'~/projects'});return S.machineItems[0]}
function worktreeFor(id,repoId,fields){
 const known=reads.git.worktrees[id]||{},branch=fields.branch;
 const worktree={id,repoId,machineId:fields.machineId,branch,path:fields.path,owner:known.owner??fields.owner??'',activity:known.activity??fields.activity??'No uncommitted changes',files:[...(known.files||[])],incoming:known.incoming||0,conflicts:[...(known.conflicts||[])],history:known.history||reads.git.defaultHistory.map(c=>({...c,ref:fill(c.ref,{branch})}))};
 for(const key of ['projectId','teamId','parentId'])if(fields[key])worktree[key]=fields[key];
 S.workspaces.push(worktree);return worktree;
}
function placeWithoutProject(a,payload){
 const group=payload.groups?.[0]||(payload.parent?._tag==='agent'?S.agentProjects.get(payload.parent.agentId):null)||'unassigned';
 const [projectId,teamId]=group.split('/');
 let project=projectById(projectId);
 if(!project){
  const folder=payload.folder||'/unknown',name=folder.split('/').filter(Boolean).at(-1)||'unknown',slug=name.replace(/[^a-zA-Z0-9_-]/g,'-'),host=localMachine();
  if(!S.repositories.some(r=>r.id===slug)){S.repositories.push({id:slug,name,path:folder});S.repositoryLocations.set(slug+'/'+host.id,folder)}
  const worktreeId='export-'+projectId;
  if(!S.workspaces.some(w=>w.id===worktreeId))worktreeFor(worktreeId,slug,{machineId:host.id,branch:name,path:folder,projectId,owner:projectId});
  project={id:projectId,repoId:slug,name:projectId,goal:'',lead:a,workspace:worktreeId,teams:[],sprints:[],tasks:[]};
  S.projects.push(project);S.projectMachines.set(projectId,host.id);
  if(!teamId)return project;
 }
 const id=teamId||'team',name=teamId||'Team';
 let team=project.teams.find(t=>t.id===id);
 if(!team){team={id,name,agents:[]};project.teams.push(team)}
 team.agents.push(a);return project;
}
function placeAgent(a,payload){
 const [projectId,teamId]=(payload.groups?.[0]||'').split('/'),project=projectById(projectId);
 if(!project||(!teamId&&project.lead))return placeWithoutProject(a,payload);
 if(teamId){let team=project.teams.find(t=>t.id===teamId);if(!team){team={id:teamId,name:teamId,agents:[]};project.teams.push(team)}team.agents.push(a)}
 else project.lead=a;
 return project;
}
function ensureTurn(agentId,row){
 let turn=S.openTurns.get(agentId);
 if(!turn){turn={type:'turn',agentId,occurred:row.occurred_at,parts:[],reply:row.reply};threadOf(agentId).push(turn)}
 return turn;
}
function threadPart(content,itemId){
 switch(content._tag){
  case 'text':return {type:'text',text:content.text,itemId};
  case 'tool-call':return {type:'tool',title:content.title,lines:String(content.output??content.input??'').split('\n').filter(Boolean),status:content.status,itemId};
  case 'file-change':return {type:'file',path:content.path,itemId};
  case 'plan':return {type:'tool',title:'Plan',lines:content.entries.map(entry=>entry.content),itemId};
  default:return null;
 }
}
const postEntry=(row,e)=>e.author._tag==='owner'?{type:'prompt',text:e.text,occurred:row.occurred_at,deliveryId:e.postId}:{type:'turn',agentId:e.author.agentId,occurred:row.occurred_at,parts:[{type:'text',text:e.text}],reply:row.reply};
function addAlert(row,e){
 const subject=e.subject||{},alert={id:e.alertId,kind:e.kind,agentId:e.agentId,subject:subject.id,subjectKind:subject._tag,title:e.title,delivery:null,cleared:false};
 Object.defineProperty(alert,'status',{enumerable:true,get(){
  if(subject._tag==='permission')return permission(subject.id)?.status==='open'?'open':'cleared';
  if(subject._tag==='question')return request(subject.id)?.status==='open'?'open':'cleared';
  if(subject._tag==='agent')return S.runtimeStates.get(subject.id)?.failure?'open':'cleared';
  return alert.cleared?'cleared':'open';
 }});
 S.alerts.unshift(alert);
}

const handlers={
 'project.MachineAdded':(row,e)=>S.machineItems.push({id:e.machineId,name:e.name,role:e.role,status:e.status,slots:e.slots,workspaceFolder:e.workspaceFolder||'~/projects'}),
 'project.MachineChanged':(row,e)=>Object.assign(machine(e.machineId),e.status?{status:e.status}:{},e.role?{role:e.role}:{},e.workspaceFolder?{workspaceFolder:e.workspaceFolder}:{}),
 'project.SetupProgressed':(row,e)=>{S.setup.step=e.step},
 'project.SetupFinished':()=>{S.setup.finished=true},
 'project.RepositoryForgotten':(row,e)=>{S.repositories.splice(S.repositories.findIndex(r=>r.id===e.repoId),1);for(const key of [...S.repositoryLocations.keys()])if(key.startsWith(e.repoId+'/'))S.repositoryLocations.delete(key);for(let i=S.workspaces.length-1;i>=0;i--)if(S.workspaces[i].repoId===e.repoId)S.workspaces.splice(i,1)},
 'project.RepositoryAdded':(row,e)=>S.repositories.push({id:e.repoId,name:e.name,path:e.path}),
 'project.RepositoryLocated':(row,e)=>S.repositoryLocations.set(e.repoId+'/'+e.machineId,e.path),
 'project.WorktreeCreated':(row,e)=>worktreeFor(e.worktreeId,e.repoId,e),
 'project.Created':(row,e)=>{S.projects.push({id:e.projectId,repoId:e.repoId,name:e.name,goal:e.goal,lead:null,workspace:e.worktreeId,teams:[],sprints:[],tasks:[]});S.projectMachines.set(e.projectId,e.machineId)},
 'project.Placed':(row,e)=>S.futureProjectMachines.set(e.projectId,e.machineId),
 'project.PreferencesChanged':(row,e)=>S.workspacePreferences.set(e.projectId,{shell:e.shell}),
 'project.TeamAdded':(row,e)=>projectById(e.projectId).teams.push({id:e.teamId,name:e.name,agents:[],...(e.worktreeId?{workspace:e.worktreeId}:{})}),
 'project.SprintAdded':(row,e)=>projectById(e.projectId).sprints.push({id:e.sprintId,label:e.label,name:e.name,goal:e.goal,phase:e.phase,owner:e.owner,needs:e.needs||[],...(e.completion?{completion:e.completion}:{}),...(e.evidence?{evidence:e.evidence}:{})}),
 'project.TaskAdded':(row,e)=>{const project=projectById(e.projectId);project.tasks.push({id:e.taskId,title:e.title,owner:e.owner,teamId:e.teamId,sprintId:e.sprintId,state:e.state,workspace:e.worktreeId||project.workspace,...(e.addedByOwner?{addedByOwner:true}:{})});if(e.story)S.taskStories[e.taskId]=e.story},
 'project.TaskChanged':(row,e)=>{const task=S.projects.flatMap(project=>project.tasks).find(t=>t.id===e.taskId);if(task)task.state=e.state},
 'project.QuestionLinked':(row,e)=>{const r=request(e.questionId);if(r)Object.assign(r,{projectId:e.projectId,teamId:e.teamId,taskId:e.taskId,sprintId:e.sprintId,title:e.title,summary:e.summary,recommendation:e.recommendation,answer:e.proposedAnswer})},
 'project.AccountPlaced':(row,e)=>{const a=account(e.accountId);if(a)a.machineId=e.machineId},
 'project.PromptContext':(row,e)=>{const all=[...S.threads.values(),...[...S.channels.values()].map(c=>c.posts)].flat(),entry=all.find(x=>x.deliveryId===e.deliveryId);if(entry)entry.context=e.labels},
 'project.ReplyStopped':(row,e)=>{(e.channelId?S.channels.get(e.channelId).posts:threadOf(e.agentId)).push({type:'stopped'});if(e.agentId)S.openTurns.delete(e.agentId);const d=delivery(e.deliveryId);if(d)d.history.push('Held: '+e.reason)},
 AccountChanged:(row,e)=>{
  if(!e.account){S.subscriptionItems.splice(S.subscriptionItems.findIndex(a=>a.id===e.accountId),1);return}
  let a=account(e.accountId);
  if(!a){
   a={id:e.accountId,harness:e.account.harness,name:e.account.displayName||e.accountId,machineId:localMachine().id,status:'Available',enabled:true};
   Object.defineProperty(a,'active',{enumerable:true,get:()=>[...S.agents.values()].filter(x=>x.account===a.id&&S.runtimeStates.get(x.id)?.state==='running').length});
   S.subscriptionItems.push(a);
  }
  a.enabled=e.account.enabled!==false;
 },
 AccountNeedsSignIn:(row,e)=>{const a=account(e.accountId);if(a)a.status='Needs sign-in'},
 AccountAvailable:(row,e)=>{const a=account(e.accountId);if(a)a.status='Available'},
 AgentStarted:(row,e)=>{
  const known=S.agents.get(e.agentId);
  if(known){Object.assign(known,e.model?{model:e.model}:{},e.effort?{effort:e.effort}:{});Object.assign(S.runtimeStates.get(e.agentId),{state:'running',failure:null})}
  else{
   const a={id:e.agentId,name:e.name,initial:initials(e.name),role:e.role,tool:toolName(e.harness),harness:e.harness,account:e.account};
   S.agents.set(a.id,a);S.agentProjects.set(a.id,placeAgent(a,e).id);S.runtimeStates.set(a.id,{state:'running',failure:null,reloadable:true});
  }
 },
 AgentStartFailed:(row,e)=>{
  const run=S.runtimeStates.get(e.agentId);
  if(run)Object.assign(run,{state:'stopped',failure:e.reason,reloadable:false,since:row.occurred_at});
 },
 AgentStopped:(row,e)=>{const run=S.runtimeStates.get(e.agentId);if(run)run.state='stopped'},
 AgentCrashed:(row,e)=>{const run=S.runtimeStates.get(e.agentId);if(run)run.state='stopped'},
 SessionOpened:(row,e)=>{const run=S.runtimeStates.get(e.agentId);if(run)Object.assign(run,{state:'running',reloadable:e.reloadable})},
 PromptSent:(row,e)=>threadOf(e.agentId).push({type:'prompt',text:e.text,occurred:row.occurred_at,deliveryId:e.deliveryId,sender:e.sender}),
 TurnStarted:(row,e)=>{const turn={type:'turn',agentId:e.agentId,occurred:row.occurred_at,parts:[],reply:row.reply};threadOf(e.agentId).push(turn);S.openTurns.set(e.agentId,turn)},
 ThreadItem:(row,e)=>{
  const part=threadPart(e.content,e.itemId);if(!part)return;
  // A tool call arrives as a series of patches with one item identifier.
  const all=threadOf(e.agentId).flatMap(entry=>entry.parts||[]),same=all.find(x=>x.itemId===e.itemId);
  if(same){Object.assign(same,part);return}
  ensureTurn(e.agentId,row).parts.push(part);
 },
 TurnEnded:(row,e)=>S.openTurns.delete(e.agentId),
 QuestionAsked:(row,e)=>{
  const a=S.agents.get(e.agentId),project=projectOfAgent(e.agentId);
  S.requests.push({id:e.questionId,projectId:project?.id,agentId:e.agentId,status:'open',title:e.text.slice(0,80),summary:(a?.name||e.agentId)+' needs your answer.',question:e.text,recommendation:'',since:row.occurred_at,...(e.holder?._tag==='agent'?{holder:'lead'}:{})});
  ensureTurn(e.agentId,row).parts.push({type:'question',id:e.questionId});
 },
 QuestionAnswered:(row,e)=>{const r=request(e.questionId);if(r)r.status='resolved'},
 PermissionRequested:(row,e)=>S.permissionItems.push({id:e.permissionRequestId,projectId:projectOfAgent(e.agentId)?.id,agentId:e.agentId,callId:e.toolCallId,title:e.description,kind:e.toolKind||'tool',...(e.toolInput?{input:e.toolInput}:{}),...(e.inputRedacted?{redacted:true}:{}),status:'open',options:e.options,since:row.occurred_at,...(e.holder?._tag==='agent'?{holder:'lead'}:{})}),
 PermissionAnswered:(row,e)=>{const r=permission(e.permissionRequestId);if(!r)return;r.status='answered';const chosen=r.options.find(o=>o.id===e.answer.optionId);r.answer=e.answer._tag==='selected'&&/allow/i.test(chosen?.kind||'')?chosen.name:'Denied'},
 PermissionCancelled:(row,e)=>{const r=permission(e.permissionRequestId);if(r){r.status='cancelled';r.answer=e.reason}},
 PermissionMoved:(row,e)=>{const r=permission(e.permissionRequestId);if(r)r.holder='lead'},
 DeliveryQueued:(row,e)=>{const d=e.delivery;S.deliveryItems.push({id:d.id,agentId:d.target,from:nameOf(d.sender),source:reads.deliveryLabels[d.id]||projectOfAgent(d.target)?.name||'',text:d.content.text||d.content._tag,history:['Queued']})},
 DeliverySent:(row,e)=>delivery(e.deliveryId)?.history.push('Sent'),
 DeliveryAccepted:(row,e)=>delivery(e.deliveryId)?.history.push('Accepted'),
 DeliveryRequeued:(row,e)=>delivery(e.deliveryId)?.history.push('Requeued: '+e.reason),
 DeliveryHeld:(row,e)=>delivery(e.deliveryId)?.history.push('Held: no agent capacity'),
 DeliveryReleased:(row,e)=>S.deliveryItems.filter(d=>d.agentId===e.agentId&&d.history.at(-1).startsWith('Held')).forEach(d=>d.history.push('Released')),
 'board.ChannelOpened':(row,e)=>S.channels.set(e.channelId,{id:e.channelId,name:e.name,group:e.group,anchorAgentId:e.anchorAgentId,posts:[]}),
 'board.PostWritten':(row,e)=>S.channels.get(e.channelId)?.posts.push(postEntry(row,e)),
 'client.AlertRaised':addAlert,
 'client.AlertDelivered':(row,e)=>{const a=S.alerts.find(x=>x.id===e.alertId);if(a)a.delivery={status:'Delivered',attempt:e.attempt}},
 'client.AlertDeliveryFailed':(row,e)=>{const a=S.alerts.find(x=>x.id===e.alertId);if(a)a.delivery={status:e.final?'Failed':'Still failing',attempt:e.attempt,reason:e.reason}},
 'client.AlertCleared':(row,e)=>{const a=S.alerts.find(x=>x.id===e.alertId);if(a)a.cleared=true},
 'client.AlertSettingsChanged':(row,e)=>{S.settings.push[e.kind]=e.push},
 'client.AlertCarrierChanged':(row,e)=>{S.settings.carrier=e.carrier._tag==='none'?null:{server:e.carrier.server,topic:e.carrier.topic}},
 'client.AlertCarrierTokenSet':()=>{S.settings.tokenSet=true},
 'client.AlertCarrierTokenCleared':()=>{S.settings.tokenSet=false},
 'client.WebSettingsChanged':(row,e)=>{const w=e.settings;S.settings.web={enabled:w.enabled,port:w.port,heartbeat:w.heartbeatSeconds,proxy:w.proxyMode,publicAddress:w.publicAddress||''}}
};
function fold(row){const handler=handlers[row.event_type];if(handler)handler(row,JSON.parse(row.payload_json))}

// The same rule as threadAgent in packages/engine/src/views/apply.ts.
const threadAgent=e=>e._tag==='DeliveryQueued'?e.delivery.target:typeof e.agentId==='string'?e.agentId:null;
function emit(event_type,payload,{caller='owner',reply=false}={}){
 const body={_tag:event_type,...payload},engine=!/^(project|board|client)\./.test(event_type),thread=engine?threadAgent(body):null;
 const row={sequence:++sequence,event_id:'evt-'+String(sequence).padStart(5,'0'),caller,caller_rule:null,request_id:'req-'+sequence,agent_id:thread,thread_agent_id:thread,event_type,occurred_at:meta.clock+1+(Date.now()-bootedAt),payload_json:JSON.stringify(body)};
 if(reply)row.reply=true;
 events.push(row);fold(row);
 for(const notify of subscribers)notify(row,body);
 return row;
}
function saySomething(agentId,texts,options={}){
 const caller='agent:'+agentId;
 emit('TurnStarted',{agentId},{caller,...options});
 for(const text of texts)emit('ThreadItem',{agentId,itemId:'live-'+counters.item++,content:{_tag:'text',text},replay:false},{caller,...options});
 emit('TurnEnded',{agentId,compact:false},{caller,...options});
}
const postToChannel=(channelId,author,text,options={})=>emit('board.PostWritten',{postId:'post-live-'+counters.post++,channelId,author,text,to:[],reply:'none'},{caller:author._tag==='owner'?'owner':'agent:'+author.agentId,...options});
const clearAlertsFor=(id,cause)=>{for(const a of S.alerts.filter(x=>x.subject===id&&!x.cleared))emit('client.AlertCleared',{alertId:a.id,cause},{caller:'piece:client'})};
function replyKey(target){return target.channelId?'channel:'+target.channelId:'agent:'+target.agentId}

const api={
 // Which files the page loaded: the real export, the heavy sample, or the small sample.
 async boot(){
  const asked=params.get('sample');
  const load=async dir=>{const [rows,overlay,info]=await Promise.all(['events','reads','meta'].map(name=>fetchJson(`data/${dir}/${name}.json`)));return rows&&info?{rows,overlay,info}:null};
  const sample=await load(asked==='heavy'?'heavy':'sample');
  const prod=asked?null:await load('prod');
  const first=asked==='first'?await load('first'):null;
  const chosen=first||(prod?.rows.some(row=>row.event_type==='AgentStarted')?prod:sample);
  if(!chosen)throw Error('The data files did not load.');
  source=chosen===first?'first':chosen===prod?'prod':asked==='heavy'?'heavy':'sample';
  const bare=chosen===prod||chosen===first;
  reads={...sample.overlay,...chosen.overlay,git:{...sample.overlay.git,worktrees:bare?{}:sample.overlay.git.worktrees,evidence:bare?{}:sample.overlay.git.evidence,...(bare?chosen.overlay?.git:{})}};
  if(bare)Object.assign(reads,{large:chosen.overlay?.large||{},reactions:chosen.overlay?.reactions||{},deliveryLabels:chosen.overlay?.deliveryLabels||{}});
  meta=chosen.info;bootedAt=Date.now();
  S.settings=structuredClone(reads.settings);
  for(const row of chosen.rows){events.push(row);sequence=Math.max(sequence,row.sequence);fold(row)}
  localMachine();
  if(first){
   if(params.has('reset')){setupStore.clear();params.delete('reset');history.replaceState(null,'','?'+params)}
   const saved=setupStore.read();
   if(saved.step)S.setup.step=saved.step;
   if(saved.folder)localMachine().workspaceFolder=saved.folder;
  }
  return api.client.snapshot();
 },
 client:{
  // Named for client.snapshot and client.subscribe. The object stays current after this returns.
  async snapshot(){return {...S,source,clock:meta.clock,timeZone:meta.display_time_zone||'UTC',exportedAt:meta.exported_at,harness:reads.harness,service:reads.service,diffs:reads.git.diffs,large:reads.large}},
  subscribe(notify){subscribers.add(notify);return ()=>subscribers.delete(notify)},
  async thread(agentId){return threadOf(agentId)},
  async roster(){return [...S.agents.values()].map(a=>({...a,...S.runtimeStates.get(a.id),project:S.agentProjects.get(a.id)}))},
  async sequence(){return sequence},
  // A prompt to an agent, or a post to a team's shared chat. A scripted reply follows.
  async prompt(target,text,{context=[],account}={}){
   let id,reply;
   if(target.channelId){
    const channel=S.channels.get(target.channelId);
    id=emit('board.PostWritten',{postId:'post-live-'+counters.post++,channelId:channel.id,author:owner,text,to:[],reply:'none'}).sequence&&JSON.parse(events.at(-1).payload_json).postId;
    const project=S.projects.find(x=>x.teams.some(t=>channel.group===x.id+'/'+t.id));
    reply=()=>postToChannel(channel.id,asAgent(channel.anchorAgentId),fill(reads.replies.default,{project:project?.name||''}),{reply:true});
   }else{
    const agentId=target.agentId,project=projectOfAgent(agentId);
    id='delivery-live-'+counters.delivery++;
    emit('DeliveryQueued',{delivery:{id,target:agentId,sender:owner,content:{_tag:'prompt',text}}});
    emit('DeliverySent',{agentId,deliveryId:id,method:'acp'},{caller:'service:runner'});
    emit('PromptSent',{agentId,deliveryId:id,sender:owner,text});
    reply=()=>{emit('DeliveryAccepted',{agentId,deliveryId:id},{caller:'service:runner'});saySomething(agentId,[fill(reads.replies.default,{project:project?.name||''})],{reply:true})};
   }
   if(context.length||(account&&account!=='host'))emit('project.PromptContext',{deliveryId:id,labels:context,...(account&&account!=='host'?{account}:{})});
   replyTimers.set(replyKey(target),{id,timer:setTimeout(()=>{replyTimers.delete(replyKey(target));reply()},900)});
   return {deliveryId:id};
  },
  async stopReply(target,reason='response stopped'){
   const running=replyTimers.get(replyKey(target));if(!running)return;
   clearTimeout(running.timer);replyTimers.delete(replyKey(target));
   emit('project.ReplyStopped',{...target,deliveryId:running.id,reason});
  },
  async largeItem(agentId){
   const item=reads.large[agentId];if(!item)return '';
   const head=Array.from({length:item.lines},(_,i)=>item.line.replace('{n}',i+1)).join('\n')+'\n';
   return head+item.fill.repeat(Math.ceil(item.bytes/item.fill.length)).slice(0,item.bytes-head.length);
  }
 },
 questions:{
  async answer(id,text){
   const r=request(id);if(!r||r.status!=='open')return;
   emit('QuestionAnswered',{agentId:r.agentId,questionId:id,answeredBy:owner,text:text||r.answer||'',deliveryId:'delivery-answer-'+counters.delivery++});
   if(r.taskId)emit('project.TaskChanged',{taskId:r.taskId,state:'done'});
   clearAlertsFor(id,'answered');
   const project=projectById(r.projectId),scripted=reads.reactions[id];
   if(scripted)for(const reaction of scripted){if(reaction.channelId)postToChannel(reaction.channelId,asAgent(reaction.author),reaction.text);else saySomething(reaction.agentId,[reaction.text])}
   else if(project?.lead)saySomething(project.lead.id,[fill(reads.replies.answered,{agent:S.agents.get(r.agentId)?.name||''})]);
  }
 },
 permissions:{
  async answer(id,choice){
   const r=permission(id);if(!r||r.status!=='open')return;
   const option=r.options.find(o=>choice==='allow'?/allow/i.test(o.kind):/reject|deny/i.test(o.kind));
   emit('PermissionAnswered',{agentId:r.agentId,permissionRequestId:id,answeredBy:owner,answer:option?{_tag:'selected',optionId:option.id}:{_tag:'cancelled'}});
   clearAlertsFor(id,'answered');
  }
 },
 agents:{
  async stop(id){
   for(const r of S.permissionItems.filter(x=>x.agentId===id&&x.status==='open')){emit('PermissionCancelled',{agentId:id,permissionRequestId:r.id,reason:'Cancelled because the agent stopped'},{caller:'service:runner'});clearAlertsFor(r.id,'cancelled')}
   api.client.stopReply({agentId:id},'agent stopped');
   emit('AgentStopped',{agentId:id});
  },
  async resume(id,{model,effort}={}){
   const a=S.agents.get(id);if(!a)return;
   const project=projectOfAgent(id),team=project.teams.find(t=>t.agents.includes(a));
   emit('AgentStarted',{agentId:id,name:a.name,role:a.role,groups:[team?project.id+'/'+team.id:project.id],parent:owner,harness:a.harness,account:a.account,...(model?{model}:{}),...(effort?{effort}:{}),permission:'edit',folder:'/'+S.workspaces.find(w=>w.id===(team?.workspace||project.workspace)).path.replace(/^[~/]+/,''),runMode:'acp'});
   emit('SessionOpened',{agentId:id,session:{_tag:'acp',sessionId:'session-'+id+'-'+sequence},protocolVersion:1,reloadable:true},{caller:'service:runner'});
   clearAlertsFor(id,'resumed');
  }
 },
 project:{
  // The engine has no project piece yet. These write the proposed project.* events.
  async list(){return S.projects},
  async create({name,repoId,plan,useWorktree,account:chosenAccount}){
   const n=counters.project++,id='project-'+n,leadName=reads.service.leadNames[(n-1)%reads.service.leadNames.length],machineId=plan.machineId;
   let baseId=plan.base?.id;
   if(plan.fresh){
    repoId=plan.slug;baseId=machineId+'-'+repoId+'-main';
    emit('project.RepositoryAdded',{repoId,name:plan.slug,path:plan.path});
    emit('project.RepositoryLocated',{repoId,machineId,path:plan.path});
    emit('project.WorktreeCreated',{worktreeId:baseId,repoId,machineId,branch:'main',path:plan.path,owner:'Main checkout',activity:'New repository'});
   }
   let worktreeId=baseId;
   if(useWorktree){worktreeId='worktree-'+id;emit('project.WorktreeCreated',{worktreeId,repoId,machineId,projectId:id,branch:plan.branch,path:plan.path,owner:name+' · '+leadName,activity:'No pending changes'})}
   emit('project.Created',{projectId:id,repoId,name,goal:'Define the outcome with your project lead.',leadAgentId:'lead-'+n,worktreeId,machineId});
   const worktree=S.workspaces.find(w=>w.id===worktreeId),leadId='lead-'+n,accountId=chosenAccount||S.subscriptionItems.find(a=>a.harness==='claude'&&a.machineId===machineId&&a.status==='Available')?.id||'claude-'+machineId,harness=account(accountId)?.harness||'claude';
   worktree.projectId||=id;
   emit('AgentStarted',{agentId:leadId,name:leadName,role:'Project lead',groups:[id],parent:owner,harness,account:accountId,permission:'edit',folder:'/'+worktree.path.replace(/^[~/]+/,''),runMode:'acp'});
   emit('SessionOpened',{agentId:leadId,session:{_tag:'acp',sessionId:'session-'+leadId},protocolVersion:1,reloadable:true},{caller:'service:runner'});
   saySomething(leadId,reads.replies.greeting.map(text=>fill(text,{project:name})));
   return {id,repoId};
  },
  async addTask(projectId,{title,owner:ownerId,teamId,sprintId}){
   const id='TASK-'+counters.task++;
   emit('project.TaskAdded',{projectId,taskId:id,title,owner:ownerId,teamId,sprintId,state:'queue',addedByOwner:true});
   return {id};
  },
  async savePreferences(projectId,{shell}){emit('project.PreferencesChanged',{projectId,shell})}
 },
 machines:{
  async list(){return S.machineItems},
  // The website generates the code. The worker appears once it connects.
  async pair(name){
   const id='worker-'+counters.machine++,parts=reads.service.pairingCodeParts,code=parts.map((part,i)=>i===counters.machine%parts.length?[...part].reverse().join(''):part).join('-');
   setTimeout(()=>emit('project.MachineAdded',{machineId:id,name,role:'Worker',status:'Awaiting confirmation',slots:4,workspaceFolder:'~/projects'}),1200);
   return {id,code,command:'sheprd connect '+reads.service.masterAddress};
  },
  async confirm(id){emit('project.MachineChanged',{machineId:id,status:'Online'})},
  async setRole(id,role){emit('project.MachineChanged',{machineId:id,role})},
  async join(address){emit('project.MasterJoined',{address})},
  async place(projectId,machineId){emit('project.Placed',{projectId,machineId})}
 },
 // First run. These stand for a proposed read of the computer and proposed progress records.
 setup:{
  needed(){return !S.setup.finished&&!S.projects.length},
  // Reads the harnesses and the repositories in a folder. It changes nothing on the computer.
  async scan(folder){
   const host=localMachine(),chosen=folder||host.workspaceFolder,moved=chosen!==host.workspaceFolder;
   if(moved){
    for(const repo of [...S.repositories])if(!S.projects.some(project=>project.repoId===repo.id))emit('project.RepositoryForgotten',{repoId:repo.id});
    emit('project.MachineChanged',{machineId:host.id,workspaceFolder:chosen});
    setupStore.write({folder:chosen});
   }
   await new Promise(resolve=>setTimeout(resolve,reads.setup.delay));
   const scenario=setupScenario(),found=reads.setup.scenarios[setupScans++&&reads.setup.rescan[scenario]||scenario];
   if(found.failure)return {folder:chosen,failure:found.failure};
   const signedIn=setupStore.read().signedIn||[];
   const harnesses=found.harnesses.map(h=>{
    if(!h.installed)return {...h,install:reads.setup.install[h.harness]};
    const accountId=h.harness+'-'+host.id;
    if(!account(accountId)){
     emit('AccountChanged',{accountId,account:{id:accountId,harness:h.harness,displayName:toolName(h.harness),enabled:true}});
     emit('project.AccountPlaced',{accountId,machineId:host.id});
     if(!h.signedIn&&!signedIn.includes(accountId))emit('AccountNeedsSignIn',{accountId,reason:'not-signed-in'});
    }
    if(h.signedIn||signedIn.includes(accountId))emit('AccountAvailable',{accountId,cause:'signed-in'});
    return {...h,accountId};
   });
   const repositories=found.repositories.length||!moved?found.repositories:reads.setup.scenarios.ready.repositories;
   return {folder:chosen,harnesses,repositories:repositories.map(r=>({...r,id:r.name,path:chosen+'/'+r.name}))};
  },
  // The repositories the scan found become the service's own when the owner moves on.
  adopt(repositories){
   const host=localMachine();
   for(const repo of repositories){
    if(S.repositories.some(r=>r.id===repo.id))continue;
    emit('project.RepositoryAdded',{repoId:repo.id,name:repo.name,path:repo.path});
    emit('project.RepositoryLocated',{repoId:repo.id,machineId:host.id,path:repo.path});
    emit('project.WorktreeCreated',{worktreeId:host.id+'-'+repo.id+'-main',repoId:repo.id,machineId:host.id,branch:repo.branch,path:repo.path,owner:'Main checkout',activity:'No uncommitted changes'});
   }
  },
  // A lower step never lowers how far the owner has got, so Back does not lose the place.
  advance(step){if(setupSteps.indexOf(step)>setupSteps.indexOf(S.setup.step)){emit('project.SetupProgressed',{step});setupStore.write({step})}},
  finish(){emit('project.SetupFinished',{});setupStore.clear()}
 },
 accounts:{
  async list(){return S.subscriptionItems},
  async add({id,harness,name,machineId}){
   const accountId=id||harness+'-extra-'+counters.account++;
   emit('AccountChanged',{accountId,account:{id:accountId,harness,displayName:name,enabled:true}});
   emit('project.AccountPlaced',{accountId,machineId});
   emit('AccountNeedsSignIn',{accountId,reason:'not-signed-in'});
   return account(accountId);
  },
  async setEnabled(id,enabled){const a=account(id);emit('AccountChanged',{accountId:id,account:{id,harness:a.harness,displayName:a.name,enabled}})},
  // Runs the harness's own login in a terminal on that machine.
  async signIn(id){
   clearTimeout(signInTimers.get(id));
   signInTimers.set(id,setTimeout(()=>{signInTimers.delete(id);emit('AccountAvailable',{accountId:id,cause:'signed-in'});clearAlertsFor(id,'signed-in');if(source==='first')setupStore.write({signedIn:[...new Set([...(setupStore.read().signedIn||[]),id])]})},1200));
   return reads.harness.logins[account(id).harness]||reads.harness.logins.codex;
  },
  async cancelSignIn(id){clearTimeout(signInTimers.get(id));signInTimers.delete(id)}
 },
 alerts:{
  async list(){return S.alerts}
 },
 settings:{
  async read(){return S.settings},
  async setPush(kind,push){emit('client.AlertSettingsChanged',{kind,push})},
  async saveCarrier({server,topic}){emit('client.AlertCarrierChanged',{carrier:{_tag:'ntfy',server,topic}},{caller:'owner'})},
  async clearCarrier(){if(S.settings.tokenSet)emit('client.AlertCarrierTokenCleared',{});emit('client.AlertCarrierChanged',{carrier:{_tag:'none'}})},
  // The token never reaches a file or an event, as in the engine.
  async setToken(){emit('client.AlertCarrierTokenSet',{origin:S.settings.carrier.server,carrierGeneration:'generation-1'})},
  async clearToken(){emit('client.AlertCarrierTokenCleared',{})},
  async saveWeb(web){emit('client.WebSettingsChanged',{settings:{enabled:web.enabled,port:web.port,heartbeatSeconds:web.heartbeat,proxyMode:web.proxy,...(web.publicAddress?{publicAddress:web.publicAddress}:{})}})}
 },
 // Git is read from the worktree at request time, so these change no events.
 git:{
  state(id){
   if(!gitStates.has(id)){const w=S.workspaces.find(x=>x.id===id);gitStates.set(id,{staged:new Set(),message:'',commits:[],incoming:w?.incoming||0,outgoing:0,pending:0,conflicts:new Set(w?.conflicts||[]),resolutions:new Map(),notice:'',lastMerge:''})}
   return gitStates.get(id);
  },
  log(id){const w=S.workspaces.find(x=>x.id===id);return [...api.git.state(id).commits,...(w?.history||[])]},
  stage(id,path){const g=api.git.state(id);g.staged.has(path)?g.staged.delete(path):g.staged.add(path)},
  commit(id){
   const w=S.workspaces.find(x=>x.id===id),g=api.git.state(id),files=w.files.filter(f=>g.staged.has(f)),commit='d'+(counters.git++).toString(16).padStart(6,'0');
   g.commits.unshift({id:commit,title:g.message.trim(),ref:w.branch,files});
   w.files=w.files.filter(f=>!g.staged.has(f));g.staged.clear();g.message='';g.outgoing++;g.pending++;g.notice='Committed '+commit+' on '+w.branch+'.';
  },
  fetch(id){api.git.state(id).notice='Remote references are up to date.'},
  pull(id){const w=S.workspaces.find(x=>x.id===id),g=api.git.state(id);g.incoming=0;g.notice='Updated '+w.branch+' from its tracked branch.'},
  push(id){const w=S.workspaces.find(x=>x.id===id),g=api.git.state(id);g.outgoing=0;g.notice='Pushed '+w.branch+'.'},
  resolve(id,path,choice){const g=api.git.state(id);g.conflicts.delete(path);g.resolutions.set(path,choice);g.notice='Conflict resolved. Review and stage '+path+'.'},
  integrate(id,targetId){
   const w=S.workspaces.find(x=>x.id===id),target=S.workspaces.find(x=>x.id===targetId),g=api.git.state(id),parent=api.git.state(targetId),files=[...new Set(g.commits.slice(0,g.pending).flatMap(c=>c.files))];
   parent.commits.unshift({id:'m'+(counters.git++).toString(16).padStart(6,'0'),title:'Merge '+w.branch,ref:target.branch,files:files.length?files:['docs/README.md']});
   parent.outgoing++;parent.pending++;g.pending=0;g.lastMerge=target.branch;g.notice='Merged '+w.branch+' into '+target.branch+'.';
  },
  // Slow on purpose, so the merge dialog shows that it is waiting for results.
  async mergeEvidence(id){
   await new Promise(done=>setTimeout(done,120));
   return reads.git.evidence[id]||{tests:{ok:false,text:'No test run is recorded for this branch.'},review:{ok:false,text:'No review is recorded for this branch.'}};
  }
 },
 // A real terminal is a stream, so this one answers at once.
 terminal:{
  run(id,command){
   const w=S.workspaces.find(x=>x.id===id),t=reads.terminal;
   if(command==='pwd')return w.path;
   if(command==='ls')return t.ls;
   if(command==='git status')return `On branch ${w.branch}\n${w.files.length?w.files.map(f=>'  modified: '+f).join('\n'):'nothing to commit, working tree clean'}`;
   if(command==='git branch')return S.workspaces.filter(x=>x.repoId===w.repoId&&x.machineId===w.machineId).map(x=>(x.id===w.id?'* ':'  ')+x.branch).join('\n');
   if(command==='git log --oneline')return api.git.log(id).map(c=>c.id+' '+c.title).join('\n');
   if(command.startsWith('echo '))return command.slice(5).replace(/^(['"])(.*)\1$/,'$2');
   if(command.startsWith('cat ')){const path=command.slice(4).trim();return reads.files[path]??`cat: ${path}: No such file or directory`}
   return t.replies[command]??t.unavailable;
  }
 },
 // Design notes only: the states the data cannot reach by itself.
 debug:{emit,events:()=>events,get source(){return source}}
};
window.api=api;
})();
