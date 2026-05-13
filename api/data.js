// api/data.js — Optimized Version (fast + Google Sheet + ClickUp)
export const config = { maxDuration: 60 };

const WORKING_DAYS={Jan:20,Feb:20,Mar:21,Apr:19,May:21,Jun:21,Jul:23,Aug:21,Sep:22,Oct:22,Nov:21,Dec:23};
const MS=3600000,HPD=8;
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmy(d){return`${MN[d.getMonth()]} ${d.getFullYear()}`;}

// Extract Job ID from task name: "COMPANY | JOB_ID : Description"
function extractJobId(name){
  if(!name)return"";
  const m=name.match(/\|\s*([^:()\n]+?)(?:\s*[\(:]|$)/);
  return m?m[1].trim():"";
}

// Simple CSV parser
function parseCSV(text){
  const rows=[];
  for(const line of text.split(/\r?\n/)){
    if(!line.trim())continue;
    const cols=[];let inQ=false,col="";
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"'&&!inQ){inQ=true;continue;}
      if(c==='"'&&inQ&&line[i+1]==='"'){col+='"';i++;continue;}
      if(c==='"'&&inQ){inQ=false;continue;}
      if(c===','&&!inQ){cols.push(col.trim());col="";continue;}
      col+=c;
    }
    cols.push(col.trim());
    rows.push(cols);
  }
  return rows;
}

// Fetch project metadata from Google Sheet
async function fetchProjectData(sheetId,gid){
  try{
    const url=`https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
    const r=await fetch(url,{signal:AbortSignal.timeout(8000)});
    if(!r.ok)return{};
    const rows=parseCSV(await r.text());
    let hIdx=-1,headers=[];
    for(let i=0;i<rows.length;i++){
      if(rows[i].some(c=>/job.?id|work.?type/i.test(c))){hIdx=i;headers=rows[i].map(h=>h.trim().toLowerCase());break;}
    }
    if(hIdx===-1)return{};
    const ci=kws=>headers.findIndex(h=>kws.some(k=>h.includes(k)));
    const col={
      workType:ci(['work type']),company:ci(['company name','company']),
      jobId:ci(['job id','jobid','job_id']),desc:ci(['project description','description']),
      status:ci(['project status']),goLive:ci(['go live','golive']),
      owner:ci(['project owner']),statusPay:ci(['status payment']),
      remark:ci(['remark']),startTrk:ci(['start time tracking']),
      endTrk:ci(['end time tracking']),manDayMs:ci(['มิลลิวินาที','milliseconds']),
    };
    const data={};
    for(let i=hIdx+1;i<rows.length;i++){
      const row=rows[i];
      const jobId=col.jobId>=0?row[col.jobId]?.trim():'';
      if(!jobId)continue;
      data[jobId]={
        workType: col.workType>=0?  row[col.workType]:'',
        company:  col.company>=0?   row[col.company]:'',
        desc:     col.desc>=0?      row[col.desc]:'',
        status:   col.status>=0?    row[col.status]:'',
        goLive:   col.goLive>=0?    row[col.goLive]:'',
        owner:    col.owner>=0?     row[col.owner]:'',
        statusPay:col.statusPay>=0? row[col.statusPay]:'',
        remark:   col.remark>=0?    row[col.remark]:'',
        startTrk: col.startTrk>=0?  row[col.startTrk]:'',
        endTrk:   col.endTrk>=0?    row[col.endTrk]:'',
        manDayMs: col.manDayMs>=0?  Number(row[col.manDayMs]?.replace(/[^\d]/g,''))||0:0,
      };
    }
    return data;
  }catch(e){return{};}
}

// Fetch time entries for one year (one page at a time)
async function fetchYear(teamId,token,year,assigneeParam,maxPages=10){
  const s=new Date(`${year}-01-01`).getTime(),e=new Date(`${year}-12-31T23:59:59`).getTime();
  const entries=[];
  for(let page=0;page<maxPages;page++){
    try{
      const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries?start_date=${s}&end_date=${e}${assigneeParam}&page=${page}`,
        {headers:{Authorization:token},signal:AbortSignal.timeout(8000)});
      if(!r.ok)break;
      const{data=[]}=await r.json();
      entries.push(...data.filter(e=>Number(e.duration)>0&&Number(e.duration)<=86400000));
      if(data.length<100)break;
    }catch(e){break;}
  }
  return entries;
}

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  const token=process.env.CLICKUP_API_TOKEN,teamId=process.env.CLICKUP_TEAM_ID;
  const groupId=process.env.CLICKUP_GROUP_ID||"";
  const sheetId=process.env.GOOGLE_SHEET_ID||"1Fyq7siMQRe-AJpS3-R5gx1emot27ZIuD_3uq11vXJy4";
  const sheetGid=process.env.GOOGLE_SHEET_GID||"762587853";
  const startYear=parseInt(process.env.START_YEAR||"2025"),endYear=new Date().getFullYear();
  if(!token||!teamId)return res.status(500).json({error:"กรุณาตั้งค่า Environment Variables ก่อนค่ะ"});

  // ── ดึงข้อมูลพร้อมกัน: Google Sheet + Members ──
  const [projData,memberIds] = await Promise.all([
    fetchProjectData(sheetId,sheetGid),
    (async()=>{
      let ids=[];
      if(groupId){
        try{
          const r=await fetch(`https://api.clickup.com/api/v2/group?team_id=${teamId}&group_id=${groupId}`,
            {headers:{Authorization:token},signal:AbortSignal.timeout(5000)});
          if(r.ok){const d=await r.json();const g=(d.groups||[])[0];ids=(g?.members||[]).map(m=>m.user?.id||m.id).filter(Boolean);}
        }catch(e){}
      }
      if(!ids.length){
        try{
          const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/member`,
            {headers:{Authorization:token},signal:AbortSignal.timeout(5000)});
          if(r.ok){const d=await r.json();ids=(d.members||[]).map(m=>m.user?.id).filter(Boolean);}
        }catch(e){}
      }
      return ids;
    })()
  ]);

  const assigneeParam=memberIds.length>0?`&assignee=${memberIds.join(",")}`:"";
  const years=[];for(let y=startYear;y<=endYear;y++)years.push(y);

  // ── ดึง Time Entries ทุกปีพร้อมกัน ──
  const yearEntries=await Promise.all(years.map(y=>fetchYear(teamId,token,y,assigneeParam,8)));
  const allEntries=yearEntries.flat();

  // ── Setup months ──
  const now=new Date(),months=[];
  for(let y=startYear;y<=endYear;y++){
    const max=y===endYear?now.getMonth():11;
    for(let m=0;m<=max;m++)months.push(`${MN[m]} ${y}`);
  }
  function getTgt(y){const max=y===endYear?now.getMonth():11;let t=0;for(let m=0;m<=max;m++)t+=WORKING_DAYS[MN[m]]||0;return t;}

  // ── PersonSummary ──
  const pMap={};
  for(const e of allEntries){
    const d=new Date(Number(e.start)),my=fmy(d),yr=d.getFullYear(),ms=Number(e.duration)||0;
    const name=e.user?.username||e.user?.email||"Unknown";
    const dept=(name.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";
    if(!pMap[name])pMap[name]={name,dept,email:e.user?.email||"",monthly:{},yearly:{}};
    pMap[name].monthly[my]=(pMap[name].monthly[my]||0)+ms;
    pMap[name].yearly[yr]=(pMap[name].yearly[yr]||0)+ms;
  }
  const persons=Object.values(pMap).map(p=>{
    const md={};let tot=0;
    for(const m of months){const ms=p.monthly[m]||0;md[m]={ms};tot+=ms;}
    const yd={};
    for(const y of years){
      const ms=p.yearly[y]||0,tgt=getTgt(y),pct=tgt>0?(ms/MS/HPD)/tgt:0;
      yd[y]={ms,pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
    }
    const tTgt=years.reduce((s,y)=>s+getTgt(y),0),pct=tTgt>0?(tot/MS/HPD)/tTgt:0;
    return{name:p.name,dept:p.dept,email:p.email,monthly:md,yearly:yd,
      totalMs:tot,pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
  }).sort((a,b)=>a.dept.localeCompare(b.dept)||a.name.localeCompare(b.name));

  // ── ProjectSummary ──
  const projMap={};
  for(const e of allEntries){
    const taskName=e.task?.name||"";
    const jobId=extractJobId(taskName)||e.task_location?.list_name||"(ไม่ระบุ)";
    const ms=Number(e.duration)||0;
    const d=new Date(Number(e.start)),yr=d.getFullYear();
    const userName=e.user?.username||e.user?.email||"Unknown";
    const dept=(userName.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";
    const meta=projData[jobId]||{};
    if(!projMap[jobId]){
      projMap[jobId]={
        company:meta.company||e.task_location?.space_name||"(ไม่ระบุ)",
        jobId,desc:meta.desc||taskName,owner:meta.owner||"",
        workType:meta.workType||"Project",status:meta.status||e.task?.status?.status||"",
        goLive:meta.goLive||"",statusPay:meta.statusPay||"",remark:meta.remark||"",
        startTrk:meta.startTrk||"",endTrk:meta.endTrk||"",
        manDayMs:meta.manDayMs||0,dept,trackedMs:0,yearly:{},personTime:{}
      };
    }
    if(meta.company)projMap[jobId].company=meta.company;
    if(meta.manDayMs)projMap[jobId].manDayMs=meta.manDayMs;
    projMap[jobId].trackedMs+=ms;
    projMap[jobId].yearly[yr]=(projMap[jobId].yearly[yr]||0)+ms;
    projMap[jobId].personTime[userName]=(projMap[jobId].personTime[userName]||0)+ms;
  }

  const projects=Object.values(projMap).map(p=>{
    const overMs=p.manDayMs>0?p.manDayMs-p.trackedMs:null;
    const remainPct=p.manDayMs>0?Math.round(((p.manDayMs-p.trackedMs)/p.manDayMs)*100):null;
    let progress="",progressType="none";
    if(p.manDayMs>0){
      if(overMs<0){progress="❌ Over Quota";progressType="bad";}
      else if(remainPct>=20){progress=`✅ Remaining ${remainPct}%`;progressType="ok";}
      else{progress=`⚠️ Remaining ${remainPct}%`;progressType="warn";}
    }else{progress="No Man Day";}
    return{company:p.company,jobId:p.jobId,desc:p.desc,owner:p.owner,
      workType:p.workType,status:p.status,goLive:p.goLive,statusPay:p.statusPay,
      remark:p.remark,startTrk:p.startTrk,endTrk:p.endTrk,dept:p.dept,
      manDayMs:p.manDayMs,trackedMs:p.trackedMs,overMs,progress,progressType,remainPct,
      yearly:Object.fromEntries(years.map(y=>[y,{ms:p.yearly[y]||0}])),
      personTime:Object.entries(p.personTime).sort((a,b)=>b[1]-a[1]).map(([n,ms])=>({name:n,ms}))
    };
  }).sort((a,b)=>a.company.localeCompare(b.company)||a.jobId.localeCompare(b.jobId));

  const deptSummary={},summary={ok:0,warn:0,bad:0,total:0};
  for(const p of persons){
    if(!deptSummary[p.dept])deptSummary[p.dept]={ok:0,warn:0,bad:0,total:0};
    deptSummary[p.dept].total++;deptSummary[p.dept][p.status]++;
    summary.total++;summary[p.status]++;
  }
  const dropdowns={
    companies:[...new Set(projects.map(p=>p.company).filter(c=>c&&c!=='(ไม่ระบุ)'))].sort(),
    owners:   [...new Set(projects.map(p=>p.owner).filter(Boolean))].sort(),
    statuses: [...new Set(projects.map(p=>p.status).filter(Boolean))].sort(),
    workTypes:[...new Set(projects.map(p=>p.workType).filter(Boolean))].sort(),
    depts:    [...new Set(persons.map(p=>p.dept))].sort(),
  };

  res.json({persons,projects,months,years,deptSummary,summary,dropdowns,
    debug:{memberCount:memberIds.length,totalEntries:allEntries.length,projDataCount:Object.keys(projData).length},
    startYear,endYear,updatedAt:new Date().toISOString()});
}
