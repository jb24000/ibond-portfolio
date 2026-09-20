import test from 'node:test';import assert from 'node:assert/strict';
import {compositeRate,fixedRateForIssue,inflationAnnouncementForPeriod,rateForBondPeriod,valueAtMonths,estimateBond} from '../ibond.js';

test('Treasury composite formula and rounding',()=>{assert.equal(compositeRate(.009,.0167),.0426);assert.equal(compositeRate(0,-.0278),0)});
test('historical fixed rates span 1998 to current',()=>{assert.equal(fixedRateForIssue('1998-09'),.034);assert.equal(fixedRateForIssue('2026-09'),.009)});
test('issue-month earning period maps to May/November inflation windows',()=>{assert.equal(inflationAnnouncementForPeriod('2026-09'),.0167);assert.equal(inflationAnnouncementForPeriod('2026-11'),.0167)});
test('new bond has current earning rate before first month completes',()=>{assert.equal(rateForBondPeriod('2026-09',0),.0426);const b=estimateBond({amount:100,issueMonth:'2026-09'},new Date(2026,8,20));assert.equal(b.rate,.0426);assert.equal(b.value,100);assert.equal(b.redeemable,0)});
test('six-month growth uses half annual composite rate',()=>{const r=rateForBondPeriod('2026-09',0),v=valueAtMonths(100,'2026-09',6);assert.equal(v.value,Math.round(100*(1+r/2)*100)/100)});
test('redemption is locked before 12 months',()=>{const b=estimateBond({amount:100,issueMonth:'2025-11'},new Date(2026,8,20));assert.equal(b.redeemable,0)});
test('under-five-year redemption applies three-month lag',()=>{const b=estimateBond({amount:100,issueMonth:'2025-05'},new Date(2026,8,20));const expected=valueAtMonths(100,'2025-05',13);assert.equal(b.redeemable,expected.value)});
test('five-year bond has no three-month penalty',()=>{const b=estimateBond({amount:100,issueMonth:'2021-09'},new Date(2026,8,20));const expected=valueAtMonths(100,'2021-09',60);assert.equal(b.redeemable,expected.value)});
test('maturity caps accrual at 30 years',()=>{const a=valueAtMonths(100,'1998-09',360),b=valueAtMonths(100,'1998-09',500);assert.equal(a.value,b.value)});
