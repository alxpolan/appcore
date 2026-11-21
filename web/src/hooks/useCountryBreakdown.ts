import { useEffect, useState } from "react";
import { apiGet } from "./useApi";

export function useCountryBreakdown<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path != null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (path == null) return;

    let live = true;

    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (!live) return;

        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        if (!live) return;

        setError(e.message);
        setLoading(false);
      });

    return () => {
      live = false;
    };
  }, [path]);

  return { data, loading, error };
}
