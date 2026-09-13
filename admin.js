const adminData = Array.isArray(window.VVHL_PLAYERS) ? window.VVHL_PLAYERS : [];
const count = document.getElementById('adminPlayerCount');
if (count) count.textContent = adminData.length;
const notes = document.getElementById('adminNotes');
if (notes) {
  notes.value = localStorage.getItem('vvhl-admin-notes') || '';
  notes.addEventListener('input', () => localStorage.setItem('vvhl-admin-notes', notes.value));
}
