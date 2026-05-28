import { useEffect, useState, type DependencyList } from "react";

type AsyncState<T> = {
  data: T | null;
  error: Error | null;
  isLoading: boolean;
};

export function useAsyncData<T>(loader: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: null,
    error: null,
    isLoading: true,
  });

  useEffect(() => {
    let isActive = true;

    setState({ data: null, error: null, isLoading: true });

    loader()
      .then((data) => {
        if (isActive) setState({ data, error: null, isLoading: false });
      })
      .catch((error: unknown) => {
        if (isActive) {
          setState({
            data: null,
            error: error instanceof Error ? error : new Error("Unexpected loading error"),
            isLoading: false,
          });
        }
      });

    return () => {
      isActive = false;
    };
  }, deps);

  return state;
}
