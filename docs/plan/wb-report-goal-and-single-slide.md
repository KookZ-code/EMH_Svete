# Plan: WB Report — Goal (Wait / Setup) และสไลด์ PPTX หน้าเดียว

Status: **แผน รอยืนยันก่อนเริ่มโค้ด**
Mockup ที่เลือก: [wb-report-pptx-goal-mockup.html](wb-report-pptx-goal-mockup.html) **แบบ 1**
ต่อยอดจาก: [wb-report-pptx-export.md](wb-report-pptx-export.md)

## 1. สิ่งที่ตัดสินใจแล้ว

| เรื่อง | ข้อสรุป |
|---|---|
| ตัวชี้วัด goal | Wait เฉลี่ย (M/C DOWN และ Setup) ≤ 60 นาที, Setup เฉลี่ย (MTTR Setup+Conv) ≤ 45 นาที |
| ทิศทาง | ค่ายิ่งต่ำยิ่งดี เขียวเมื่อ ≤ goal แดงเมื่อเกิน |
| ที่เก็บ goal | ไฟล์ config ในโปรเจกต์ (ยังไม่ทำหน้า admin) |
| PowerPoint | **หน้าเดียว** ไม่มีหน้า 2 |
| การ์ดเหนือกราฟ Trend | 3 ค่าเดิม: Wait M/C Down, Wait Setup, Setup MTTR (แบบ 1) |
| การ์ดเหนือกราฟ Job | Request, Close, Close Rate, **Remain** (ของกะล่าสุด) |
| Event Pattern | M/C DOWN และ SETUP+CONV พร้อมแถว in state (ไม่เปลี่ยนชื่อแถว) |

## 2. ค่าที่ใช้เทียบ goal (ไม่คำนวณใหม่)

| Goal | ค่าจริง | ที่มาในหน้า |
|---|---|---|
| Wait ≤ 60m (M/C Down) | `lossStats.wait.mttwDown` | `+page.svelte` |
| Wait ≤ 60m (Setup) | `lossStats.wait.mttwSetup` | `+page.svelte` |
| Setup ≤ 45m | `lossStats.setup.mttr` | `+page.svelte` |

ส่วนต่างจาก goal = ค่าจริง − goal (นาที) บวก = เกิน = แดง

## 3. การเปลี่ยนแปลง

### A. ไฟล์ goal ใหม่: `src/lib/config/wb_goals.ts`
- export ค่า goal เป็นนาที: `waitMin: 60`, `setupMin: 45`
- export ฟังก์ชัน `goalDelta(actual, goal)` คืน `{ delta, ok }` เพื่อให้หน้าเว็บและ PPTX ใช้เกณฑ์เดียวกัน
- ตามกฎ "No Hardcoding": ค่าอยู่ที่เดียว ไม่ฝังในหน้าและไม่ฝังใน exportPptx
- ไม่ใช้ `.env` เพราะ goal เป็นเกณฑ์ธุรกิจ ไม่ใช่ค่าที่ต่างตาม environment (ถ้าต้องการต่าง environment บอกได้)

### B. หน้า report (`src/routes/wb-report/+page.svelte`)
1. การ์ด **Wait**: ข้างค่า `Down MTTW` และ `Setup MTTW` เพิ่มป้ายจุดสี + ส่วนต่าง เช่น `● +88m` และแสดง `goal ≤ 60m` ที่มุมการ์ด
2. การ์ด **Setup+Conv**: ข้างค่า `MTTR` เพิ่มป้ายแบบเดียวกัน และ `goal ≤ 45m`
3. ใช้คลาสสี/ขนาดจาก `app.css` ตามกฎ Design System ถ้าสีเขียว/แดงของป้ายยังไม่มีเป็น token ให้ถามก่อน (ค่า `#2E7D32` / `#C62828` ในหน้าปัจจุบันมีอยู่แล้วในส่วน delta)
4. การ์ดอื่นไม่เปลี่ยน

### C. สไลด์ PPTX หน้าเดียว (`src/lib/utils/exportPptx.ts`)
1. **ลดขนาดการ์ด** ให้กราฟสูงขึ้น: การ์ด KPI แถวบน 0.72 → 0.52 นิ้ว, Shift Loss 1.25 → 1.10 นิ้ว, การ์ดเหนือกราฟ 0.62 นิ้ว (กราฟสูงประมาณ 2.0 นิ้ว จากเดิม 1.37)
2. **การ์ด Wait / Setup+Conv** ในแถว Shift Loss มีป้าย goal ตามข้อ B
3. **การ์ด 3 ใบเหนือกราฟ Trend** (ใหม่): Wait·M/C Down, Wait·Setup, Setup+Conv·MTTR พร้อม `goal` และส่วนต่าง
4. **การ์ดเหนือกราฟ Job**: เปลี่ยนป้าย "Backlog" เป็น "Remain" (ทำไปแล้ว) ค่าของกะล่าสุด
5. ใช้ `drawKpiCard` เดิมซ้ำ เพิ่มพารามิเตอร์ย่อยสำหรับการ์ดบางและบรรทัด goal ไม่เขียนฟังก์ชันวาดการ์ดใหม่
6. หน้าที่ส่งข้อมูลเข้า `PptxReportData` เพิ่ม field `goals` (ค่าจริงทั้ง 3 ตัว + goal) แทนที่จะให้ exportPptx อ่าน config เอง เพื่อให้ฟังก์ชันยังรับข้อมูลเป็น argument ล้วน

## 4. ข้อควรระวัง

- **ค่า 0 หรือไม่มี event:** ถ้า `mttwDown`/`mttr` เป็น 0 (ไม่มี event) ต้องไม่ขึ้นป้ายเขียว "−60m" เพราะเข้าใจผิดว่าผ่านดี ให้แสดงเป็น "—" และไม่มีป้าย
- **Wait ของ Setup ใช้ event ชนิดอะไร:** `mttwSetup` คิดจากจำนวน event Setup+Conv+Clean Mold+Change Cap ตามที่หน้าคำนวณอยู่ ต้องยืนยันว่านี่คือสิ่งที่ goal ตั้งใจให้ครอบคลุม
- **ขนาดตัวอักษรบนสไลด์:** ลดการ์ดแล้วตัวเล็กลง (ตัวเลข KPI 17pt, การ์ดเหนือกราฟ 15pt) ควรเปิดใน PowerPoint ดูก่อนฉายจริง
- **Remain ในหน้า JobTrend:** เปลี่ยนชื่อแล้ว ตรวจให้แน่ใจว่าไม่มี test หรือ doc อื่นที่อ้างชื่อ Backlog

## 5. ที่ไม่ทำในรอบนี้
- หน้า admin สำหรับตั้ง goal และ goal แยกตาม package หรือกะ (โครงสร้าง `wb_goals.ts` ย้ายไปเป็นฟังก์ชันรับ package/shift ได้ภายหลังโดยไม่ต้องรื้อ)
- เส้น goal บนกราฟ trend 7 วัน (ข้อมูล 7 วันยังรวม wait ของ Down และ Setup ไว้ด้วยกัน ต้องให้ backend แยกก่อน)
- แถบ Goal vs Actual บนหน้า report (เสนอไว้ใน mockup แรก ยังไม่ได้เลือก)

## 6. ขั้นตอนและการตรวจสอบ

1. สร้าง `wb_goals.ts` → ตรวจ: `npm run check` ไม่มี error ใหม่
2. เพิ่มป้าย goal ในการ์ด Wait และ Setup+Conv ของหน้า → ตรวจ: เปิดหน้าด้วย Playwright (ต้อง login) เห็นป้ายถูกสีและส่วนต่างตรงกับค่าที่คำนวณ
3. ปรับ `exportPptx.ts` ตามข้อ C → ตรวจ: สร้างไฟล์ด้วยข้อมูลตัวอย่าง, ไม่มี shape หลุดขอบ, การ์ดไม่ทับกราฟ, ตารางจบก่อน footer
4. ทดสอบกรณีขอบ: ไม่มี event (ค่า 0), ค่าเท่ากับ goal พอดี, ค่าเกิน goal หลายเท่า
5. `vite build` ผ่าน
6. เปิดไฟล์ PPTX จริงใน PowerPoint ตรวจตำแหน่ง (ทำได้เฉพาะผู้ใช้)

## 7. คำถามที่ยังเปิดอยู่
1. ค่า `mttwSetup` ตรงกับความหมายของ "Wait ของ Setup ไม่เกิน 60 นาที" ที่ต้องการหรือไม่
2. ป้ายเขียวเมื่อผ่าน goal ต้องการข้อความแบบไหน (เช่น `● −10m` หรือ `● ผ่าน`)
