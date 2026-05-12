// api/data.js — Multi-Year + All Members + Project Summary
const WORKING_DAYS={
  "Jan":20,"Feb":20,"Mar":21,"Apr":19,"May":21,
  "Jun":21,"Jul":23,"Aug":21,"Sep":22,"Oct":22,"Nov":21,"Dec":23
};
const MS=3600000,HPD=8;
const MN=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmy(d){return`${MN[d.getMonth()]} ${d.getFullYear()}`;}
function fdur(ms){
  if(!ms)return"0 d 00 h 00 m";
  const h=ms/MS,d=Math.floor(h/HPD),rh=Math.floor(h%HPD),rm=Math.floor((h%1)*60);
  return`${d} d ${String(rh).padStart(2,"0")} h ${String(rm).padStart(2,"0")} m`;
}
function fhrs(ms){
  if(!ms)return"0h 0m";
  const h=ms/MS,rh=Math.floor(h),rm=Math.floor((h%1)*60);
  return`${rh}h ${String(rm).padStart(2,"0")}m`;
}

export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  const token=process.env.CLICKUP_API_TOKEN,teamId=process.env.CLICKUP_TEAM_ID;
  const startYear=parseInt(process.env.START_YEAR||"2025"),endYear=new Date().getFullYear();
  if(!token||!teamId)return res.status(500).json({error:"กรุณาตั้งค่า Environment Variables ใน Vercel ก่อนค่ะ"});

  // ── ดึง members ──
  let memberIds=[];
  try{
    const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/member`,{headers:{Authorization:token}});
    if(r.ok){const d=await r.json();memberIds=(d.members||[]).map(m=>m.user?.id).filter(Boolean);}
  }catch(e){}

  // ── ดึง time entries ทุกปี ──
  let all=[];
  for(let y=startYear;y<=endYear;y++){
    const s=new Date(`${y}-01-01`).getTime(),e=new Date(`${y}-12-31T23:59:59`).getTime();
    const ap=memberIds.length>0?`&assignee=${memberIds.join(",")}`:"";
    let page=0;
    try{
      while(true){
        const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries?start_date=${s}&end_date=${e}${ap}&page=${page}`,{headers:{Authorization:token}});
        if(!r.ok){const e=await r.json().catch(()=>({}));return res.status(r.status).json({error:`ClickUp Error: ${e.err||r.status}`});}
        const{data=[]}=await r.json();
        all=all.concat(data);
        if(data.length<100)break;
        if(++page>100)break;
      }
    }catch(e){return res.status(500).json({error:e.message});}
  }

  const now=new Date();
  const months=[];
  for(let y=startYear;y<=endYear;y++){
    const max=y===endYear?now.getMonth():11;
    for(let m=0;m<=max;m++)months.push(`${MN[m]} ${y}`);
  }
  function getTgt(year){
    const max=year===endYear?now.getMonth():11;
    let t=0;for(let m=0;m<=max;m++)t+=WORKING_DAYS[MN[m]]||0;return t;
  }
  const years=[];for(let y=startYear;y<=endYear;y++)years.push(y);

  // ── PersonSummary ──
  const pMap={};
  for(const e of all){
    const d=new Date(Number(e.start)),my=fmy(d),yr=d.getFullYear(),ms=Number(e.duration)||0;
    const name=e.user?.username||e.user?.email||"Unknown";
    const dept=(name.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";
    if(!pMap[name])pMap[name]={name,dept,email:e.user?.email||"",monthly:{},yearly:{}};
    pMap[name].monthly[my]=(pMap[name].monthly[my]||0)+ms;
    pMap[name].yearly[yr]=(pMap[name].yearly[yr]||0)+ms;
  }
  const persons=Object.values(pMap).map(p=>{
    const md={};let tot=0;
    for(const m of months){const ms=p.monthly[m]||0;md[m]={ms,display:fdur(ms)};tot+=ms;}
    const yd={};
    for(const y of years){
      const ms=p.yearly[y]||0,tgt=getTgt(y),pct=tgt>0?(ms/MS/HPD)/tgt:0;
      yd[y]={ms,display:fdur(ms),pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
    }
    const tTgt=years.reduce((s,y)=>s+getTgt(y),0),pct=tTgt>0?(tot/MS/HPD)/tTgt:0;
    return{name:p.name,dept:p.dept,email:p.email,monthly:md,yearly:yd,total:fdur(tot),totalMs:tot,pct:Math.round(pct*100),status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
  }).sort((a,b)=>a.dept.localeCompare(b.dept)||a.name.localeCompare(b.name));

  // ── ProjectSummary ──
  const projMap={};
  for(const e of all){
    const d=new Date(Number(e.start)),yr=d.getFullYear(),ms=Number(e.duration)||0;
    const name=e.user?.username||e.user?.email||"Unknown";
    const dept=(name.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";
    const proj=e.task_location?.list_name||"(ไม่ระบุ)";
    const space=e.task_location?.space_name||"";
    const wtype=e.task_location?.folder_name||"Project";
    const key=`${proj}||${dept}||${wtype}`;
    if(!projMap[key])projMap[key]={project:proj,dept,workType:wtype,space,ms:{},total:0};
    projMap[key].ms[yr]=(projMap[key].ms[yr]||0)+ms;
    projMap[key].total+=ms;
  }
  const projects=Object.values(projMap).map(p=>({
    project:p.project,dept:p.dept,workType:p.workType,space:p.space,
    yearly:Object.fromEntries(years.map(y=>[y,{ms:p.ms[y]||0,display:fhrs(p.ms[y]||0)}])),
    total:fhrs(p.total),totalMs:p.total
  })).sort((a,b)=>b.totalMs-a.totalMs);

  // ── Summaries ──
  const deptSummary={},summary={ok:0,warn:0,bad:0,total:0};
  for(const p of persons){
    if(!deptSummary[p.dept])deptSummary[p.dept]={ok:0,warn:0,bad:0,total:0};
    deptSummary[p.dept].total++;deptSummary[p.dept][p.status]++;
    summary.total++;summary[p.status]++;
  }

  res.json({persons,projects,months,years,deptSummary,summary,startYear,endYear,updatedAt:new Date().toISOString()});
}
