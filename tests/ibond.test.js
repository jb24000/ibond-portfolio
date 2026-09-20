import test from 'node:test';import assert from 'node:assert/strict';
import {compositeRate,fixedRateForIssue,inflationAnnouncementForPeriod,rateForBondPeriod,valueAtMonths,estimateBond,currentIssueInfo,setRateUpdates,nextRatePeriod,rateDataThrough} from '../ibond.js';

test('Treasury composite formula and rounding',()=>{assert.equal(compositeRate(.009,.0167),.0426);assert.equal(compositeRate(0,-.0278),0)});
test('historical fixed rates span 1998 to current',()=>{assert.equal(fixedRateForIssue('1998-09'),.034);assert.equal(fixedRateForIssue('2026-09'),.009)});
test('issue-month earning period maps to May/November inflation windows',()=>{assert.equal(inflationAnnouncementForPeriod('2026-09'),.0167);assert.equal(inflationAnnouncementForPeriod('2026-11'),.0167)});
test('new bond has current earning rate before first month completes',()=>{assert.equal(rateForBondPeriod('2026-09',0),.0426);const b=estimateBond({amount:100,issueMonth:'2026-09'},new Date(2026,8,20));assert.equal(b.rate,.0426);assert.equal(b.value,100);assert.equal(b.redeemable,0)});
test('six-month growth uses half annual composite rate',()=>{const r=rateForBondPeriod('2026-09',0),v=valueAtMonths(100,'2026-09',6);assert.equal(v.value,Math.round(100*(1+r/2)*100)/100)});
test('redemption is locked before 12 months',()=>{const b=estimateBond({amount:100,issueMonth:'2025-11'},new Date(2026,8,20));assert.equal(b.redeemable,0)});
test('under-five-year redemption applies three-month lag',()=>{const b=estimateBond({amount:100,issueMonth:'2025-05'},new Date(2026,8,20));const expected=valueAtMonths(100,'2025-05',13);assert.equal(b.redeemable,expected.value)});
test('five-year bond has no three-month penalty',()=>{const b=estimateBond({amount:100,issueMonth:'2021-09'},new Date(2026,8,20));const expected=valueAtMonths(100,'2021-09',60);assert.equal(b.redeemable,expected.value)});
test('maturity caps accrual at 30 years',()=>{const a=valueAtMonths(100,'1998-09',360),b=valueAtMonths(100,'1998-09',500);assert.equal(a.value,b.value)});

test('February issue crosses November and May inflation windows correctly',()=>{assert.equal(inflationAnnouncementForPeriod('2026-02'),.0156);assert.equal(inflationAnnouncementForPeriod('2026-08'),.0167)});
test('exact 12-month boundary unlocks redemption',()=>{const b=estimateBond({amount:100,issueMonth:'2025-09'},new Date(2026,8,20));assert.ok(b.redeemable>=100)});
test('59 months has penalty while 60 months does not',()=>{const a=estimateBond({amount:100,issueMonth:'2021-10'},new Date(2026,8,20)),b=estimateBond({amount:100,issueMonth:'2021-09'},new Date(2026,8,20));assert.equal(a.age,59);assert.equal(b.age,60);assert.ok(a.redeemable<valueAtMonths(100,'2021-10',59).value);assert.equal(b.redeemable,valueAtMonths(100,'2021-09',60).value)});
test('invalid pre-program issue and amount are unsupported',()=>{assert.equal(valueAtMonths(100,'1998-08',1).supported,false);assert.equal(valueAtMonths(0,'2026-09',1).supported,false)});
test('future unannounced rate periods are explicitly projected',()=>{const info=currentIssueInfo(new Date(2026,10,20));assert.equal(info.projected,true);const b=estimateBond({amount:100,issueMonth:'2026-11'},new Date(2026,10,20));assert.equal(b.projected,true)});

test('manual rate update becomes authoritative for new period',()=>{setRateUpdates([{key:'2026-11',fixed:.01,inflation:.02,modifiedAt:'2026-11-01T00:00:00Z'}]);const info=currentIssueInfo(new Date(2026,10,20));assert.equal(info.projected,false);assert.equal(info.fixed,.01);assert.equal(info.inflation,.02);assert.equal(info.rate,compositeRate(.01,.02));setRateUpdates([])});
test('manual inflation update applies to older bond while preserving its fixed rate',()=>{setRateUpdates([{key:'2026-11',fixed:.01,inflation:.02,modifiedAt:'2026-11-01T00:00:00Z'}]);assert.equal(fixedRateForIssue('2025-11'),.009);assert.equal(inflationAnnouncementForPeriod('2026-11'),.02);setRateUpdates([])});

test('manual updates cannot override embedded official history',()=>{setRateUpdates([{key:'2025-11',fixed:.19,inflation:.19,modifiedAt:'2027-01-01T00:00:00Z'}]);assert.equal(fixedRateForIssue('2025-11'),.009);assert.equal(inflationAnnouncementForPeriod('2025-11'),.0156);assert.equal(rateDataThrough(),'2026-05');setRateUpdates([])});
test('manual updates cannot skip the next announcement period',()=>{setRateUpdates([{key:'2027-05',fixed:.01,inflation:.02,modifiedAt:'2027-05-01T00:00:00Z'}]);assert.equal(rateDataThrough(),'2026-05');assert.equal(nextRatePeriod(),'2026-11');assert.equal(currentIssueInfo(new Date(2026,10,20)).projected,true);setRateUpdates([])});
test('manual rate periods advance contiguously May to November to May',()=>{setRateUpdates([{key:'2026-11',fixed:.01,inflation:.02,modifiedAt:'2026-11-01T00:00:00Z'},{key:'2027-05',fixed:.011,inflation:.021,modifiedAt:'2027-05-01T00:00:00Z'}]);assert.equal(rateDataThrough(),'2027-05');assert.equal(nextRatePeriod(),'2027-11');setRateUpdates([])});
test('January through April still require the prior November announcement',()=>{setRateUpdates([]);const info=currentIssueInfo(new Date(2027,0,20));assert.equal(info.projected,true);assert.equal(nextRatePeriod(),'2026-11')});
