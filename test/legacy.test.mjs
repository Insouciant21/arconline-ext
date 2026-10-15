import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLegacy, fingerprint } from '../scripts/lib/legacy.mjs';
const score={songId:'a',difficulty:2,score:9900000,rating:12,title:{en:'A'},timePlayed:1};
const snapshot={id:'one',fetchedAt:'2026-10-14T23:00:00Z',potential:12,weightedPotential:12,user:{rating:12},best50:[score]};
const source=(snapshots,points=[])=>({name:'fixture',data:{snapshots,points,charts:{},characters:{},aliases:{},logs:[]}});
test('migration is repeatable and prefers complete media while preserving all raw PTT points',()=>{
 const full={...snapshot,mediaStatus:'complete',potentialImageKey:'potential/one.png'};
 const points=[{date:'2026-10-15',fetchedAt:'2026-10-14T22:00:00Z',potential:12.1,snapshotId:'',source:'lowiro'},{date:'2026-10-15',fetchedAt:'2026-10-14T23:00:00Z',potential:11.9,snapshotId:'',source:'lowiro'}];
 const result=mergeLegacy([source([snapshot],points),source([full]),source([full],points)]);
 assert.equal(result.snapshots.length,1);assert.equal(result.snapshots[0].potentialImageKey,full.potentialImageKey);assert.equal(result.points.size,3);assert.equal(result.daily[0].potential,12.1);assert.equal(fingerprint(full),fingerprint(snapshot));
});
test('migration reports conflicting B50 bodies for the same ID instead of silently losing scores',()=>{
 const different={...snapshot,best50:[{...score,score:10000000}]};
 assert.equal(mergeLegacy([source([snapshot,different])]).conflicts.length,1);
});
test('migration rejects corrupt source records',()=>{
 assert.throws(()=>mergeLegacy([source([{...snapshot,potential:NaN}])]),/Invalid snapshot/);
});
