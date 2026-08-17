const quizzes = window.QUIZZES;
const grid = document.querySelector('#quiz-grid');
const input = document.querySelector('#quiz-search');
const filters = document.querySelector('#filters');
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-state');
let selected = 'All';
const topics = ['All', ...new Set(quizzes.map(q => q.topic))];
filters.innerHTML = topics.map(topic => `<button class="filter" data-topic="${topic}" aria-pressed="${topic === selected}">${topic}</button>`).join('');
function render() {
  const query = input.value.trim().toLowerCase();
  const matches = quizzes.filter(q => (selected === 'All' || q.topic === selected) && `${q.title} ${q.topic}`.toLowerCase().includes(query));
  grid.innerHTML = matches.map((q, i) => `<article class="card" style="--card:${q.color}"><span class="number">${String(i + 1).padStart(2, '0')}</span><span class="topic">${q.topic}</span><h2>${q.title}</h2><span class="format">Open viewer →</span><a href="viewer.html?quiz=${encodeURIComponent(q.file)}" aria-label="Open ${q.title}"></a></article>`).join('');
  count.textContent = `${matches.length} ${matches.length === 1 ? 'quiz' : 'quizzes'} in the library`;
  empty.hidden = matches.length !== 0;
}
filters.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; selected = button.dataset.topic; document.querySelectorAll('.filter').forEach(b => b.setAttribute('aria-pressed', b === button)); render(); });
input.addEventListener('input', render);
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); }});
render();
