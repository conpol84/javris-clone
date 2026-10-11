import assert from 'node:assert/strict';
import test from 'node:test';
import {savedJarvisHandoff,jarvisServerMayAdmit} from '../../supabase/functions/_shared/jarvis-server-handoff.ts';
const agent='11111111-1111-4111-8111-111111111111';
test('parses only single validated saved marker, including neighboring CEO actions',()=>{
 const r=savedJarvisHandoff('Done\n[[task:'+agent+']] Research competitors\nCite verified sources.\n\n[[app:gdrive_read]] Later');
 assert.deepEqual(r,{agentId:agent,title:'Research competitors',details:'Cite verified sources.'});
 assert.equal(savedJarvisHandoff('Task: Research competitors'),null);
 assert.equal(savedJarvisHandoff('[[task:wrong]] Research competitors'),null);
 assert.equal(savedJarvisHandoff('[[task:'+agent+']] X'),null);
 assert.equal(savedJarvisHandoff('[[task:'+agent+']] A valid task\n[[task:'+agent+']] Another'),null);
});
test('server gated admission refuses forged UI flag, unauthenticated channel and unsubscribed owner',()=>{
 const eligible={serverGate:true,isCeo:true,ownerAuthenticated:true,standingGrant:true,isChannel:false};
 assert.equal(jarvisServerMayAdmit(eligible),true);
 for(const field of ['serverGate','isCeo','ownerAuthenticated','standingGrant']){
   assert.equal(jarvisServerMayAdmit({...eligible,[field]:false}),false);
 }
 assert.equal(jarvisServerMayAdmit({...eligible,isChannel:true}),false);
});
