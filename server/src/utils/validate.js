exports.validateEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

exports.validatePassword = (password) => {
  if (!password || typeof password !== 'string') return false;
  return password.length >= 6;
};

exports.validateName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return name.trim().length >= 1 && name.trim().length <= 100;
};
