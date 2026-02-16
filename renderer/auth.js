let isRegister = false;

const form = document.getElementById('auth-form');
const nameField = document.getElementById('name-field');
const nameInput = document.getElementById('name-input');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const submitBtn = document.getElementById('submit-btn');
const errorMsg = document.getElementById('error-msg');
const toggleText = document.getElementById('toggle-text');
const toggleLink = document.getElementById('toggle-link');
const subtitle = document.getElementById('auth-subtitle');

function setMode(register) {
  isRegister = register;
  nameField.style.display = register ? 'block' : 'none';
  submitBtn.textContent = register ? 'Create Account' : 'Sign In';
  toggleText.textContent = register ? 'Already have an account?' : "Don't have an account?";
  toggleLink.textContent = register ? 'Sign In' : 'Register';
  subtitle.textContent = register ? 'Create your account' : 'Sign in to sync your usage';
  errorMsg.textContent = '';
  passwordInput.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
}

toggleLink.addEventListener('click', (e) => {
  e.preventDefault();
  setMode(!isRegister);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMsg.textContent = '';
  submitBtn.disabled = true;
  submitBtn.textContent = isRegister ? 'Creating...' : 'Signing in...';

  try {
    let result;
    if (isRegister) {
      result = await window.electronAPI.register(emailInput.value, passwordInput.value, nameInput.value);
    } else {
      result = await window.electronAPI.login(emailInput.value, passwordInput.value);
    }
    if (result.error) {
      errorMsg.textContent = result.error;
      submitBtn.disabled = false;
      submitBtn.textContent = isRegister ? 'Create Account' : 'Sign In';
    }
    // Success: main process will close this window and open overlay
  } catch (err) {
    errorMsg.textContent = 'Connection failed. Is the server running?';
    submitBtn.disabled = false;
    submitBtn.textContent = isRegister ? 'Create Account' : 'Sign In';
  }
});
