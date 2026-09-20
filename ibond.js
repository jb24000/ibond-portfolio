// Treasury Series I Savings Bond calculation engine.
// Source data: U.S. Treasury Series I earnings-rate chart effective May 1, 2026.
// Rates are decimals (0.009 = 0.90%). Composite rate is an annual rate applied for six months.

export const FIXED_RATES=[
['1998-09',.034],['1998-11',.033],['1999-05',.033],['1999-11',.034],['2000-05',.036],['2000-11',.034],
['2001-05',.03],['2001-11',.02],['2002-05',.02],['2002-11',.016],['2003-05',.011],['2003-11',.011],
['2004-05',.01],['2004-11',.01],['2005-05',.012],['2005-11',.01],['2006-05',.014],['2006-11',.014],
['2007-05',.013],['2007-11',.012],['2008-05',0],['2008-11',.007],['2009-05',.001],['2009-11',.003],
['2010-05',.002],['2010-11',0],['2011-05',0],['2011-11',0],['2012-05',0],['2012-11',0],
['2013-05',0],['2013-11',.002],['2014-05',.001],['2014-11',0],['2015-05',0],['2015-11',.001],
['2016-05',.001],['2016-11',0],['2017-05',0],['2017-11',.001],['2018-05',.003],['2018-11',.005],
['2019-05',.005],['2019-11',.002],['2020-05',0],['2020-11',0],['2021-05',0],['2021-11',0],
['2022-05',0],['2022-11',.004],['2023-05',.009],['2023-11',.013],['2024-05',.013],['2024-11',.012],
['2025-05',.011],['2025-11',.009],['2026-05',.009]
];

export const INFLATION_RATES=[
['1998-09',.0062],['1998-11',.0086],['1999-05',.0086],['1999-11',.0176],['2000-05',.0191],['2000-11',.0152],
['2001-05',.0144],['2001-11',.0119],['2002-05',.0028],['2002-11',.0123],['2003-05',.0177],['2003-11',.0054],
['2004-05',.0119],['2004-11',.0133],['2005-05',.0179],['2005-11',.0285],['2006-05',.005],['2006-11',.0155],
['2007-05',.0121],['2007-11',.0153],['2008-05',.0242],['2008-11',.0246],['2009-05',-.0278],['2009-11',.0153],
['2010-05',.0077],['2010-11',.0037],['2011-05',.023],['2011-11',.0153],['2012-05',.011],['2012-11',.0088],
['2013-05',.0059],['2013-11',.0059],['2014-05',.0092],['2014-11',.0074],['2015-05',-.008],['2015-11',.0077],
['2016-05',.0008],['2016-11',.0138],['2017-05',.0098],['2017-11',.0124],['2018-05',.0111],['2018-11',.0116],
['2019-05',.007],['2019-11',.0101],['2020-05',.0053],['2020-11',.0084],['2021-05',.0177],['2021-11',.0356],
['2022-05',.0481],['2022-11',.0324],['2023-05',.0169],['2023-11',.0197],['2024-05',.0148],['2024-11',.0095],
['2025-05',.0143],['2025-11',.0156],['2026-05',.0167]
];

function latestAtOrBefore(table,key){
 let hit=null;
 for(const row of table){if(row[0]<=key)hit=row;else break}
 return hit;
}
export function addMonthsKey(ym,n){
 let [y,m]=ym.split('-').map(Number);let idx=y*12+(m-1)+n;
 return Math.floor(idx/12)+'-'+String((idx%12)+1).padStart(2,'0');
}
export function monthDiff(issue,now=new Date()){
 const [y,m]=issue.split('-').map(Number);
 return Math.max(0,(now.getFullYear()-y)*12+(now.getMonth()+1-m));
}
export function monthDate(ym){
 const [y,m]=ym.split('-').map(Number);
 return new Date(y,m-1,1);
}
export function fmtMonthKey(ym){
 return monthDate(ym).toLocaleDateString('en-US',{month:'short',year:'numeric'});
}
export function fixedRateForIssue(issueMonth){
 return latestAtOrBefore(fixedTable(),issueMonth)?.[1]??null;
}
export const DATA_THROUGH=INFLATION_RATES.at(-1)[0];
let RATE_UPDATES=[];
export function setRateUpdates(updates=[]){
 RATE_UPDATES=Array.isArray(updates)?updates.filter(r=>r&&/^\d{4}-(05|11)$/.test(r.key)&&Number.isFinite(Number(r.fixed))&&Number.isFinite(Number(r.inflation))).map(r=>({...r,fixed:Number(r.fixed),inflation:Number(r.inflation)})):[];
}
function fixedTable(){return [...FIXED_RATES,...RATE_UPDATES.map(r=>[r.key,r.fixed])].sort((a,b)=>a[0].localeCompare(b[0]))}
function inflationTable(){return [...INFLATION_RATES,...RATE_UPDATES.map(r=>[r.key,r.inflation])].sort((a,b)=>a[0].localeCompare(b[0]))}
export function rateDataThrough(){return inflationTable().at(-1)?.[0]??DATA_THROUGH}
export function inflationKeyForPeriod(periodStart){
 if(periodStart<'1998-09')return null;
 const [y,m]=periodStart.split('-').map(Number);
 if(y===1998&&(m===9||m===10))return '1998-09';
 if(m>=5&&m<=10)return y+'-05';
 if(m>=11)return y+'-11';
 return (y-1)+'-11';
}
export function inflationAnnouncementForPeriod(periodStart){
 const key=inflationKeyForPeriod(periodStart);if(!key)return null;
 return latestAtOrBefore(inflationTable(),key)?.[1]??null;
}
function periodInfo(issueMonth,periodIndex){
 const fixed=fixedRateForIssue(issueMonth),start=addMonthsKey(issueMonth,periodIndex*6),inflationKey=inflationKeyForPeriod(start);
 const inflation=inflationAnnouncementForPeriod(start);
 return {rate:compositeRate(fixed,inflation),projected:inflationKey>rateDataThrough(),inflationKey};
}
export function compositeRate(fixed,inflation){
 if(fixed==null||inflation==null)return null;
 const raw=fixed+(2*inflation)+(fixed*inflation);
 return Math.max(0,Math.round(raw*10000)/10000);
}
function roundCent(n){return Math.round((n+Number.EPSILON)*100)/100}
export function rateForBondPeriod(issueMonth,periodIndex){return periodInfo(issueMonth,periodIndex).rate}
export function valueAtMonths(principal,issueMonth,months){
 const fixed=fixedRateForIssue(issueMonth);
 if(fixed==null)return {supported:false,value:null,rate:null};
 let pv=Number(principal),elapsed=0,capped=Math.max(0,Math.min(360,months)),projected=false;
 if(!Number.isFinite(pv)||pv<=0)return {supported:false,value:null,rate:null};
 while(elapsed<capped){
  const periodIndex=Math.floor(elapsed/6),info=periodInfo(issueMonth,periodIndex),rate=info.rate;projected||=info.projected;
  if(rate==null)return {supported:false,value:null,rate:null,projected};
  const m=Math.min(6,capped-elapsed);
  const fv=roundCent(pv*Math.pow(1+(rate/2),m/6));
  if(m<6)return {supported:true,value:fv,rate,projected};
  pv=fv;elapsed+=6;
 }
 const info=periodInfo(issueMonth,Math.floor(Math.min(capped,359)/6));projected||=info.projected;
 return {supported:info.rate!=null,value:pv,rate:info.rate,projected};
}
export function estimateBond(b,now=new Date()){
 const principal=Number(b.amount),age=Math.min(360,monthDiff(b.issueMonth,now));
 const accrued=valueAtMonths(principal,b.issueMonth,age);
 if(!accrued.supported)return {unsupported:true,value:null,redeemable:null,interest:null,rate:null,age};
 const currentInfo=periodInfo(b.issueMonth,Math.floor(Math.min(age,359)/6)),currentRate=currentInfo.rate;
 let redeemable=0;
 if(age>=12){
  const redeemMonths=age<60?Math.max(0,age-3):age;
  const r=valueAtMonths(principal,b.issueMonth,redeemMonths);
  if(!r.supported)return {unsupported:true,value:null,redeemable:null,interest:null,rate:null,age};
  redeemable=Math.max(principal,r.value);
 }
 return {
  unsupported:false,value:accrued.value,redeemable,interest:roundCent(accrued.value-principal),rate:currentRate,projected:accrued.projected||currentInfo.projected,age,
  unlockDate:addMonthsKey(b.issueMonth,12),penaltyEnd:addMonthsKey(b.issueMonth,60),maturityDate:addMonthsKey(b.issueMonth,360)
 };
}
export function currentIssueInfo(now=new Date()){
 const ym=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');
 const fixed=fixedRateForIssue(ym),infl=inflationAnnouncementForPeriod(ym),rate=compositeRate(fixed,infl),inflationKey=inflationKeyForPeriod(ym),dataThrough=rateDataThrough(),projected=inflationKey>dataThrough;
 const nextReset=now.getMonth()+1<11?now.getFullYear()+'-11':(now.getFullYear()+1)+'-05';
 return {issueMonth:ym,fixed,inflation:infl,rate,nextReset,dataThrough,projected};
}