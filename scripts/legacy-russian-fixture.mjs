export const seedRussian = target => target.addInitScript(() => {
  if (!localStorage.getItem('x4-language-v1')) localStorage.setItem('x4-language-v1', 'ru');
});
