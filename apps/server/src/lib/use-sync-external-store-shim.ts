import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

export { useSyncExternalStore };

export function useSyncExternalStoreWithSelector<TSnapshot, TSelection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => TSnapshot,
  getServerSnapshot: (() => TSnapshot) | undefined,
  selector: (snapshot: TSnapshot) => TSelection,
  isEqual?: (left: TSelection, right: TSelection) => boolean,
): TSelection {
  const instanceRef = useRef<{ hasValue: boolean; value: TSelection | undefined } | null>(null);

  if (instanceRef.current === null) {
    instanceRef.current = { hasValue: false, value: undefined };
  }

  const instance = instanceRef.current;
  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: TSnapshot;
    let memoizedSelection: TSelection;

    const memoizedSelector = (nextSnapshot: TSnapshot) => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);

        if (isEqual && instance.hasValue && isEqual(instance.value as TSelection, nextSelection)) {
          memoizedSelection = instance.value as TSelection;
          return memoizedSelection;
        }

        memoizedSelection = nextSelection;
        return memoizedSelection;
      }

      if (Object.is(memoizedSnapshot, nextSnapshot)) {
        return memoizedSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual && isEqual(memoizedSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return memoizedSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return memoizedSelection;
    };

    return [
      () => memoizedSelector(getSnapshot()),
      getServerSnapshot ? () => memoizedSelector(getServerSnapshot()) : undefined,
    ] as const;
  }, [getSnapshot, getServerSnapshot, instance, isEqual, selector]);

  const value = useSyncExternalStore(subscribe, getSelection, getServerSelection);

  useEffect(() => {
    instance.hasValue = true;
    instance.value = value;
  }, [instance, value]);

  useDebugValue(value);
  return value;
}
