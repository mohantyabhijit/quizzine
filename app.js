const quizzes = [
  { title: "Rule or Be Ruined — Mains", topic: "Mixed bag", file: "rule-or-be-ruined-mains.pptx", color: "#f5bb32" },
  { title: "Rule or Be Ruined — Prelims", topic: "Mixed bag", file: "rule-or-be-ruined-prelims.pptx", color: "#a7d8d7" },
  { title: "The Origin Files", topic: "Mixed bag", file: "origin-files.pptx", color: "#d8c4e8" },
  { title: "Reels, Ragas aur Random Gyaan", topic: "India & culture", file: "reels-ragas-random-gyaan.pptx", color: "#f2a28b" },
  { title: "Entering to Basics", topic: "General knowledge", file: "entering-to-basics.pptx", color: "#a7d8d7" },
  { title: "Long Time No See", topic: "Mixed bag", file: "long-time-no-see.pptx", color: "#f5bb32" },
  { title: "Heat Wave Hangover", topic: "Current affairs", file: "heat-wave-hangover.pdf", color: "#f2a28b" },
  { title: "Cinequest", topic: "Film & entertainment", file: "cinequest.pdf", color: "#d8c4e8" },
  { title: "Quiz Me Baby", topic: "Mixed bag", file: "quiz-me-baby.pptx", color: "#f5bb32" },
  { title: "The MELA Grid", topic: "India & culture", file: "mela-grid.pptx", color: "#a7d8d7" },
  { title: "Khichidi Ghotala", topic: "India & culture", file: "khichidi-ghotala.pdf", color: "#f2a28b" },
  { title: "Ad-icted", topic: "Business & brands", file: "ad-icted.pptx", color: "#d8c4e8" }
];
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
  grid.innerHTML = matches.map((q, i) => `<article class="card" style="--card:${q.color}"><span class="number">${String(i + 1).padStart(2, '0')}</span><span class="topic">${q.topic}</span><h2>${q.title}</h2><span class="format">${q.file.endsWith('.pdf') ? 'Open PDF' : 'Download slides'} →</span><a href="public/quizzes/${q.file}" target="_blank" rel="noopener" aria-label="Open ${q.title}"></a></article>`).join('');
  count.textContent = `${matches.length} ${matches.length === 1 ? 'quiz' : 'quizzes'} in the library`;
  empty.hidden = matches.length !== 0;
}
filters.addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; selected = button.dataset.topic; document.querySelectorAll('.filter').forEach(b => b.setAttribute('aria-pressed', b === button)); render(); });
input.addEventListener('input', render);
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.focus(); }});
render();
