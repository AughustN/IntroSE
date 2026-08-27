import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  useLocation,
  useNavigate,
  type NavigateFunction,
  type NavigateOptions,
  type To,
} from "react-router-dom";

type Action = () => void;
type Guard = (proceed: Action) => void;
const NavigationGuardContext = createContext({
  requestNavigation: (proceed: Action) => proceed(),
  registerGuard:
    (_guard: Guard): Action =>
    () => {},
});

/** Guard application navigation without changing the app's BrowserRouter/history contract. */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const guard = useRef<Guard | null>(null);
  const location = useLocation();
  const index = useRef<number | null>(null);
  useLayoutEffect(() => {
    index.current = window.history.state?.idx ?? null;
  }, [location]);
  const requestNavigation = useCallback((proceed: Action) => {
    if (guard.current) guard.current(proceed);
    else proceed();
  }, []);
  const registerGuard = useCallback((next: Guard) => {
    guard.current = next;
    return () => {
      if (guard.current === next) guard.current = null;
    };
  }, []);

  useEffect(() => {
    let restoring = false;
    let approvedPop = false;
    let delta = 0;
    // A POP has already moved the browser. Restore its entry before asking, keeping React Router
    // on the form until the answer. Unlike a sentinel, this adds no duplicate history entries.
    const onPop = (event: PopStateEvent) => {
      if (approvedPop) {
        approvedPop = false;
        return;
      }
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        requestNavigation(() => {
          approvedPop = true;
          window.history.go(-delta);
        });
        return;
      }
      if (!guard.current || index.current === null || typeof event.state?.idx !== "number") return;
      delta = index.current - event.state.idx;
      if (!delta) return;
      event.stopImmediatePropagation();
      restoring = true;
      window.history.go(delta);
    };
    window.addEventListener("popstate", onPop, true);
    return () => window.removeEventListener("popstate", onPop, true);
  }, [requestNavigation]);

  return (
    <NavigationGuardContext.Provider value={{ requestNavigation, registerGuard }}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

export const useNavigationGuard = () => useContext(NavigationGuardContext);

/** Use at the app navigation boundary and the organizer's section links. */
export function useGuardedNavigate(): NavigateFunction {
  const navigate = useNavigate();
  const { requestNavigation } = useNavigationGuard();
  return useCallback<NavigateFunction>(
    (to: To | number, options?: NavigateOptions) => {
      // POP is guarded by the listener above. Asking here as well would ask twice for navigate(-1).
      if (typeof to === "number") {
        void navigate(to);
        return;
      }
      requestNavigation(() => {
        void navigate(to, options);
      });
    },
    [navigate, requestNavigation],
  );
}
