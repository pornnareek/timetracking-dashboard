# ⏱️ Time Tracking Dashboard 2026

Dashboard แสดงข้อมูล Time Tracking จาก ClickUp
เปิดได้จากทุกที่ผ่าน Vercel (ฟรี 100%)

---

## 📋 วิธี Setup (ทำครั้งเดียว ~20 นาที)

### STEP 1 — สมัคร GitHub (ถ้ายังไม่มี)
1. ไปที่ https://github.com → Sign up
2. สร้าง Repository ใหม่ ชื่อ `timetracking-dashboard`
3. Upload ไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้น GitHub

### STEP 2 — สมัคร Vercel (ถ้ายังไม่มี)
1. ไปที่ https://vercel.com → Sign up with GitHub
2. กด **Add New Project** → เลือก Repository `timetracking-dashboard`
3. กด **Deploy** (ยังไม่ต้องใส่อะไร)

### STEP 3 — ใส่ API Token (สำคัญมาก!)
1. ใน Vercel → เปิด Project → **Settings → Environment Variables**
2. เพิ่มค่าต่อไปนี้:

| Name | Value |
|------|-------|
| `CLICKUP_API_TOKEN` | Token ของคุณ (จาก ClickUp Settings → Apps) |
| `CLICKUP_TEAM_ID` | Team ID ของคุณ |
| `START_DATE` | `2026-01-01` |
| `END_DATE` | `2026-12-31` |

3. กด **Save** แล้ว **Redeploy**

### STEP 4 — ส่ง Link ให้ทีม
Vercel จะให้ URL เช่น `https://timetracking-dashboard.vercel.app`
ส่ง URL นี้ให้ทีม → เปิดได้เลย ไม่ต้อง Login!

---

## 🔄 อัปเดตข้อมูล
กดปุ่ม **รีเฟรช** บนหน้า Dashboard ได้เลยค่ะ
ข้อมูลจะดึงจาก ClickUp ใหม่ทันที

---

## 🔑 หา API Token และ Team ID
- **API Token**: ClickUp → Settings → Apps → API Token
- **Team ID**: เปิด ClickUp ดูตัวเลขใน URL เช่น `app.clickup.com/3845209/`
