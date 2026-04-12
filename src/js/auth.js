// ══════════════════════════════════════════════════
//  WELCOME / AUTH
// ══════════════════════════════════════════════════
window.onload = function() {
  const saved = localStorage.getItem('it_user');
  if (saved) {
    currentUser = saved;
    isAdmin = localStorage.getItem('it_admin') === '1';
    showApp();
  }
};

document.getElementById('name-input').addEventListener('keydown', e => { if (e.key === 'Enter') enterApp(); });

function enterApp() {
  const val = document.getElementById('name-input').value.trim();
  if (!val) { shake(document.getElementById('name-input')); return; }
  if (val === ADMIN_USER) {
    const pw = prompt('Enter admin password:');
    if (pw !== ADMIN_PASSWORD) { alert('Incorrect password.'); return; }
    isAdmin = true;
    localStorage.setItem('it_admin', '1');
  } else {
    isAdmin = false;
    localStorage.removeItem('it_admin');
  }
  currentUser = val;
  localStorage.setItem('it_user', val);
  showApp();
}

function showApp() {
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('header-avatar').textContent = currentUser.slice(0,2).toUpperCase();
  document.getElementById('header-name').textContent = currentUser;
  goHome();
  loadRecs();
}

function switchUser() {
  if (confirm(`Switch from "${currentUser}"?`)) {
    localStorage.removeItem('it_user');
    localStorage.removeItem('it_admin');
    location.reload();
  }
}

