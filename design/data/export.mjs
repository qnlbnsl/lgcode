// Copies the engine's stored events into design/data/prod, so the mock can show real
// threads without the service running.
//   node design/data/export.mjs [path/to/events.sqlite] [output folder]
// It reads the events table and nothing else: never agent_tokens, receipts, or processes.
// The output is private and git ignores it, because threads hold whatever agents wrote.
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
// The same order as stateDirectory in packages/engine/src/service.ts.
const stateFolder=process.env.LGTM_HOME||join(process.env.XDG_STATE_HOME||join(homedir(),'.local/state'),'lgtm');
const input=process.argv[2]||join(stateFolder,'events.sqlite'),output=resolve(process.argv[3]||join(here,'prod'));

const database=new DatabaseSync(input,{readOnly:true});
const rows=database.prepare('SELECT sequence,event_id,caller,caller_rule,request_id,agent_id,thread_agent_id,event_type,occurred_at,payload_json FROM events ORDER BY sequence').all();
const migrations=database.prepare('SELECT id FROM schema_migrations ORDER BY id').all().map(row=>row.id);
database.close();

// An account holds references to credentials, and a carrier topic works as a password.
function scrub(row){
 const event=JSON.parse(row.payload_json);
 if(event._tag==='AccountChanged'&&event.account){delete event.account.secret;delete event.account.environment;delete event.account.home}
 if(event._tag==='client.AlertCarrierChanged'&&event.carrier?.topic)event.carrier.topic='hidden';
 return {...row,payload_json:JSON.stringify(event)};
}
const events=rows.map(scrub),counts={};
for(const row of events)counts[row.event_type]=(counts[row.event_type]||0)+1;
const now=Date.now();
mkdirSync(output,{recursive:true,mode:0o700});
writeFileSync(join(output,'events.json'),JSON.stringify(events).replace(/\},\{"sequence"/g,'},\n{"sequence"')+'\n',{mode:0o600});
writeFileSync(join(output,'meta.json'),JSON.stringify({source:'prod',exported_at:new Date(now).toISOString(),clock:now,display_time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,schema:{table:'events',migrations},row_counts:{events:events.length,by_type:counts},notes:'Real events exported from '+input},null,1)+'\n',{mode:0o600});
console.log(`Wrote ${events.length} events to ${output}`);
