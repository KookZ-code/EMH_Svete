# Plan: WB-Report Job Request / Close chart (แยก M/C DOWN และ SETUP+CONV)

Status: **proposal, ยังไม่แก้ code**
Frontend target: `src/lib/components/JobTrend.svelte` (ใหม่) วางใน `src/routes/wb-report/+page.svelte` ต่อจาก `<SevenDayTrend>`
Backend target: `D:\claude\Dashboad_API_rush\src\repositories\wb_repo.rs` (repo แยกจาก frontend)

## 1. Findings

- `total_closed_jobs` (per shift) = จำนวน job ที่ปิดแล้วของ M/C DOWN + SETUP/CONV รวมกัน
  ดังนั้น **Close แยกได้ทันที** ด้วย `down_jobs` และ `setup_jobs` ที่ API ส่งมาอยู่แล้ว
- `total_request_jobs` = closed + open (`wb_repo.rs` ~บรรทัด 732) แต่ open job เก็บรวมใน `open_job_ids`
  ต้องแก้ backend เพื่อแยก request ตามประเภท
- `SevenDayTrend.svelte` รับ `shift_details` ที่มี `down_jobs`, `setup_jobs`, `total_request_jobs`, `total_closed_jobs` อยู่แล้ว
  จึงไม่ต้องเรียก API ใหม่ — เพิ่มแค่ 2 field

## 2. Decisions (จากการตอบ)

1. Request ต้อง **แยกตามประเภท** (M/C DOWN / SETUP+CONV) → แก้ backend
2. รูปแบบ = **stacked column คู่** ต่อกะ: แท่งซ้าย Request, แท่งขวา Close, แต่ละแท่ง stack เป็น M/C DOWN + SETUP+CONV
3. **รวม Backlog และ Close Rate % ในรอบนี้**
   - Backlog (ต่อกะ) = request − close = job ที่ยังไม่ปิดในกะนั้น ตรงกับ open job ของ backend จึงคำนวณจาก field เดิมได้ ไม่ต้องเพิ่ม field
   - Close Rate % (ต่อกะ) = close / request × 100
4. Backend ไม่ต้องเพิ่มอะไรสำหรับสองตัวนี้ เพราะคำนวณจาก `total_request_jobs` และ `total_closed_jobs` ฝั่ง frontend ได้เลย

## 3. Changes

### A. Backend (`wb_repo.rs`)
1. ใน loop เก็บ open job (~บรรทัด 380–391 และ 698–708) เพิ่ม set `open_down_job_ids` และ `open_setup_job_ids`
   โดยแยกตาม `jt == "M/C DOWN"` กับ `SETUP_CONV` (ตอนนี้ `open_job_ids` รวมกันอยู่)
2. คง `open_job_ids` เดิมไว้เพื่อให้ `total_open_jobs`, `closed_pct`, `open_pct` ไม่เปลี่ยน
3. ใน per-shift metrics (~บรรทัด 770–790) เพิ่ม
   - `request_down_jobs` = `total_closed_down + open_down`
   - `request_setup_jobs` = `total_closed_setup + open_setup`
   - และ fallback เป็น 0 ในบล็อกว่าง (~บรรทัด 788)
4. `total_request_jobs` = `request_down_jobs + request_setup_jobs` (ตรวจว่าตรงกับค่าเดิม)
5. ใน `shift_details` (~บรรทัด 163–170) เพิ่ม `request_down_jobs`, `request_setup_jobs`

### B. Frontend
1. `SevenDayTrend.svelte` `ShiftDetail` เพิ่ม 2 field (ถ้าต้องใช้ type ร่วม ให้แยกเป็น `$lib/types`)
2. `JobTrend.svelte` (ใหม่)
   - Layout เดียวกับ trend เดิม: **Series Control** ซ้าย (toggle M/C DOWN, SETUP+CONV) + chart ขวา
   - X = `DD N/D` เหมือน trend เดิม
   - Chart: ECharts `bar` แบบ stack สองชุด
     - Request: stack ของ DOWN + SETUP (ใช้ `stack: 'request'`)
     - Close: stack ของ DOWN + SETUP (ใช้ `stack: 'close'`)
     - ระหว่างแท่งซ้าย-ขวาคั่นด้วย `barGap` เล็กน้อย; แยกกลุ่มกะด้วย `barCategoryGap`
   - สีต้องต่างจาก trend เดิม: M/C DOWN ใช้ `#cc0000` ซ้ำได้เพราะเป็นความหมายเดียวกัน; SETUP+CONV ใช้ `#1d9ce4` ซ้ำได้ด้วย
     แต่ **Request กับ Close ต้องแยกด้วย pattern หรือความเข้มสี** (เช่น Request = สีเต็ม, Close = สีจาง/มี border) เพื่อไม่ให้สับสน
     - ทางเลือก: ให้ Close ใช้ `opacity 0.55` หรือ pattern ลาย
   - เพิ่มเส้น **Backlog** (แกนซ้าย หน่วยงาน) และเส้น **Close Rate %** (แกนขวา หน่วย %) ค่าเริ่มต้นเปิดทั้งคู่ ปิดได้ผ่าน Series Control
   - Tooltip: แสดง Request DOWN / SETUP / รวม, Close DOWN / SETUP / รวม, Backlog และ Close Rate % ของกะนั้น
   - เพิ่มมุมบนขวา hint "HOVER FOR VALUES" และ axis note "Y AXIS — จำนวนงาน · X AXIS — วัน + กะ"
3. KPI strip ด้านบน 4 ช่อง: Total Request, Total Close, Avg Close Rate %, Backlog กะล่าสุด
   (ยังไม่ได้ยืนยันว่าต้องการ KPI แบบนี้ ใช้เป็นค่าเริ่มต้นก่อน ปรับได้)
4. ใช้ `EChart.svelte` เดิม และ token ของ `app.css` (ตามกฎ CLAUDE.md ไม่ hardcode สี/px มากกว่าที่จำเป็น)

## 4. Verification
1. Backend: `cargo test` (ถ้ามี) และ เทียบกับค่าเดิม — `request_down_jobs + request_setup_jobs == total_request_jobs` และ `down_jobs + setup_jobs == total_closed_jobs` ทุกกะ
2. Frontend: `npm run check` ไม่มี error ใหม่ และตรวจว่า Backlog = request − close และ Close Rate = close / request × 100 ทุกกะ
3. Playwright MCP: เปิด `/wb-report` ตรวจ (a) chart แสดงครบ 14 กะ (b) toggle ซ่อน/แสดงแต่ละประเภทและ stack ปรับถูก (c) tooltip ตรงกับ table (d) KPI ตรงกับผลรวม
4. ตรวจ mobile ~390px ไม่มี horizontal scroll

## 5. Open items
- ตรวจว่า key ของ DOWN และ SETUP ใช้ `format!("{:?}", datex)` ซึ่งอาจชนกันได้ถ้าสองประเภทมี datex เดียวกัน (ก่อนแก้ควรดูข้อมูลจริงว่ามีกรณีนี้หรือไม่)
- Backlog ใช้นิยาม "request − close ของกะนั้น" (ไม่ใช่ backlog สะสมข้ามกะ) ถ้าต้องการแบบสะสมต้องคำนวณเพิ่ม
- ยืนยันว่า Request ของ SETUP+CONV ควรรวม CLEAN MOLD และ CHANGE CAP ตาม `SETUP_CONV` เดิม (ไม่แยกเป็นประเภทย่อย)
