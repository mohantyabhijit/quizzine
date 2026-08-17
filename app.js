let quizzes = window.QUIZZES;
const grid = document.querySelector('#quiz-grid');
const input = document.querySelector('#quiz-search');
const filters = document.querySelector('#filters');
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-state');
let selected = 'All';
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
function renderFilters() {
  const topics = ['All', ...new Set(quizzes.map(q => q.topic))];
  filters.innerHTML = topics.map(topic => `<button class="filter" data-topic="${escapeHtml(topic)}" aria-pressed="${topic === selected}">${escapeHtml(topic)}</button>`).join('');
}
function render() {
  const query = input.value.trim().toLowerCase();
  const matches = quizzes.filter(q => (selected === 'All' || q.topic === selected) && `${q.title} ${q.topic} ${q.quizmaster || ''} ${q.year || ''} ${q.handle || ''}`.toLowerCase().includes(query));
  grid.innerHTML = matches.map((q, i) => {
    const credit = q.quizmaster ? `<span class="credit">By ${escapeHtml(q.quizmaster)}${q.year ? ` · ${escapeHtml(q.year)}` : ''}${q.handle ? ` · ${escapeHtml(q.handle)}` : ''}</span>` : '';
    return `<article class="card" style="--card:${q.color || '#f5bb32'}"><span class="number">${String(i + 1).padStart(2, '0')}</span><span class="topic">${escapeHtml(q.topic)}</span><h2>${escapeHtml(q.title)}</h2>${credit}<span class="format">Open viewer →</span><a href="/viewer?quiz=${encodeURIComponent(q.id || q.file)}" aria-label="Open ${escapeHtml(q.title)}"></a></article>`;
  }).join('');
  count.textContent = `${matches.length} ${matches.length === 1 ? 'quiz' : 'quizzes'} in the library`;
  empty.hidden = matches.length !== 0;
}
filters.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; selected = button.dataset.topic; document.querySelectorAll('.filter').forEach(b => b.setAttribute('aria-pressed', b === button)); render(); });
input.addEventListener('input', render);
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); }});
renderFilters();
render();

fetch('https://origin.quizzine.org/api/quizzes')
  .then(response => response.ok ? response.json() : Promise.reject())
  .then(({ quizzes: uploaded }) => {
    if (!Array.isArray(uploaded) || !uploaded.length) return;
    quizzes = [...uploaded.map(quiz => ({ ...quiz, color: '#f2a28b' })), ...quizzes];
    renderFilters();
    render();
  })
  .catch(() => {});
