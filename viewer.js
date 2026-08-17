const filename = new URLSearchParams(window.location.search).get('quiz');
const quiz = window.QUIZZES.find(item => item.file === filename);
const title = document.querySelector('#viewer-title');
const topic = document.querySelector('#viewer-topic');
const deck = document.querySelector('#deck');
const download = document.querySelector('#download');

if (!quiz) {
  title.textContent = 'That quiz could not be found';
  deck.replaceWith(Object.assign(document.createElement('p'), { className: 'viewer-note', textContent: 'Return to the library and choose a presentation.' }));
  download.hidden = true;
} else {
  const fileUrl = new URL(`public/quizzes/${quiz.file}`, window.location.href).href;
  const viewerFile = quiz.file.endsWith('.pdf')
    ? fileUrl
    : new URL(`public/quizzes/viewer/${quiz.file.replace(/\.pptx$/i, '.pdf')}`, window.location.href).href;
  document.title = `${quiz.title} — Quizzine`;
  title.textContent = quiz.title;
  topic.textContent = quiz.topic;
  download.href = fileUrl;
  deck.src = viewerFile;
}
