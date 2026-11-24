import { useSearchParams } from 'react-router-dom';

export function useListParams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  function setPage(next: number) {
    const copy = new URLSearchParams(params);
    if (next <= 1) copy.delete('page');
    else copy.set('page', String(next));
    setParams(copy);
  }

  function setFilter(key: string, value: string) {
    const copy = new URLSearchParams(params);
    if (!value) copy.delete(key);
    else copy.set(key, value);
    copy.delete('page');
    setParams(copy);
  }

  function filter(key: string) {
    return params.get(key) ?? '';
  }

  return { page, setPage, setFilter, filter };
}
