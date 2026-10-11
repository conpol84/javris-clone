import {describe,it,expect} from 'vitest';
import {trustedJarvisTaskView} from './jarvis-server-status';
const org='33333333-3333-4333-8333-333333333333';
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const conversation='66666666-6666-4666-8666-666666666666';
const message='77777777-7777-4777-8777-777777777777';
const task={id:message,organization_id:org,created_by:alice,status:'pending',
 metadata:{source:'jarvis_autopilot_server_v1',conversation_id:conversation,message_id:message}};
const view=(row:unknown,owner=alice)=>trustedJarvisTaskView(row,org,owner,conversation,message);
describe('FIRBO server task status never invents another user\'s result',()=>{
 it('shows only the exact owner, origin, message and conversation',()=>{
  expect(view(task)).toEqual({status:'pending',reportAvailable:false});
  expect(view(task,bob)).toBeNull();
  expect(view({...task,organization_id:bob})).toBeNull();
  expect(view({...task,metadata:{...task.metadata,conversation_id:bob}})).toBeNull();
  expect(view({...task,metadata:{source:'client',conversation_id:conversation,message_id:message}})).toBeNull();
  expect(view({...task,id:bob})).toBeNull();
 });
 it('pending, ambiguous and unverified tasks cannot be presented as finished',()=>{
  expect(view({...task,status:'running'})).toEqual({status:'running',reportAvailable:false});
  expect(view({...task,status:'blocked',result:{reconcile_required:true}})).toEqual({status:'blocked',reportAvailable:false});
  expect(view({...task,status:'completed',result:{}})).toEqual({status:'completed',reportAvailable:false});
  expect(view({...task,status:'completed',result:{report:'Done',reconcile_required:true}})).toEqual({status:'completed',reportAvailable:false});
  expect(view({...task,status:'completed',result:{report:'Verified report available'}})).toEqual({status:'completed',reportAvailable:true});
 });
});
