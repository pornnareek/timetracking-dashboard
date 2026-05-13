// api/data.js — Full Custom Fields Support
const WORKING_DAYS={
  "Jan":20,"Feb":20,"Mar":21,"Apr":19,"May":21,
  "Jun":21,"Jul":23,"Aug":21,"Sep":22,"Oct":22,"Nov":21,"Dec":23
};
const MS=3600000, HPD=8;
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmy(d){return`${MN[d.getMonth()]} ${d.getFullYear()}`;}
function fDays(ms){
  if(!ms)return"0 d 00 h 00 m";
  const h=ms/MS,d=Math.floor(h/HPD),rh=Math.floor(h%HPD),rm=Math.floor((h%1)*60);
  return`${d} d ${String(rh).padStart(2,"0")} h ${String(rm).padStart(2,"0")} m`;
}
function fHrs(ms){
  if(!ms)return"0h 0m";
  const h=ms/MS,rh=Math.floor(h),rm=Math.floor((h%1)*60);
  return`${rh}h ${String(rm).padStart(2,"0")}m`;
}
function cfVal(task, ...names){
  if(!task?.custom_fields)return"";
  for(const n of names){
    const f=task.custom_fields.find(f=>f.name?.toLowerCase()===n.toLowerCase());
    if(f){
      if(f.value===null||f.value===undefined)continue;
      if(typeof f.value==='string')return f.value;
      if(f.type==='date')return f.value?new Date(Number(f.value)).toLocaleDateString('th-TH'):'';
      if(f.type_config?.options){
        const opt=f.type_config.options.find(o=>o.id===f.value||o.orderindex===f.value);
        if(opt)return opt.name;
      }
      return String(f.value);
    }
  }
  return"";
}

// Batch fetch tasks with custom fields
async function fetchTasks(taskIds, token){
  const results={};
  const batches=[];
  for(let i=0;i<taskIds.length;i+=10) batches.push(taskIds.slice(i,i+10));
  await Promise.all(batches.map(async batch=>{
    await Promise.all(batch.map(async id=>{
      try{
        const r=await fetch(`https://api.clickup.com/api/v2/task/${id}?custom_fields=true`,{headers:{Authorization:token}});
        if(r.ok){const t=await r.json();results[id]=t;}
      }catch(e){}
    }));
  }));
  return results;
}

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  const token=process.env.CLICKUP_API_TOKEN, teamId=process.env.CLICKUP_TEAM_ID;
  const groupId=process.env.CLICKUP_GROUP_ID||"";
  const startYear=parseInt(process.env.START_YEAR||"2025"), endYear=new Date().getFullYear();
  if(!token||!teamId)return res.status(500).json({error:"กรุณาตั้งค่า Environment Variables ใน Vercel ก่อนค่ะ"});

  // ── ดึง members จาก Group หรือ Team ──
  let memberIds=[];
  if(groupId){
    // ดึง members จาก Group ID (แนะนำ - ได้ข้อมูลทุกคนในกลุ่ม)
    try{
      const r=await fetch(`https://api.clickup.com/api/v2/group?team_id=${teamId}&group_id=${groupId}`,{headers:{Authorization:token}});
      if(r.ok){
        const d=await r.json();
        const group=(d.groups||[])[0];
        memberIds=(group?.members||[]).map(m=>m.user?.id||m.id).filter(Boolean);
      }
    }catch(e){}
  }
  if(memberIds.length===0){
    // fallback: ดึงจาก team members
    try{
      const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/member`,{headers:{Authorization:token}});
      if(r.ok){const d=await r.json();memberIds=(d.members||[]).map(m=>m.user?.id).filter(Boolean);}
    }catch(e){}
  }

  // ── ดึง time entries ──
  let allEntries=[];
  // ใช้ memberIds เสมอ (ไม่ว่าจะมาจาก Group หรือ Team)
  const assigneeParam=memberIds.length>0?`&assignee=${memberIds.join(",")}`:"";

  for(let y=startYear;y<=endYear;y++){
    const s=new Date(`${y}-01-01`).getTime(), e=new Date(`${y}-12-31T23:59:59`).getTime();
    let page=0;
    try{
      while(true){
        const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries?start_date=${s}&end_date=${e}${assigneeParam}&page=${page}`,{headers:{Authorization:token}});
        if(!r.ok){const e=await r.json().catch(()=>({}));return res.status(r.status).json({error:`ClickUp Error: ${e.err||r.status}`});}
        const{data=[]}=await r.json();
        // กรองเฉพาะ entry ที่ duration สมเหตุสมผล (≤24 ชั่วโมง = 86,400,000 ms ต่อ entry)
        const valid=data.filter(e=>Number(e.duration)>0&&Number(e.duration)<=86400000);
        allEntries=allEntries.concat(valid);
        if(data.length<100)break;
        if(++page>100)break;
      }
    }catch(e){return res.status(500).json({error:e.message});}
  }

  // ── ดึง Task Details (Custom Fields) ──
  const uniqueTaskIds=[...new Set(allEntries.map(e=>e.task?.id).filter(Boolean))];
  const taskMap=await fetchTasks(uniqueTaskIds.slice(0,500), token); // max 500 tasks

  // ── PersonSummary ──
  const now=new Date();
  const months=[];
  for(let y=startYear;y<=endYear;y++){
    const max=y===endYear?now.getMonth():11;
    for(let m=0;m<=max;m++)months.push(`${MN[m]} ${y}`);
  }
  const years=[];for(let y=startYear;y<=endYear;y++)years.push(y);
  function getTgt(y){const max=y===endYear?now.getMonth():11;let t=0;for(let m=0;m<=max;m++)t+=WORKING_DAYS[MN[m]]||0;return t;}

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
    for(const m of months){const ms=p.monthly[m]||0;md[m]={ms,display:fDays(ms)};tot+=ms;}
    const yd={};
    for(const y of years){
      const ms=p.yearly[y]||0,tgt=getTgt(y),pct=tgt>0?(ms/MS/HPD)/tgt:0;
      yd[y]={ms,display:fDays(ms),pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
    }
    const tTgt=years.reduce((s,y)=>s+getTgt(y),0),pct=tTgt>0?(tot/MS/HPD)/tTgt:0;
    return{name:p.name,dept:p.dept,email:p.email,monthly:md,yearly:yd,total:fDays(tot),totalMs:tot,pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
  }).sort((a,b)=>a.dept.localeCompare(b.dept)||a.name.localeCompare(b.name));

  // ── ProjectSummary ──
  const projMap={};
  for(const e of allEntries){
    const task=taskMap[e.task?.id];
    const ms=Number(e.duration)||0;
    const d=new Date(Number(e.start)),yr=d.getFullYear();
    const userName=e.user?.username||e.user?.email||"Unknown";
    const dept=(userName.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";

    // ดึง Custom Fields
    const company   = cfVal(task,"Company Name","company name","บริษัท","client","Company") || e.task_location?.space_name || "(ไม่ระบุ)";
    const jobId     = cfVal(task,"Job ID","job id","JobID","รหัสงาน","job") || e.task_location?.list_name || "(ไม่ระบุ)";
    const projDesc  = cfVal(task,"Project Description","project","โปรเจค","description") || e.task?.name || "";
    const owner     = cfVal(task,"Project Owner","owner","เจ้าของ","project owner","assigned to") || "";
    const manDayMs  = Number(cfVal(task,"Man Day","man day","man-day","manday","Man-Day (IT & DEV)","quota")) || 0;
    const goLive    = cfVal(task,"Go Live","go live","golive","launch","delivery date") || "";
    const workType  = cfVal(task,"Work Type","work type","ประเภทงาน") || "Project";
    const projStatus= cfVal(task,"Project Status","project status","สถานะ") || task?.status?.status || "On Going";
    const timeEst   = Number(task?.time_estimate)||0;

    const key=`${company}||${jobId}`;
    if(!projMap[key]){
      projMap[key]={
        company,jobId,projDesc,owner,workType,projStatus,goLive,
        dept,manDayMs,timeEstMs:timeEst,trackedMs:0,
        yearly:{},users:new Set()
      };
    }
    projMap[key].trackedMs+=ms;
    projMap[key].yearly[yr]=(projMap[key].yearly[yr]||0)+ms;
    projMap[key].users.add(userName);
    // อัปเดต custom fields ถ้ายังไม่มี
    if(!projMap[key].owner&&owner)projMap[key].owner=owner;
    if(!projMap[key].goLive&&goLive)projMap[key].goLive=goLive;
    if(!projMap[key].timeEstMs&&timeEst)projMap[key].timeEstMs=timeEst;
    if(!projMap[key].manDayMs&&manDayMs)projMap[key].manDayMs=manDayMs;
  }

  const projects=Object.values(projMap).map(p=>{
    const overMs=p.manDayMs>0?p.manDayMs-p.trackedMs:0;
    const remainPct=p.manDayMs>0?Math.round((overMs/p.manDayMs)*100):null;
    let progress="";
    if(p.manDayMs>0){
      if(overMs<0)progress="❌ Over Quota";
      else if(remainPct>=20)progress=`✅ Remaining ${remainPct}%`;
      else progress=`⚠️ Remaining ${remainPct}%`;
    }
    return{
      company:p.company, jobId:p.jobId, projDesc:p.projDesc,
      owner:p.owner, workType:p.workType, projStatus:p.projStatus, goLive:p.goLive,
      dept:p.dept,
      manDay:p.manDayMs>0?fDays(p.manDayMs):"No Man Day",
      manDayMs:p.manDayMs,
      timeEst:p.timeEstMs>0?fDays(p.timeEstMs):"",
      timeEstMs:p.timeEstMs,
      tracked:fDays(p.trackedMs), trackedMs:p.trackedMs,
      overQuota:p.manDayMs>0?(overMs>=0?fDays(overMs):"-"+fDays(Math.abs(overMs))):"",
      overMs, progress, remainPct,
      yearly:Object.fromEntries(years.map(y=>[y,{ms:p.yearly[y]||0,display:fHrs(p.yearly[y]||0)}])),
      users:[...p.users]
    };
  }).sort((a,b)=>a.company.localeCompare(b.company)||a.jobId.localeCompare(b.jobId));

  // ── Summaries ──
  const deptSummary={},summary={ok:0,warn:0,bad:0,total:0};
  for(const p of persons){
    if(!deptSummary[p.dept])deptSummary[p.dept]={ok:0,warn:0,bad:0,total:0};
    deptSummary[p.dept].total++;deptSummary[p.dept][p.status]++;
    summary.total++;summary[p.status]++;
  }

  // unique values for dropdowns
  const companies=[...new Set(projects.map(p=>p.company))].sort();
  const owners=[...new Set(projects.map(p=>p.owner).filter(Boolean))].sort();
  const statuses=[...new Set(projects.map(p=>p.projStatus).filter(Boolean))].sort();
  const workTypes=[...new Set(projects.map(p=>p.workType).filter(Boolean))].sort();
  const depts=[...new Set(persons.map(p=>p.dept))].sort();

  res.json({
    persons,projects,months,years,deptSummary,summary,
    dropdowns:{companies,owners,statuses,workTypes,depts},
    startYear,endYear,updatedAt:new Date().toISOString()
  });
}
