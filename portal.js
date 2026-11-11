/* DT Prosthetic Care secure portal — requires approved, configured Supabase project.
 * NO service_role keys. Authorization is enforced in Postgres RLS, never by this UI.
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  const statuses={pending:'รอตรวจสอบ',review:'กำลังประเมิน','needs-info':'ต้องเตรียมข้อมูลเพิ่ม',scheduled:'ยืนยันวันนัด',completed:'รับบริการแล้ว',cancelled:'ยกเลิก'};
  const questions=[
    ['wound','บริเวณตอขามีแผลเปิดหรือไม่?', [['no','ไม่มี'],['yes','มี'],['unsure','ไม่แน่ใจ']]],
    ['swelling','ตอขามีอาการบวมหรือไม่?', [['no','ไม่มี'],['yes','มี'],['unsure','ไม่แน่ใจ']]],
    ['pain','มีอาการเจ็บตอขาหรือไม่?', [['no','ไม่มี'],['yes','มี'],['unsure','ไม่แน่ใจ']]],
    ['movement','สามารถเหยียดข้อใกล้ตอขาได้หรือไม่?', [['yes','ได้'],['no','ไม่ได้'],['unsure','ไม่แน่ใจ']]],
    ['mobility','สามารถเคลื่อนย้ายตัวด้วยตนเองได้หรือไม่?', [['yes','ได้'],['no','ไม่ได้'],['unsure','ไม่แน่ใจ']]],
    ['symptoms','มีอาการผิดปกติอื่นที่ต้องการแจ้งหรือไม่?', [['no','ไม่มี'],['yes','มี'],['unsure','ไม่แน่ใจ']]]
  ];
  const cfg=window.DT_PORTAL_CONFIG;
  const configured=!!(cfg&&cfg.productionApproved&&/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url||'')&&cfg.publishableKey&&!cfg.publishableKey.includes('YOUR-'));
  if(!configured){$('configState').textContent='ระบบนี้ยังไม่เปิดรับข้อมูลจริง: ต้องได้รับอนุมัติจากโรงพยาบาล ติดตั้งฐานข้อมูล ตรวจสอบนโยบายสิทธิ์ และตั้งค่า portal-config.js ก่อน';return;}
  if(!window.supabase?.createClient){$('configState').textContent='ไม่สามารถโหลดชุดเชื่อมต่อฐานข้อมูล กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต';return;}
  const db=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  let user=null,staff=false,loading=false;
  const setMessage=(message,type='success')=>{$('message').textContent=message;$('message').className=type};
  const setBusy=value=>{loading=value;for(const id of ['signInBtn','submitRequestBtn'])if($(id))$(id).disabled=value};
  const formatDate=value=>value?new Date(value).toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Bangkok'}):'รอกำหนดวันนัด';
  const statusTag=status=>`<span class="status">${escapeHtml(statuses[status]||status)}</span>`;
  const selectOptions=(items)=>items.map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');
  const yearNow=new Date().getFullYear()+543;
  for(let i=1;i<=31;i++)$('ampDay').insertAdjacentHTML('beforeend',`<option value="${i}">${i}</option>`);
  const months=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  months.forEach((m,i)=>$('ampMonth').insertAdjacentHTML('beforeend',`<option value="${i+1}">${m}</option>`));
  for(let y=yearNow;y>=yearNow-110;y--)$('ampYear').insertAdjacentHTML('beforeend',`<option value="${y}">${y}</option>`);
  $('assessmentFields').innerHTML=questions.map(([key,label,opts])=>`<label>${label}<select data-assessment="${key}" required><option value="">กรุณาเลือก</option>${selectOptions(opts)}</select></label>`).join('');
  const dateFromBE=()=>{
    const day=$('ampDay').value,month=$('ampMonth').value,year=$('ampYear').value;
    if(!day&&!month&&!year)return null;
    if(!day||!month||!year)throw Error('กรุณาระบุวัน เดือน ปี พ.ศ. ให้ครบ หรือเว้นว่างทั้งหมด');
    const gregorian=Number(year)-543;
    const result=`${gregorian}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    const date=new Date(`${result}T12:00:00`);
    if(date.getFullYear()!==gregorian||date.getMonth()+1!==Number(month)||date.getDate()!==Number(day)||date>new Date())throw Error('วันที่ตัดขาไม่ถูกต้อง');
    return result;
  };
  async function refresh(){
    if(!user)return;
    const {data:staffRow,error:roleError}=await db.from('staff_members').select('role,active').eq('user_id',user.id).maybeSingle();
    if(roleError)throw roleError;
    staff=!!staffRow?.active;
    $('authPanel').classList.add('hide');$('mainPanel').classList.remove('hide');$('patientView').classList.toggle('hide',staff);$('staffView').classList.toggle('hide',!staff);
    $('userBadge').textContent=`${staff?'เจ้าหน้าที่':'ผู้รับบริการ'} · ${user.email||user.id}`;
    await (staff?refreshStaff():refreshPatient());
  }
  async function refreshPatient(){
    const {data,error}=await db.from('prosthetic_requests').select('id,service,level,status,created_at,appointment_at,staff_note').eq('patient_user_id',user.id).order('created_at',{ascending:false}).limit(50);
    if(error)throw error;
    $('myRequests').innerHTML=data.length?data.map(r=>`<div class="row"><div><strong>คำขอ ${escapeHtml(r.id.slice(0,8))}</strong><div>${escapeHtml(r.level)} · ${formatDate(r.created_at)}</div>${statusTag(r.status)}<div class="date-card">${r.appointment_at?'วันนัด '+formatDate(r.appointment_at):'ยังไม่กำหนดวันนัด'}</div><div class="date-card">${escapeHtml(r.staff_note||'')}</div></div></div>`).join(''):'ยังไม่มีคำขอในบัญชีนี้';
  }
  async function refreshStaff(){
    const {data,error}=await db.from('prosthetic_requests').select('id,full_name,phone,service,level,side,status,appointment_at,created_at,assessment,staff_note').order('created_at',{ascending:false}).limit(100);
    if(error)throw error;
    const pending=data.filter(r=>['pending','review','needs-info'].includes(r.status)).length;
    $('metrics').innerHTML=`<div class="metric"><b>${data.length}</b>คำขอที่แสดง</div><div class="metric"><b>${pending}</b>รอตรวจสอบ</div><div class="metric"><b>${data.filter(r=>r.status==='scheduled').length}</b>นัดแล้ว</div>`;
    $('staffRequests').innerHTML=data.length?data.map(r=>`<article class="row"><div><strong>${escapeHtml(r.full_name)}</strong><div>${escapeHtml(r.level)} · ${escapeHtml(r.phone)} · ${formatDate(r.created_at)}</div>${statusTag(r.status)}<div class="date-card">${r.appointment_at?'นัด '+formatDate(r.appointment_at):'รอวันนัด'}</div><details><summary>ดูแบบประเมิน</summary><pre>${escapeHtml(JSON.stringify(r.assessment,null,2))}</pre></details></div><form class="schedule" data-request="${escapeHtml(r.id)}"><select aria-label="สถานะ" name="status">${Object.entries(statuses).map(([v,t])=>`<option value="${v}" ${v===r.status?'selected':''}>${t}</option>`).join('')}</select><input name="appointment" type="datetime-local" aria-label="วันและเวลานัด" value="${r.appointment_at?new Date(new Date(r.appointment_at).getTime()+7*3600000).toISOString().slice(0,16):''}"><input name="note" aria-label="หมายเหตุ" placeholder="หมายเหตุ" value="${escapeHtml(r.staff_note)}" maxlength="500"><button type="submit">บันทึก</button></form></article>`).join(''):'ยังไม่มีคำขอ';
    document.querySelectorAll('[data-request]').forEach(form=>form.addEventListener('submit',saveAppointment));
  }
  async function saveAppointment(event){
    event.preventDefault();if(loading)return;
    const form=event.currentTarget,id=form.dataset.request,status=form.elements.status.value,localDate=form.elements.appointment.value;
    if(status==='scheduled'&&!localDate){setMessage('ต้องเลือกวันนัดก่อนยืนยัน','error');return;}
    const appointment_at=localDate?new Date(localDate).toISOString():null;
    try{setBusy(true);const {error}=await db.from('prosthetic_requests').update({status,appointment_at,staff_note:form.elements.note.value,updated_at:new Date().toISOString()}).eq('id',id);if(error)throw error;setMessage('บันทึกข้อมูลนัดหมายเรียบร้อย');await refreshStaff();}catch(e){setMessage('บันทึกไม่ได้: '+e.message,'error');}finally{setBusy(false);}
  }
  $('requestForm').addEventListener('submit',async event=>{
    event.preventDefault();if(loading)return;
    try{
      const amputation_date=dateFromBE();const assessment=Object.fromEntries([...document.querySelectorAll('[data-assessment]')].map(s=>[s.dataset.assessment,s.value]));
      if(Object.values(assessment).some(v=>!v))throw Error('กรุณาตอบแบบประเมินให้ครบ');
      setBusy(true);
      const {error}=await db.from('prosthetic_requests').insert({patient_user_id:user.id,full_name:$('fullName').value.trim(),phone:$('phone').value.trim(),service:$('service').value,level:$('level').value,side:$('side').value,province:$('province').value.trim(),amputation_date,assessment});
      if(error)throw error;$('requestForm').reset();setMessage('ส่งคำขอเรียบร้อย สามารถตรวจสอบสถานะในบัญชีนี้');await refreshPatient();
    }catch(e){setMessage('ส่งคำขอไม่ได้: '+e.message,'error');}finally{setBusy(false);}
  });
  $('authForm').addEventListener('submit',async event=>{
    event.preventDefault();if(loading)return;
    try{setBusy(true);const {error}=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});if(error)throw error;setMessage('เข้าสู่ระบบสำเร็จ');}catch(e){setMessage('เข้าสู่ระบบไม่ได้: '+e.message,'error');}finally{setBusy(false);}
  });
  $('signOutBtn').addEventListener('click',async()=>{await db.auth.signOut();setMessage('ออกจากระบบแล้ว');});
  async function onSession(session){
    user=session?.user||null;
    if(!user){$('authPanel').classList.remove('hide');$('mainPanel').classList.add('hide');return;}
    try{await refresh();}catch(e){setMessage('โหลดข้อมูลไม่ได้: '+e.message,'error');}
  }
  $('configState').textContent='เชื่อมต่อฐานข้อมูลที่ได้รับการตั้งค่าแล้ว (ตรวจสอบสิทธิ์ก่อนใช้งานจริง)';$('configState').classList.add('ready');
  db.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>onSession(session),0)});
  db.auth.getSession().then(({data,error})=>{if(error)setMessage(error.message,'error');else onSession(data.session);});
})();
