const form = document.querySelector('#upload-form');
const status = document.querySelector('#upload-status');
const button = form.querySelector('button');
const progress = document.querySelector('#upload-progress');
const progressBar = document.querySelector('#upload-progress-bar');
const progressLabel = document.querySelector('#upload-progress-label');
const apiUrl = '/api/quizzes';
let refreshPending = false;

const setProgress = (percent, label) => {
  progress.hidden = false;
  progress.setAttribute('aria-hidden', 'false');
  progressBar.style.width = `${percent}%`;
  progressLabel.textContent = label;
};

const upload = data => new Promise((resolve, reject) => {
  const request = new XMLHttpRequest();
  request.open('POST', apiUrl);
  request.responseType = 'json';
  request.upload.addEventListener('progress', event => {
    if (!event.lengthComputable) return;
    const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
    setProgress(percent, percent === 100 ? 'Creating your slide preview…' : `Uploading presentation… ${percent}%`);
  });
  request.addEventListener('load', () => {
    const result = request.response || (() => { try { return JSON.parse(request.responseText); } catch { return {}; } })();
    if (request.status === 409 && result.quiz) reject(new Error(`“${result.quiz.title}” is already in the library; it was not uploaded again.`));
    else if (request.status >= 200 && request.status < 300) resolve(result);
    else reject(new Error(result.error || 'Upload failed.'));
  });
  request.addEventListener('error', () => reject(new Error('Upload failed. Check your connection and try again.')));
  request.send(data);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const file = data.get('deck');
  if (!/\.pptx?$/i.test(file.name)) {
    status.textContent = 'Choose a PPT or PPTX file.';
    return;
  }
  button.disabled = true;
  button.textContent = 'Uploading…';
  status.textContent = 'Your quiz will appear once its preview is ready.';
  setProgress(0, 'Preparing upload…');
  try {
    const result = await upload(data);
    setProgress(100, 'Preview ready.');
    status.textContent = `“${result.quiz.title}” is now in the library. Refreshing…`;
    button.textContent = 'Upload quiz';
    refreshPending = true;
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    status.textContent = error.message;
    progress.hidden = true;
    progress.setAttribute('aria-hidden', 'true');
  } finally {
    button.disabled = refreshPending;
    if (!status.textContent.includes('Refreshing')) button.textContent = 'Upload quiz';
  }
});
