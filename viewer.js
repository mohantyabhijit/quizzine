import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const filename = new URLSearchParams(window.location.search).get('quiz');
const quiz = window.QUIZZES.find(item => item.file === filename);
const title = document.querySelector('#viewer-title');
const topic = document.querySelector('#viewer-topic');
const deck = document.querySelector('#deck');
const deckFrame = document.querySelector('#deck-frame');
const deckLoading = document.querySelector('#deck-loading');
const download = document.querySelector('#download');
const previousSlide = document.querySelector('#previous-slide');
const nextSlide = document.querySelector('#next-slide');
const slideStatus = document.querySelector('#slide-status');

if (!quiz) {
  title.textContent = 'That quiz could not be found';
  deckFrame.replaceWith(Object.assign(document.createElement('p'), { className: 'viewer-note', textContent: 'Return to the library and choose a presentation.' }));
  download.hidden = true;
  previousSlide.parentElement.hidden = true;
} else {
  const fileUrl = new URL(`public/quizzes/${quiz.file}`, window.location.href).href;
  const viewerFile = quiz.file.endsWith('.pdf')
    ? fileUrl
    : new URL(`public/quizzes/viewer/${quiz.file.replace(/\.pptx$/i, '.pdf')}`, window.location.href).href;
  document.title = `${quiz.title} — Quizzine`;
  title.textContent = quiz.title;
  topic.textContent = quiz.topic;
  download.href = fileUrl;
  let documentProxy;
  let page = 1;
  let renderVersion = 0;

  const renderPage = async () => {
    if (!documentProxy) return;
    const version = ++renderVersion;
    deckLoading.hidden = false;
    deckFrame.setAttribute('aria-busy', 'true');
    previousSlide.disabled = page === 1;
    nextSlide.disabled = page === documentProxy.numPages;
    slideStatus.textContent = `Slide ${page} of ${documentProxy.numPages}`;

    const pdfPage = await documentProxy.getPage(page);
    if (version !== renderVersion) return;
    const originalViewport = pdfPage.getViewport({ scale: 1 });
    const availableWidth = Math.max(1, deckFrame.clientWidth - 20);
    const availableHeight = Math.max(1, deckFrame.clientHeight - 20);
    const scale = Math.min(availableWidth / originalViewport.width, availableHeight / originalViewport.height);
    const viewport = pdfPage.getViewport({ scale });
    const pixelRatio = window.devicePixelRatio || 1;
    deck.width = Math.floor(viewport.width * pixelRatio);
    deck.height = Math.floor(viewport.height * pixelRatio);
    deck.style.width = `${Math.floor(viewport.width)}px`;
    deck.style.height = `${Math.floor(viewport.height)}px`;
    const context = deck.getContext('2d', { alpha: false });
    await pdfPage.render({ canvasContext: context, viewport, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }).promise;
    if (version === renderVersion) {
      deckLoading.hidden = true;
      deckFrame.setAttribute('aria-busy', 'false');
    }
  };

  previousSlide.addEventListener('click', () => {
    if (page > 1) {
      page -= 1;
      renderPage();
    }
  });
  nextSlide.addEventListener('click', () => {
    if (documentProxy && page < documentProxy.numPages) {
      page += 1;
      renderPage();
    }
  });

  pdfjsLib.getDocument(viewerFile).promise
    .then(pdf => {
      documentProxy = pdf;
      return renderPage();
    })
    .catch(() => {
      deckLoading.textContent = 'This presentation could not be loaded. Download the deck instead.';
      deckFrame.setAttribute('aria-busy', 'false');
    });
}
