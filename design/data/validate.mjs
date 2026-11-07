// Checks every row in an events file against the engine's real contracts.
//   node design/data/validate.mjs design/data/sample/events.json [more files]
// Event types starting "project." are proposed, so only their list is printed.
// A worktree has no node_modules, so the contracts load from the nearest checkout
// above this file that does. SHEPRD_ROOT overrides that choice.
import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
let root=process.env.SHEPRD_ROOT||resolve(here,'../..');
while(!process.env.SHEPRD_ROOT&&!existsSync(resolve(root,'packages/contracts/node_modules/effect'))&&dirname(root)!==root)root=dirname(root);
const load=path=>import(pathToFileURL(resolve(root,'packages/contracts/src',path)).href);
const {Schema}=await import(pathToFileURL(resolve(root,'packages/contracts/node_modules/effect/dist/index.js')).href);
const {EngineEvent}=await load('events.ts');
const {BoardEvent}=await load('board/events.ts');
const {ClientEvent}=await load('client/events.ts');

// The same rule as threadAgent in packages/engine/src/views/apply.ts.
const threadAgent=e=>e._tag==='DeliveryQueued'?e.delivery.target:typeof e.agentId==='string'?e.agentId:null;
const decoders={engine:Schema.decodeUnknownExit(EngineEvent),board:Schema.decodeUnknownExit(BoardEvent),client:Schema.decodeUnknownExit(ClientEvent)};
const columns=['sequence','event_id','caller','caller_rule','request_id','agent_id','thread_agent_id','event_type','occurred_at','payload_json'];
let failed=0;
for(const file of process.argv.slice(2)){
 const rows=JSON.parse(readFileSync(file,'utf8')),proposed=new Set(),real=new Set();let last=0;
 for(const row of rows){
  const fail=why=>{failed++;console.log(`${file} #${row.sequence} ${row.event_type}: ${why}`)};
  for(const c of columns)if(!(c in row))fail('missing column '+c);
  if(row.sequence<=last)fail('sequence does not increase');last=row.sequence;
  const e=JSON.parse(row.payload_json);
  if(e._tag!==row.event_type)fail(`_tag ${e._tag} differs from event_type`);
  if(row.event_type.startsWith('project.')){proposed.add(row.event_type);continue}
  real.add(row.event_type);
  const piece=row.event_type.startsWith('board.')?'board':row.event_type.startsWith('client.')?'client':'engine';
  const result=decoders[piece](e);
  if(result._tag!=='Success')fail(String(result.cause).split('\n').slice(0,6).join(' | '));
  if(piece==='engine'&&(row.thread_agent_id??null)!==threadAgent(e))fail(`thread_agent_id ${row.thread_agent_id} should be ${threadAgent(e)}`);
 }
 console.log(`${file}: ${rows.length} rows; ${real.size} real event types; ${proposed.size} proposed: ${[...proposed].sort().join(', ')}`);
}
console.log(failed?`${failed} rows failed`:'All rows match the contracts');
process.exit(failed?1:0);
