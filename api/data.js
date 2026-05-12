// api/data.js — Vercel Serverless Function
const WORKING_DAYS = {
  "Jan 2026":20,"Feb 2026":20,"Mar 2026":21,"Apr 2026":19,
  "May 2026":5, "Jun 2026":21,"Jul 2026":23,"Aug 2026":21,
  "Sep 2026":22,"Oct 2026":22,"Nov 2026":21,"Dec 2026":23
};
const MS_PER_HOUR=3600000, HOURS_PER_DAY=8;
const MONTH_NAMES=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatMonthYear(d){ return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`; }
function formatDuration(ms){
  if(!ms) return "0 d 00 h 00 m";
  const h=ms/MS_PER_HOUR, d=Math.floor(h/HOURS_PER_DAY);
  const rh=Math.floor(h%HOURS_PER_DAY), rm=Math.floor((h%1)*60);
  return `${d} d ${String(rh).padStart(2,"0")} h ${String(rm).padStart(2,"0")} m`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  const token=process.env.CLICKUP_API_TOKEN, teamId=process.env.CLICKUP_TEAM_ID;
  const year=process.env.REPORT_YEAR||"2026";

  if(!token||!teamId) return res.status(500).json({error:"กรุณาตั้งค่า CLICKUP_API_TOKEN และ CLICKUP_TEAM_ID ใน Vercel Environment Variables ก่อนค่ะ"});

  const startMs=new Date(`${year}-01-01`).getTime();
  const endMs=new Date(`${year}-12-31T23:59:59`).getTime();

  let allEntries=[], page=0;
  try {
    while(true){
      const r=await fetch(`https://api.clickup.com/api/v2/team/${teamId}/time_entries?start_date=${startMs}&end_date=${endMs}&page=${page}`,
        {headers:{Authorization:token}});
      if(!r.ok){ const e=await r.json().catch(()=>({})); return res.status(r.status).json({error:`ClickUp Error: ${e.err||r.status}`}); }
      const {data=[]}=await r.json();
      allEntries=allEntries.concat(data);
      if(data.length<100) break;
      if(++page>100) break;
    }
  } catch(e){ return res.status(500).json({error:e.message}); }

  // ── ประมวลผล ──
  const personMap={};
  for(const entry of allEntries){
    const monthYear=formatMonthYear(new Date(Number(entry.start)));
    const ms=Number(entry.duration)||0;
    const rawName=entry.user?.username||entry.user?.email||"Unknown";
    const dept=(rawName.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";
    const key=rawName;
    if(!personMap[key]) personMap[key]={name:rawName,dept,avatar:entry.user?.profilePicture||null,email:entry.user?.email||"",monthly:{}};
    personMap[key].monthly[monthYear]=(personMap[key].monthly[monthYear]||0)+ms;
  }

  const months=Object.keys(WORKING_DAYS).filter(m=>new Date(`01 ${m}`)<=new Date());
  const targetDays=months.reduce((s,m)=>s+(WORKING_DAYS[m]||0),0);

  const persons=Object.values(personMap).map(p=>{
    const monthlyData={};
    let totalMs=0;
    for(const m of months){ const ms=p.monthly[m]||0; monthlyData[m]={ms,display:formatDuration(ms)}; totalMs+=ms; }
    const pct=targetDays>0?(totalMs/MS_PER_HOUR/HOURS_PER_DAY)/targetDays:0;
    const status=pct>=0.6?"ok":pct>=0.3?"warn":"bad";
    return{...p,monthly:monthlyData,total:formatDuration(totalMs),totalMs,pct:Math.round(pct*100),status};
  }).sort((a,b)=>a.dept.localeCompare(b.dept)||a.name.localeCompare(b.name));

  const deptSummary={};
  const summary={ok:0,warn:0,bad:0,total:0};
  for(const p of persons){
    if(!deptSummary[p.dept]) deptSummary[p.dept]={ok:0,warn:0,bad:0,total:0};
    deptSummary[p.dept].total++; deptSummary[p.dept][p.status]++;
    summary.total++; summary[p.status]++;
  }

  res.json({persons,months,deptSummary,summary,targetDays,year,updatedAt:new Date().toISOString()});
}
