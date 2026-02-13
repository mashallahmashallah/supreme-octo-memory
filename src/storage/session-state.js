import { getAll, put, remove } from './db.js';

const MAX_PROMPTS = 10;
const MAX_BENCHMARK_RUNS = 30;

export async function savePrompt(text, modelId) {
  const normalized = (text || '').trim();
  if (!normalized) return;

  await put('prompts', {
    text: normalized,
    modelId,
    updatedAt: Date.now()
  });

  const prompts = await getAll('prompts');
  const stale = prompts.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(MAX_PROMPTS);
  await Promise.all(stale.map((prompt) => (typeof prompt.id === 'number' ? remove('prompts', prompt.id) : Promise.resolve())));
}

export async function loadRecentPrompts() {
  const rows = await getAll('prompts');
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function saveBenchmarkRun(run) {
  await put('benchmarkRuns', {
    ...run,
    updatedAt: Date.now()
  });

  const rows = await getAll('benchmarkRuns');
  const stale = rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(MAX_BENCHMARK_RUNS);
  await Promise.all(stale.map((entry) => (typeof entry.id === 'number' ? remove('benchmarkRuns', entry.id) : Promise.resolve())));
}

export async function loadRecentBenchmarkRuns() {
  const rows = await getAll('benchmarkRuns');
  return rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
