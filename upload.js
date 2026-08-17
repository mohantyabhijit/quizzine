const form = document.querySelector('#upload-form');
const status = document.querySelector('#upload-status');
const button = form.querySelector('button');
const apiUrl = '/api/quizzes';

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const file = data.get('deck');
  if (!/\.pptx?$/i.test(file.name)) {
    status.textContent = 'Choose a PPT or PPTX file.';
    return;
  }
  button.disabled = true;
  status.textContent = 'Uploading…';
  try {
    const response = await fetch(apiUrl, { method: 'POST', body: data });
    const result = await response.json();
    if (response.status === 409 && result.quiz) {
      throw new Error(`“${result.quiz.title}” is already in the library; it was not uploaded again.`);
    }
    if (!response.ok) throw new Error(result.error || 'Upload failed.');
    form.reset();
    status.textContent = `“${result.quiz.title}” is now in the library.`;
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
