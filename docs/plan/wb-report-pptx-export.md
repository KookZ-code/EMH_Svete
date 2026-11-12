# Plan: WB Report — ปุ่ม "↓ PPTX" (สไลด์ 1 หน้า สำหรับฉายในประชุม)

Status: **กำลังดำเนินการ**
Mockup ที่อนุมัติแล้ว: [wb-report-pptx-mockup.html](wb-report-pptx-mockup.html) (v2)
Target: `src/lib/utils/exportPptx.ts` (ใหม่), `src/routes/wb-report/+page.svelte` (เพิ่มปุ่ม)

## 1. ข้อกำหนด

- ไฟล์ `wb_report_{date}_{shift}.pptx` สไลด์ 16:9 หน้าเดียว สำหรับฉายในห้องประชุม
- ใช้ข้อมูลที่โหลดอยู่ในหน้าแล้ว ไม่เรียก API เพิ่ม (ยกเว้น 7-day trend ที่คอมโพเนนต์ดึงอยู่แล้ว)
- สร้างในเบราว์เซอร์ทั้งหมด ไม่ต้องมี backend ใหม่

## 2. เลย์เอาต์ (ตาม mockup v2)

| แถว | บล็อก | แหล่งข้อมูล |
|---|---|---|
| หัว | ชื่อรายงาน, กะ, วันที่, ช่วงเวลา, package, จำนวนเครื่อง | `kpi`, `timeRange`, `pkgLabel` |
| 1 | KPI 5 ใบ: Machines, Avg Util, M/C Down, Util<85%, Techs + Δ vs 7d | `kpi`, `kpi7d`, `kd` |
| 2 | Shift Loss % 5 ใบ: Down, Wait, Setup+Conv, SBO, Idle | `kpi`, `lossStats` |
| 3 ซ้าย | Trend Utilization/Loss (%) + Technicians | `SevenDayTrend` data |
| 3 ขวา | Job Request / Close (แท่งคู่ + Close Rate %) | `JobTrend` data |
| 4 ซ้าย | Event Pattern — Hourly: M/C DOWN, SETUP+CONV, Non-running | `heatmap` |
| 4 ขวา | Narrative Insight | `narrative` |

**ไม่รวม:** Top Problems (ตามที่ผู้ใช้ขอ), ตารางเครื่องทั้งหมด, SBO และ Idle ใน heatmap (ตามที่ผู้ใช้ขอ)

## 3. การออกแบบทางเทคนิค

- **Library:** `pptxgenjs@^4.0.1` (มีแล้วใน `package.json`) โหลดแบบ dynamic `import('pptxgenjs')` ตอนกดปุ่ม เพื่อไม่เพิ่ม bundle ตอนเปิดหน้า
- **กราฟ:** ใช้ native chart ของ PPTX (`addChart`) ไม่ใช่ภาพ เพื่อให้ผู้ใช้แก้ไขต่อใน PowerPoint ได้
  - Trend: combo ของ line (แกนซ้าย %) + bar (แกนขวา technicians ผ่าน `secondaryValAxis`)
  - Job Request/Close: bar stacked สองกลุ่ม + line Close Rate % บนแกนรอง
- **ตาราง heatmap:** ใช้ `addTable` พร้อมสีพื้นตามความเข้มเดียวกับหน้าเว็บ
- **สี/ฟอนต์:** ดึงค่าจากชุดเดียวกับหน้าเว็บ (`JOB_COLOR`, series colors) และ DESIGN.md (Open Sans, #1C355E)
- **ข้อมูล trend:** ต้องส่งค่าจากคอมโพเนนต์ `SevenDayTrend` และ `JobTrend` ขึ้นไปยังหน้า เพราะตอนนี้ข้อมูลอยู่ภายในคอมโพเนนต์ (ดูข้อ 5)

## 4. ขั้นตอนและการตรวจสอบ

1. ติดตั้ง `pptxgenjs` → ตรวจ: `node_modules/pptxgenjs` เวอร์ชัน 4.0.1 ✔
2. เขียน `exportPptx.ts` ที่รับข้อมูลเป็น argument (ไม่อ้างถึง Svelte state โดยตรง) → ตรวจ: `npm run check` ไม่มี error ใหม่
3. เพิ่มปุ่มในหน้า และแก้คอมโพเนนต์ trend ให้ส่งข้อมูลขึ้นมา → ตรวจ: กราฟบนหน้าเว็บยังทำงานเหมือนเดิม
4. ทดสอบจริง: กดปุ่มแล้วเปิดไฟล์ด้วย python-pptx (ตรวจจำนวน slide = 1, ชนิด chart, ข้อความ) และ render เป็นภาพ (ถ้ามี LibreOffice)
5. ทดสอบจริงบน Playwright: กดปุ่มบนหน้า `/wb-report` แล้วตรวจว่าดาวน์โหลดไฟล์ได้

## 5. การเปลี่ยนแปลงกับโค้ดเดิม

- `SevenDayTrend.svelte` และ `JobTrend.svelte` ตอนนี้เก็บข้อมูลไว้ภายใน ต้องเพิ่ม prop ส่งออก (เช่น `onData` callback) หรือย้ายการ fetch ขึ้นมาที่หน้า
  - ทางเลือกที่เลือก: ให้หน้าเรียก `/api/v1/wb/report-7day` เองแค่ครั้งเดียวและส่งลงไปทั้งสองคอมโพเนนต์ เพื่อไม่เรียกซ้ำ
  - **ยังไม่ยืนยัน** ว่าเปลี่ยนแบบนี้โอเคหรือไม่ (ถ้าไม่โอเค จะส่งเป็น callback แทน)

## 6. ความเสี่ยง

- Native chart ของ pptxgenjs มีข้อจำกัดเรื่อง combo กับแกนรองบางกรณี ต้องทดสอบเปิดใน PowerPoint จริง
- จำนวนเครื่องตาม heatmap ยึดจาก `machines` ของหน้า ต้องตรงกับที่ KPI แสดง
