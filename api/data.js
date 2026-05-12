// api/data.js — Vercel Serverless Function (Multi-Year + All Members)
const WORKING_DAYS = {
  "Jan":20,"Feb":20,"Mar":21,"Apr":19,"May":21,
  "Jun":21,"Jul":23,"Aug":21,"Sep":22,"Oct":22,"Nov":21,"Dec":23
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
  const token=process.env.CLICKUP_API_TOKEN;
  const teamId=process.env.CLICKUP_TEAM_ID;
  const startYear=parseInt(process.env.START_YEAR||"2025");
  const endYear=new Date().getFullYear();

  if(!token||!teamId) return res.status(500).json({error:"กรุณาตั้งค่า CLICKUP_API_TOKEN และ CLICKUP_TEAM_ID ใน Vercel ก่อนค่ะ"});

  // ── ดึงรายชื่อสมาชิกทั้งหมดใน Team ──
  let memberIds = [];
  try {
    const memberRes = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/member`,
      {headers:{Authorization:token}});
    if(memberRes.ok){
      const memberData = await memberRes.json();
      memberIds = (memberData.members||[]).map(m => m.user?.id).filter(Boolean);
    }
  } catch(e){ console.error("Error fetching members:", e.message); }

  // ── ดึงข้อมูลทุกปีตั้งแต่ startYear ──
  let allEntries=[];
  for(let year=startYear; year<=endYear; year++){
    const startMs=new Date(`${year}-01-01`).getTime();
    const endMs=new Date(`${year}-12-31T23:59:59`).getTime();
    let page=0;

    // ถ้ามี memberIds ให้ระบุ assignee เพื่อดึงข้อมูลทุกคน
    const assigneeParam = memberIds.length > 0
      ? `&assignee=${memberIds.join(",")}` : "";

    try {
      while(true){
        const url = `https://api.clickup.com/api/v2/team/${teamId}/time_entries`
          + `?start_date=${startMs}&end_date=${endMs}${assigneeParam}&page=${page}`;
        const r=await fetch(url,{headers:{Authorization:token}});
        if(!r.ok){
          const e=await r.json().catch(()=>({}));
          return res.status(r.status).json({error:`ClickUp Error: ${e.err||r.status}`});
        }
        const {data=[]}=await r.json();
        allEntries=allEntries.concat(data);
        if(data.length<100) break;
        if(++page>100) break;
      }
    } catch(e){ return res.status(500).json({error:e.message}); }
  }

  // ── ประมวลผลรายบุคคล ──
  const personMap={};
  for(const entry of allEntries){
    const d=new Date(Number(entry.start));
    const monthYear=formatMonthYear(d);
    const year=d.getFullYear();
    const ms=Number(entry.duration)||0;
    const rawName=entry.user?.username||entry.user?.email||"Unknown";
    const dept=(rawName.match(/\b([A-Z][A-Z0-9-]+)$/)||[])[1]||"Other";

    if(!personMap[rawName]) personMap[rawName]={
      name:rawName, dept, avatar:entry.user?.profilePicture||null,
      email:entry.user?.email||"", monthly:{}, yearly:{}
    };
    personMap[rawName].monthly[monthYear]=(personMap[rawName].monthly[monthYear]||0)+ms;
    personMap[rawName].yearly[year]=(personMap[rawName].yearly[year]||0)+ms;
  }

  // ── สร้าง months list ──
  const now=new Date();
  const months=[];
  for(let y=startYear; y<=endYear; y++){
    const maxMonth = y===endYear ? now.getMonth() : 11;
    for(let m=0; m<=maxMonth; m++) months.push(`${MONTH_NAMES[m]} ${y}`);
  }

  function getTargetDays(year){
    const maxMonth = year===endYear ? now.getMonth() : 11;
    let total=0;
    for(let m=0; m<=maxMonth; m++) total+=WORKING_DAYS[MONTH_NAMES[m]]||0;
    return total;
  }

  const years=[];
  for(let y=startYear; y<=endYear; y++) years.push(y);

  const persons=Object.values(personMap).map(p=>{
    const monthlyData={}, yearlyData={};
    let totalMs=0;
    for(const m of months){
      const ms=p.monthly[m]||0;
      monthlyData[m]={ms,display:formatDuration(ms)};
      totalMs+=ms;
    }
    for(const y of years){
      const ms=p.yearly[y]||0;
      const target=getTargetDays(y);
      const pct=target>0?(ms/MS_PER_HOUR/HOURS_PER_DAY)/target:0;
      yearlyData[y]={ms,display:formatDuration(ms),pct:Math.round(pct*100),
        status:pct>=0.6?"ok":pct>=0.3?"warn":"bad"};
    }
    const totalTarget=years.reduce((s,y)=>s+getTargetDays(y),0);
    const pct=totalTarget>0?(totalMs/MS_PER_HOUR/HOURS_PER_DAY)/totalTarget:0;
    const status=pct>=0.6?"ok":pct>=0.3?"warn":"bad";
    return{name:p.name,dept:p.dept,avatar:p.avatar,email:p.email,
      monthly:monthlyData,yearly:yearlyData,
      total:formatDuration(totalMs),totalMs,pct:Math.round(pct*100),status};
  }).sort((a,b)=>a.dept.localeCompare(b.dept)||a.name.localeCompare(b.name));

  const deptSummary={}, summary={ok:0,warn:0,bad:0,total:0};
  for(const p of persons){
    if(!deptSummary[p.dept]) deptSummary[p.dept]={ok:0,warn:0,bad:0,total:0};
    deptSummary[p.dept].total++; deptSummary[p.dept][p.status]++;
    summary.total++; summary[p.status]++;
  }

  res.json({persons,months,years,deptSummary,summary,
    startYear,endYear,totalMembers:memberIds.length,
    updatedAt:new Date().toISOString()});
}
