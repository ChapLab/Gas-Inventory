
function triggerDropdown(id) {
  const input = document.getElementById(id);
  input.focus();
  const val = input.value;
  input.value = '';
  input.dispatchEvent(new Event('input'));
  setTimeout(() => {
    input.value = val;
    input.dispatchEvent(new Event('input'));
  }, 50);
}
