const STUDENTS_DB_URL = "https://script.google.com/macros/s/AKfycby5cxIDqCETg20E5bXCr8ZJgb5OV_zky-9WFVDHtngVwM5noxJdU1lljHbxxbeRqh8Q/exec"; 
const SHEET_API_URL = "https://script.google.com/macros/s/AKfycby1ntSw05_regu9_kN2fHLJanjIFizsOcgSxzWfwG2YcjKgIddCKqV32az8acZCJrMz/exec"; 

let studentsDB = {};
fetch(STUDENTS_DB_URL).then(r=>r.json()).then(d=>{studentsDB=d;}).catch(e=>{console.log("DB Load Error", e)});

const subjectsData = {
    "first_year": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "اناتومى نظرى", "اناتومى عملى", "تقييم صحى نظرى", "تقييم صحى عملى", "مصطلحات طبية", "فسيولوجى", "تكنولوجيا المعلومات"],
    "second_year": ["تمريض بالغين 1 نظرى", "تمريض بالغين 1 عملى", "تمريض حالات حرجة 1 نظرى", "تمريض حالات حرجة 1 عملى", "امراض باطنة", "باثولوجى", "علم الأدوية", "الكتابة التقنية"]
};

const storageKey = "nursing_final_secure_v46"; 
const DOCTOR_MODE_KEY = "is_doctor_bypass_enabled"; 
const ADMIN_PASS = "RYADA2025"; 
const DATA_ENTRY_TIMEOUT_SEC = 15;
const TIMEOUT_BLOCK_KEY = "timeout_blocked_forever_v46_" + new Date().toLocaleDateString('en-GB'); 
const SESSION_END_TIME_KEY = "data_entry_deadline_v1";
const TEMP_NAME_KEY = "temp_student_name";
const TEMP_ID_KEY = "temp_student_id";
const TEMP_CODE_KEY = "temp_session_code";
const LOCAL_LOG_KEY = "attendance_daily_log_v1";

const MAX_ATTEMPTS = 3;
const ATTEMPTS_KEY = "daily_attempts_v46_" + new Date().toLocaleDateString('en-GB');

let userIP = "Unknown";
let geo_watch_id;
let countdownInterval; 
let html5QrCode; 
let currentAbortController = null;
let sessionEndTime = 0;
let attendanceData = {}; 
let processIsActive = false; 

// Global vars for delete confirmation
let pendingDeleteAction = null; // 'single' or 'all'
let pendingDeleteID = null;
let pendingDeleteTime = null;

fetch('https://api.ipify.org?format=json').then(r => r.json()).then(d => userIP = d.ip).catch(e => userIP = "Hidden IP");

function playClick() { document.getElementById('clickSound').play().catch(e=>{}); if(navigator.vibrate) navigator.vibrate(10); }
function playSuccess() { document.getElementById('successSound').play().catch(e=>{}); if(navigator.vibrate) navigator.vibrate([50, 50, 50]); }
function playBeep() { document.getElementById('beepSound').play().catch(e=>{}); }

function getAttemptsLeft() { let used = parseInt(localStorage.getItem(ATTEMPTS_KEY) || "0"); return Math.max(0, MAX_ATTEMPTS - used); }
function decrementAttempts() { let used = parseInt(localStorage.getItem(ATTEMPTS_KEY) || "0"); used++; localStorage.setItem(ATTEMPTS_KEY, used.toString()); updateUIForAttempts(); return MAX_ATTEMPTS - used; }
function updateUIForAttempts() { const left = getAttemptsLeft(); document.getElementById('attemptsCountValEntry').innerText = left; }

window.history.pushState(null, null, window.location.href);
window.onpopstate = function () {
    if (processIsActive && sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true') { window.history.pushState(null, null, window.location.href); } 
    else if (sessionStorage.getItem(DOCTOR_MODE_KEY) === 'true') { goBackToWelcome(); }
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        if (processIsActive && sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true') { decrementAttempts(); location.reload(); }
    }
});

function updateHeaderState(screenId) {
    const wrapper = document.getElementById('heroIconWrapper');
    const icon = document.getElementById('statusIcon');
    wrapper.classList.remove('show-icon');
    if (screenId !== 'screenWelcome') {
        wrapper.classList.add('show-icon');
        if (screenId === 'screenLoading') { icon.className = "fa-solid fa-satellite-dish hero-icon fa-spin"; icon.style.color = "var(--primary)"; }
        else if (screenId === 'screenDataEntry') { icon.className = "fa-solid fa-user-pen hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
        else if (screenId === 'screenScanQR') { icon.className = "fa-solid fa-qrcode hero-icon"; icon.style.color = "var(--primary)"; icon.style.animation = "none"; }
        else if (screenId === 'screenSuccess') { icon.className = "fa-solid fa-check hero-icon"; icon.style.color = "#10b981"; icon.style.animation = "none"; }
        else if (screenId === 'screenError') { icon.className = "fa-solid fa-triangle-exclamation hero-icon"; icon.style.color = "#ef4444"; icon.style.animation = "none"; }
        else if (screenId === 'screenAdminLogin') { icon.className = "fa-solid fa-lock hero-icon"; icon.style.color = "var(--primary-dark)"; icon.style.animation = "none"; }
    }
}

function switchScreen(id) { 
    const allSections = document.querySelectorAll('.section');
    const nextScreen = document.getElementById(id);
    allSections.forEach(el => { if (el.classList.contains('active')) el.classList.remove('active'); });
    nextScreen.classList.add('active');
    updateHeaderState(id);
    const adminBack = document.getElementById('adminFloatingBack');
    const isAdmin = sessionStorage.getItem(DOCTOR_MODE_KEY) === 'true';
    if (isAdmin && id !== 'screenWelcome' && id !== 'screenAdminLogin') { adminBack.style.display = 'flex'; } else { adminBack.style.display = 'none'; }
    if (!isAdmin && (id === 'screenDataEntry' || id === 'screenScanQR' || id === 'screenLoading')) { processIsActive = true; } else { processIsActive = false; }
}

window.onload = function() {
    initGlobalGuard(); updateUIForAttempts(); updateUIForMode(); setupCustomSelects(); 
    setInterval(() => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {hour12: true, hour:'2-digit', minute:'2-digit', second:'2-digit'});
        const dateStr = now.toLocaleDateString('en-GB');
        const timeEl = document.getElementById('currentTime'); const dateEl = document.getElementById('currentDate');
        if(timeEl) timeEl.innerText = timeStr; if(dateEl) dateEl.innerText = dateStr;
    }, 1000);
    document.getElementById('submitBtn').addEventListener('click', function(e) { e.preventDefault(); submitToGoogle(); });
    const left = getAttemptsLeft(); if (left === 0 && sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true') { showError("⛔ لقد استنفذت جميع محاولاتك اليوم (3 محاولات).<br>تم حظرك.", true); }
    
    // Bind Confirm Modal Button
    document.getElementById('btnConfirmDelete').addEventListener('click', executeDelete);
};

function updateUIForMode() {
    const isAdmin = sessionStorage.getItem(DOCTOR_MODE_KEY) === 'true';
    const badge = document.getElementById('adminBadge');
    const loginBtn = document.getElementById('btnAdminLogin');
    const logoutBtn = document.getElementById('btnAdminLogout');
    const reportBtn = document.getElementById('btnViewReport'); 
    const adminFloating = document.getElementById('adminFloatingBack');
    const attemptsBadge = document.getElementById('attemptsDisplayEntry');
    
    if (isAdmin) { 
        badge.style.display = 'block'; 
        loginBtn.style.display = 'none'; 
        logoutBtn.style.display = 'block'; 
        
        // Update Report Button for Admin (Active)
        reportBtn.style.display = 'block'; 
        reportBtn.disabled = false;
        reportBtn.className = 'btn-secondary';
        reportBtn.style.background = '#ecfdf5';
        reportBtn.style.color = '#15803d';
        reportBtn.style.borderColor = '#d1fae5';
        reportBtn.innerHTML = '<i class="fa-solid fa-list-check"></i> سجل حضور اليوم';
        
        if(attemptsBadge) attemptsBadge.style.display = 'none'; 
    } else { 
        badge.style.display = 'none'; 
        loginBtn.style.display = 'block'; 
        logoutBtn.style.display = 'none'; 
        
        // Update Report Button for Student (Locked)
        reportBtn.style.display = 'block';
        reportBtn.disabled = true;
        reportBtn.className = 'btn-secondary';
        reportBtn.style.background = '#ffffff';
        reportBtn.style.color = '#94a3b8';
        reportBtn.style.borderColor = '#e2e8f0';
        reportBtn.innerHTML = '<i class="fa-solid fa-lock"></i> سجل حضور اليوم (مقفل)';
        
        adminFloating.style.display = 'none'; 
        if(attemptsBadge) attemptsBadge.style.display = 'inline-flex'; 
    }
    updateUIForAttempts();
}

async function startProcess(skip = false) {
    playClick();
    if (sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true') { if (getAttemptsLeft() <= 0) { showError("⛔ لقد استنفذت محاولاتك (3) اليوم.", true); return; } }
    if (sessionStorage.getItem(DOCTOR_MODE_KEY) === 'true') { generateCodeAndShowDataEntry(); return; }
    const isOnline = await checkRealConnection(); if (!isOnline) { showConnectionLostModal(); return; }
    if (localStorage.getItem(TIMEOUT_BLOCK_KEY) === 'true') { showError("⏳ لقد انتهت المهلة المحددة سابقاً.<br>لا يمكنك التسجيل.", true); return; }
    if (localStorage.getItem(storageKey) === new Date().toLocaleDateString('en-GB')) { showError("⛔ تم تسجيل الحضور اليوم مسبقاً.", true); return; }
    switchScreen('screenLoading');
    if (navigator.geolocation) { navigator.geolocation.getCurrentPosition(checkPosition, handleGpsError, { enableHighAccuracy: false, timeout: 30000, maximumAge: Infinity }); } else { showError("الجهاز لا يدعم GPS.", false); }
}

function checkPosition(position) {
    const targetLat = 30.38583; const targetLong = 30.48888; const allowedDistance = 1.0; 
    const dist = getDistanceFromLatLonInKm(position.coords.latitude, position.coords.longitude, targetLat, targetLong);
    if (dist <= allowedDistance) { generateCodeAndShowDataEntry(); } else { showError(`📍 أنت خارج النطاق الجغرافي للكلية.<br>المسافة الحالية: ${dist.toFixed(2)} كم`, false); }
}

function generateCodeAndShowDataEntry() {
    playClick();
    let code = (Math.floor(142 + Math.random() * 1280) * 7); if (code < 1000) code += 7000;
    attendanceData.code = code.toString(); document.getElementById('attendanceCode').value = code; sessionStorage.setItem(TEMP_CODE_KEY, code.toString());
    const newEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionEndTime = newEndTime; sessionStorage.setItem(SESSION_END_TIME_KEY, newEndTime.toString());
    switchScreen('screenDataEntry'); startCountdown(); 
}

function startCountdown() {
    const savedDeadline = sessionStorage.getItem(SESSION_END_TIME_KEY);
    if (savedDeadline) sessionEndTime = parseInt(savedDeadline); else { sessionEndTime = Date.now() + (DATA_ENTRY_TIMEOUT_SEC * 1000); sessionStorage.setItem(SESSION_END_TIME_KEY, sessionEndTime.toString()); }
    const circle = document.getElementById('timerProgress'); const text = document.getElementById('timerNumber'); const circumference = 2 * Math.PI * 35; 
    if(countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        const now = Date.now(); const remainingMs = sessionEndTime - now; const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
        const percent = Math.max(0, remainingMs / (DATA_ENTRY_TIMEOUT_SEC * 1000)); const offset = circumference - (percent * circumference);
        text.innerText = secondsLeft.toString(); circle.style.strokeDashoffset = offset;
        if (secondsLeft > 10) circle.style.stroke = "#10b981"; else if (secondsLeft > 5) circle.style.stroke = "#f59e0b"; else { circle.style.stroke = "#ef4444"; circle.parentElement.classList.add('timer-pulse'); }
        if (remainingMs <= 0) {
            clearInterval(countdownInterval); if (sessionStorage.getItem(DOCTOR_MODE_KEY) === 'true') { text.innerText = "0"; return; }
            const left = decrementAttempts(); document.getElementById('nextStepBtn').disabled = true; hideConnectionLostModal(); processIsActive = false; 
            if (left === 0) { localStorage.setItem(TIMEOUT_BLOCK_KEY, 'true'); showError("⏳ انتهى الوقت. لقد استنفذت جميع المحاولات.<br>تم إغلاق التسجيل.", true); } else { showError(`⏳ انتهى الوقت.<br>تم خصم محاولة. المتبقي: ${left}`, false); }
        }
    }, 100); 
}

async function handleIdSubmit() {
    playClick(); const uniIdVal = document.getElementById('uniID').value.trim(); const alertBox = document.getElementById('dataEntryAlert');
    if (!uniIdVal) { alertBox.innerText = "⚠️ يرجى إدخال الكود الجامعي."; alertBox.style.display = 'block'; return; }
    if(Object.keys(studentsDB).length === 0) { alertBox.innerText = "⚠️ جاري تحميل البيانات.."; alertBox.style.display = 'block'; return; }
    const studentName = studentsDB[uniIdVal];
    if (studentName) {
        attendanceData.uniID = uniIdVal; attendanceData.name = studentName;
        sessionStorage.setItem(TEMP_ID_KEY, uniIdVal); sessionStorage.setItem(TEMP_NAME_KEY, studentName);
        document.getElementById('scanNameDisplay').innerText = studentName; document.getElementById('scanIDDisplay').innerText = uniIdVal; 
        if(countdownInterval) clearInterval(countdownInterval); stopCameraSafely(); switchScreen('screenScanQR'); playSuccess();
    } else { alertBox.innerText = "❌ الكود غير صحيح."; alertBox.style.display = 'block'; if(navigator.vibrate) navigator.vibrate(300); }
}

async function submitToGoogle() {
    playClick(); const btn = document.getElementById('submitBtn'); const originalText = "تأكيد الحضور <i class='fa-solid fa-paper-plane'></i>";
    const selectedSubject = document.getElementById('subjectSelect').value; const sessionPassVal = document.getElementById('sessionPass').value;
    if(!attendanceData.uniID || !sessionPassVal || !selectedSubject) { alert("بيانات ناقصة"); return; }
    if (sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true' && localStorage.getItem(TIMEOUT_BLOCK_KEY) === 'true') { showError("محظور"); return; }
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الفحص...'; btn.disabled = true;
    const isOnline = await checkRealConnection(); if (!isOnline) { btn.innerHTML = originalText; btn.disabled = false; showConnectionLostModal(); return; }
    const now = new Date(); document.getElementById('receiptName').innerText = attendanceData.name; document.getElementById('receiptID').innerText = attendanceData.uniID; document.getElementById('receiptSubject').innerText = selectedSubject; document.getElementById('receiptDate').innerText = now.toLocaleDateString('en-GB'); document.getElementById('receiptTime').innerText = now.toLocaleTimeString('en-US', {hour12: true, hour: '2-digit', minute:'2-digit'});
    const finalCodeValue = `${attendanceData.code} (QR: ${sessionPassVal})`; const formParams = new URLSearchParams(); formParams.append("id", attendanceData.uniID); formParams.append("name", attendanceData.name); formParams.append("code", finalCodeValue); formParams.append("ip", userIP); formParams.append("subject", selectedSubject); 
    currentAbortController = new AbortController(); const timeoutId = setTimeout(() => currentAbortController.abort(), 10000); 
    try {
        await fetch(SHEET_API_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formParams.toString(), signal: currentAbortController.signal });
        clearTimeout(timeoutId); processIsActive = false; 
        if (sessionStorage.getItem(DOCTOR_MODE_KEY) !== 'true') { localStorage.setItem(storageKey, new Date().toLocaleDateString('en-GB')); }
        saveToLocalLog({ name: attendanceData.name, uniID: attendanceData.uniID, subject: selectedSubject });
        switchScreen('screenSuccess'); playSuccess(); confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: ['#0ea5e9', '#10b981'] });
    } catch (error) { btn.innerHTML = originalText; btn.disabled = false; showConnectionLostModal(); }
}

function addKey(num) { playClick(); const i = document.getElementById('uniID'); if(i.value.length<10) i.value+=num; }
function backspaceKey() { playClick(); const i = document.getElementById('uniID'); i.value=i.value.slice(0,-1); }
function clearKey() { playClick(); document.getElementById('uniID').value=''; }
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) { var R = 6371; var dLat = (lat2-lat1) * (Math.PI/180); var dLon = (lon2-lon1) * (Math.PI/180); var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * (Math.PI/180)) * Math.cos(lat2 * (Math.PI/180)) * Math.sin(dLon/2) * Math.sin(dLon/2); return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); }
function saveToLocalLog(d) { let l=JSON.parse(localStorage.getItem(LOCAL_LOG_KEY)||"[]"); d.date=new Date().toLocaleDateString('en-GB'); d.timestamp=new Date().toLocaleTimeString('en-US', {hour12: true, hour: '2-digit', minute:'2-digit'}); l.push(d); localStorage.setItem(LOCAL_LOG_KEY,JSON.stringify(l)); }
async function goBackToWelcome() { playClick(); if (geo_watch_id) navigator.geolocation.clearWatch(geo_watch_id); if(countdownInterval) clearInterval(countdownInterval); await stopCameraSafely(); sessionStorage.removeItem(SESSION_END_TIME_KEY); sessionStorage.removeItem(TEMP_NAME_KEY); sessionStorage.removeItem(TEMP_ID_KEY); sessionStorage.removeItem(TEMP_CODE_KEY); processIsActive = false; document.getElementById('uniID').value = ''; document.getElementById('startScanCard').style.display = 'flex'; hideConnectionLostModal(); switchScreen('screenWelcome'); }

/* --- FIXED JS FOR CUSTOM SELECT (Traditional Dropdown) --- */
function setupCustomSelects() {
    const yearWrapper = document.getElementById('yearSelectWrapper');
    const subjectWrapper = document.getElementById('subjectSelectWrapper');
    const allWrappers = [yearWrapper, subjectWrapper];

    function toggleSelect(wrapper, event) {
        event.stopPropagation();
        if (!wrapper.classList.contains('open')) {
            allWrappers.forEach(w => w.classList.remove('open'));
            if (!wrapper.classList.contains('disabled')) {
                wrapper.classList.add('open');
                playClick();
            }
        } else {
            wrapper.classList.remove('open');
        }
    }

    yearWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(yearWrapper, e));
    subjectWrapper.querySelector('.custom-select-trigger').addEventListener('click', (e) => toggleSelect(subjectWrapper, e));

    yearWrapper.querySelectorAll('.custom-option').forEach(op => {
        op.addEventListener('click', function(e) {
            e.stopPropagation();
            yearWrapper.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
            this.classList.add('selected');
            yearWrapper.querySelector('.custom-select-trigger span').textContent = this.textContent;
            yearWrapper.classList.remove('open');
            document.getElementById('yearSelect').value = this.getAttribute('data-value');
            playClick();
            updateSubjects();
        });
    });

    window.addEventListener('click', (e) => {
        allWrappers.forEach(wrapper => {
            if (wrapper.classList.contains('open')) {
                wrapper.classList.remove('open');
            }
        });
    });
}

function updateSubjects() { 
    const y = document.getElementById("yearSelect").value; 
    const sWrapper = document.getElementById('subjectSelectWrapper'); 
    const sOptions = document.getElementById('subjectOptionsContainer'); 
    const sTrigger = sWrapper.querySelector('.custom-select-trigger span'); 
    const sReal = document.getElementById("subjectSelect"); 
    
    sReal.innerHTML = '<option value="" disabled selected>-- اختر المادة --</option>'; 
    sOptions.innerHTML = ''; 
    sTrigger.textContent = '-- اختر المادة --'; 
    
    if (y && subjectsData[y]) { 
        sReal.disabled = false; 
        sWrapper.classList.remove('disabled'); 
        subjectsData[y].forEach(sub => { 
            const opt = document.createElement("option"); 
            opt.value = sub; 
            opt.text = sub; 
            sReal.appendChild(opt); 
            
            const cOpt = document.createElement('div'); 
            cOpt.className = 'custom-option'; 
            cOpt.textContent = sub; 
            cOpt.setAttribute('data-value', sub); 
            
            cOpt.addEventListener('click', function(e) { 
                e.stopPropagation();
                sOptions.querySelectorAll('.custom-option').forEach(o => o.classList.remove('selected'));
                this.classList.add('selected');
                sTrigger.textContent = this.textContent; 
                sWrapper.classList.remove('open'); 
                sReal.value = this.getAttribute('data-value'); 
                playClick();
                checkSubjectSelection(); 
            }); 
            sOptions.appendChild(cOpt); 
        }); 
    } else { 
        sReal.disabled = true; 
        sWrapper.classList.add('disabled'); 
        sTrigger.textContent = '-- اختر الفرقة أولاً --'; 
    } 
    checkSubjectSelection(); 
}

function checkSubjectSelection() { const s = document.getElementById('subjectSelect').value; const p = document.getElementById('sessionPass').value; const b = document.getElementById('submitBtn'); if(s && p) { b.disabled = false; b.style.opacity = "1"; b.style.cursor = "pointer"; } else { b.disabled = true; b.style.opacity = "0.6"; b.style.cursor = "not-allowed"; } }
async function stopCameraSafely() { if(html5QrCode && html5QrCode.isScanning) { try { await html5QrCode.stop(); } catch(e) {} } document.getElementById('qr-reader').style.display = 'none'; }
function retryCamera() { document.getElementById('cameraErrorModal').style.display = 'none'; startQrScanner(); }
async function startQrScanner() { playClick(); await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('qr-reader').style.display = 'block'; document.getElementById('qr-reader').innerHTML = '<div class="scanner-laser" style="display:block"></div>'; document.getElementById('submitBtn').disabled = true; document.getElementById('sessionPass').value = ''; html5QrCode = new Html5Qrcode("qr-reader"); try { await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, (t) => { playBeep(); html5QrCode.stop().then(() => { document.getElementById('qr-reader').style.display = 'none'; document.getElementById('scanSuccessMsg').style.display = 'flex'; document.getElementById('sessionPass').value = t; checkSubjectSelection(); if(navigator.vibrate) navigator.vibrate([100,50,100]); }); }); } catch (err) { await stopCameraSafely(); document.getElementById('startScanCard').style.display = 'none'; document.getElementById('retryCamBtn').style.display = 'flex'; document.getElementById('cameraErrorModal').style.display = 'flex'; } }
function checkAdminPassword() { playClick(); if (document.getElementById('adminPassword').value === ADMIN_PASS) { sessionStorage.setItem(DOCTOR_MODE_KEY, 'true'); document.getElementById('toastMessage').style.display = 'block'; setTimeout(() => { document.getElementById('toastMessage').style.display = 'none'; }, 3000); updateUIForMode(); switchScreen('screenWelcome'); } else { document.getElementById('adminAlert').innerText = "❌ خطأ"; document.getElementById('adminAlert').style.display = 'block'; document.getElementById('adminPassword').value = ''; } }
function showError(msg, isPermanent = false) { if(countdownInterval) clearInterval(countdownInterval); document.getElementById('errorMsg').innerHTML = msg; const retryBtn = document.getElementById('retryBtn'); if(isPermanent) retryBtn.style.display = 'none'; else { retryBtn.style.display = 'inline-block'; retryBtn.onclick = function() { location.reload(); }; } switchScreen('screenError'); if(navigator.vibrate) navigator.vibrate(300); }
function performLogout() { playClick(); sessionStorage.removeItem(DOCTOR_MODE_KEY); location.reload(); }
function openLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'flex'; }
function closeLogoutModal() { playClick(); document.getElementById('customLogoutModal').style.display = 'none'; }
function reloadApp() { playClick(); location.reload(); }
function showConnectionLostModal() { document.getElementById('connectionLostModal').style.display = 'flex'; }
function hideConnectionLostModal() { document.getElementById('connectionLostModal').style.display = 'none'; }
async function checkRealConnection() { try { await fetch('https://jsonplaceholder.typicode.com/posts/1?t=' + Date.now(), { method: 'HEAD', cache: 'no-store' }); return true; } catch (e) { return false; } }
function initGlobalGuard() { setInterval(async () => { const o = await checkRealConnection(); if (!o) showConnectionLostModal(); else hideConnectionLostModal(); }, 2000); }
function handleGpsError(error) { let msg = "يرجى تفعيل الموقع (GPS)."; if(error.code == 1) msg = "⛔ تم رفض إذن الموقع."; else if(error.code == 2) msg = "⚠️ إشارة GPS ضعيفة."; document.getElementById('errorMsg').innerHTML = msg; document.getElementById('retryBtn').onclick = function() { playClick(); switchScreen('screenLoading'); navigator.geolocation.getCurrentPosition(checkPosition, handleGpsError, { enableHighAccuracy: false, timeout: 30000, maximumAge: 0 }); }; switchScreen('screenError'); }

/* --- New Delete Logic --- */
function openConfirmModal(action, id, time) {
    pendingDeleteAction = action;
    pendingDeleteID = id;
    pendingDeleteTime = time;
    const msgEl = document.getElementById('confirmModalText');
    if(action === 'single') msgEl.innerText = "هل أنت متأكد من حذف هذا الطالب من السجل المحلي؟";
    else msgEl.innerText = "هل أنت متأكد من مسح جميع السجلات المسجلة اليوم؟";
    document.getElementById('customConfirmModal').style.display = 'flex';
}
function closeConfirmModal() {
    playClick();
    document.getElementById('customConfirmModal').style.display = 'none';
    pendingDeleteAction = null;
}
function executeDelete() {
    playClick();
    if(pendingDeleteAction === 'single') {
        let l=JSON.parse(localStorage.getItem(LOCAL_LOG_KEY)||"[]").filter(x=>!(x.uniID==pendingDeleteID && x.timestamp==pendingDeleteTime));
        localStorage.setItem(LOCAL_LOG_KEY,JSON.stringify(l));
    } else if(pendingDeleteAction === 'all') {
        localStorage.removeItem(LOCAL_LOG_KEY);
    }
    closeConfirmModal();
    openReportModal(); // Refresh report
}

function openReportModal() { 
    playClick(); document.getElementById('reportModal').style.display = 'flex'; 
    const d=new Date().toLocaleDateString('en-GB'); 
    document.getElementById('reportDateDisplay').innerText=`(${d})`; 
    let l=JSON.parse(localStorage.getItem(LOCAL_LOG_KEY)||"[]").filter(x=>x.date===d); 
    if(l.length===0) document.getElementById('reportContent').innerHTML='<div class="empty-state">لا يوجد سجلات حضور اليوم.</div>'; 
    else { 
        let h=''; let g=l.reduce((a,c)=>{(a[c.subject]=a[c.subject]||[]).push(c);return a},{}); let i=0; 
        for(const[s,st] of Object.entries(g)){ 
            h+=`<div class="report-group">
                <div class="report-header" onclick="toggleReportGroup('g_${i}',this)">
                    <span>${s}</span><span class="report-count">${st.length}</span>
                </div>
                <div id="g_${i}" class="report-list-container" style="display:none;">
                    ${st.map(x=>`
                        <div class="report-item">
                            <div style="display:flex; flex-direction:column; align-items:flex-start;">
                                <span class="st-name">${x.name}</span>
                                <span class="st-id english-num" style="font-size:10px; color:#94a3b8;">${x.uniID}</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span class="english-num" style="font-size:11px; color:#64748b; font-family:'Outfit'; direction:ltr;">${x.timestamp}</span>
                                <button onclick="promptDeleteSingle('${x.uniID}','${x.timestamp}')" class="btn-delete-single">
                                    <i class="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`; 
            i++; 
        } 
        document.getElementById('reportContent').innerHTML=h; 
    } 
}

function toggleReportGroup(id,el) { playClick(); const x=document.getElementById(id); if(x.style.display==='block'){x.style.display='none';el.classList.remove('active');}else{x.style.display='block';el.classList.add('active');} }
function promptDeleteSingle(id, tm) { playClick(); openConfirmModal('single', id, tm); }
function promptClearAll() { playClick(); openConfirmModal('all', null, null); }
function closeReportModal() { playClick(); document.getElementById('reportModal').style.display = 'none'; }
function clearLocalReport() { promptClearAll(); }

function isMobileDevice() { return (typeof window.orientation !== "undefined") || (navigator.userAgent.indexOf('IEMobile') !== -1); }
if (!isMobileDevice()) { document.getElementById('desktop-blocker').style.display = 'flex'; throw new Error("Desktop access denied."); }