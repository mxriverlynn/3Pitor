import { useState } from 'react';
import type { Job } from '../shared/wire';
import { api } from './api';
import './jobs.css';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);

  const start = async (prompt: string) => {
    const job = await api<Job>('POST', '/api/jobs', { prompt, maxTurns: 10 });
    setJobs((all) => [job, ...all]);
  };

  const refresh = async (jobId: string) => {
    const job = await api<Job>('GET', `/api/jobs/${jobId}`);
    setJobs((all) => all.map((j) => (j.id === job.id ? job : j)));
  };

  return { jobs, start, refresh };
}

export function Jobs({ jobs, start }: { jobs: Job[]; start: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState('');
  return (
    <div className="jobs">
      <h2>Background jobs</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (prompt.trim()) start(prompt.trim());
          setPrompt('');
        }}
      >
        <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Create summary.md summarizing notes.md" />
        <button type="submit">Run</button>
      </form>
      {jobs.length === 0 && <div className="muted small">Jobs run unattended: edits are auto-approved, other prompts are denied.</div>}
      {jobs.map((job) => (
        <div key={job.id} className="job">
          <span className={`status ${job.status}`}>{job.status}</span> {job.prompt}
          {job.text && <div className="muted">{job.text}</div>}
          {job.error && <div className="error">{job.error}</div>}
          {job.status === 'running' && (
            <button className="danger small" style={{ marginLeft: 6 }} onClick={() => api('POST', `/api/jobs/${job.id}/cancel`)}>
              cancel
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
