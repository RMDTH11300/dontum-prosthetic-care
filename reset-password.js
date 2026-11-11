(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const state = $('resetState');
  const form = $('resetForm');
  const cfg = window.DT_PORTAL_CONFIG;
  const valid = !!(cfg && cfg.testMode === true && cfg.productionApproved === false &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url || '') &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(cfg.publishableKey || ''));
  if (!valid || !window.supabase?.createClient) {
    state.textContent = 'ยังไม่พร้อมใช้งาน กรุณาตรวจการตั้งค่าระบบทดสอบ';
    return;
  }
  const urlAtStart = window.location.search + window.location.hash;
  const hasRecoveryHint = /(?:^|[?&#])type=recovery(?:[&#]|$)/.test(urlAtStart);
  const db = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true }
  });
  let recoveryReady = false;
  let submitting = false;
  function ready() {
    recoveryReady = true;
    state.textContent = 'ตรวจสอบลิงก์สำเร็จ กรุณาตั้งรหัสผ่านใหม่อย่างน้อย 12 ตัวอักษร';
    form.classList.remove('hide');
    if (window.location.hash) window.history.replaceState({}, '', window.location.pathname);
  }
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY' && session) ready();
  });
  db.auth.getSession().then(({data, error}) => {
    if (recoveryReady) return;
    if (hasRecoveryHint && data?.session) ready();
    else state.textContent = error ? 'ตรวจสอบลิงก์ไม่สำเร็จ กรุณาขอลิงก์ใหม่' :
      'ไม่พบลิงก์กู้คืนที่ใช้งานได้ หรืออาจหมดอายุ กรุณาขอลิงก์ใหม่จาก Supabase';
  }).catch(() => { state.textContent = 'ตรวจสอบลิงก์ไม่ได้ กรุณาลองใหม่'; });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!recoveryReady || submitting) return;
    const password = $('newPassword').value;
    if (password.length < 12 || password !== $('confirmPassword').value) {
      state.textContent = 'รหัสผ่านต้องมีอย่างน้อย 12 ตัวอักษร และทั้งสองช่องต้องตรงกัน';
      return;
    }
    submitting = true;
    $('resetBtn').disabled = true;
    try {
      const { error } = await db.auth.updateUser({ password });
      if (error) throw error;
      await db.auth.signOut();
      form.reset();
      form.classList.add('hide');
      recoveryReady = false;
      state.textContent = 'ตั้งรหัสผ่านใหม่สำเร็จแล้ว กลับไปหน้าเข้าสู่ระบบและใช้รหัสผ่านใหม่ได้เลย';
    } catch (error) {
      state.textContent = 'ตั้งรหัสผ่านไม่ได้: ' + (error?.message || 'เกิดข้อผิดพลาด');
    } finally {
      submitting = false;
      $('resetBtn').disabled = false;
    }
  });
})();
