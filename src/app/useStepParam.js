import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Keeps a multi-step workflow's current step in the URL (?step=validate), so
// each step is linkable, survives a refresh, and the browser back button
// moves between steps. Drop-in replacement for useState(defaultStep).
export function useStepParam(defaultStep, allowed) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('step');
  const step = raw && (!allowed || allowed.includes(raw)) ? raw : defaultStep;

  const setStep = useCallback(
    (next) => {
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next === defaultStep) p.delete('step');
        else p.set('step', next);
        return p;
      });
    },
    [setParams, defaultStep]
  );

  return [step, setStep];
}
