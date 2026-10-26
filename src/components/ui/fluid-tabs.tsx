import { motion } from "motion/react";
import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "~/lib/cn";

// Adapted from Animata's Fluid Tabs (https://animata.design/docs/tabs/fluid-tabs):
// a spring-animated indicator slides between tabs via a shared layoutId.
// Changes from the original: React 18 (useContext instead of use()), the
// app's colors instead of shadcn tokens, and controlled-only selection.

const INDICATOR_SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
  mass: 0.75,
};

const LABEL_TRANSITION = {
  duration: 0.28,
  ease: [0.32, 0.72, 0, 1] as const,
};

type FluidTabsContextValue = {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  setFocusedIndex: (index: number) => void;
  indicatorLayoutId: string;
};

const FluidTabsContext = createContext<FluidTabsContextValue | null>(null);
const FluidTabSlotContext = createContext<number | null>(null);

function useFluidTabs() {
  const context = useContext(FluidTabsContext);
  if (!context) throw new Error("FluidTabs primitives must be used within <FluidTabs>.");
  return context;
}

function focusTabInList(tablist: HTMLElement, index: number) {
  queueMicrotask(() => {
    tablist.querySelectorAll<HTMLElement>('[role="tab"]')[index]?.focus();
  });
}

// Manual activation: arrows move focus; Enter / Space select the focused tab.
function handleTabListKeyDown(
  event: KeyboardEvent<HTMLElement>,
  count: number,
  setActiveIndex: (index: number) => void,
  setFocusedIndex: (index: number) => void,
) {
  const tablist = event.currentTarget;
  const tabs = Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
  const current = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  const currentIndex = current ? tabs.indexOf(current) : -1;
  if (currentIndex === -1) return;

  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    setActiveIndex(currentIndex);
    return;
  }
  let next: number | null = null;
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (currentIndex + 1) % count;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (currentIndex - 1 + count) % count;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = count - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  setFocusedIndex(next);
  focusTabInList(tablist, next);
}

function FluidTabsRoot({
  children,
  activeIndex,
  onActiveIndexChange,
  className,
}: {
  children: ReactNode;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  className?: string;
}) {
  const [, setFocusedIndex] = useState(activeIndex);
  const indicatorLayoutId = `fluid-tab-indicator-${useId().replace(/:/g, "")}`;
  const value = useMemo(
    () => ({
      activeIndex,
      setActiveIndex: onActiveIndexChange,
      setFocusedIndex,
      indicatorLayoutId,
    }),
    [activeIndex, onActiveIndexChange, indicatorLayoutId],
  );
  return (
    <FluidTabsContext.Provider value={value}>
      <div className={cn("flex w-full items-center", className)}>{children}</div>
    </FluidTabsContext.Provider>
  );
}

function FluidTabsList({
  className,
  children,
  "aria-label": ariaLabel = "Tabs",
  ...props
}: ComponentProps<"nav">) {
  const { activeIndex, setActiveIndex, setFocusedIndex } = useFluidTabs();
  const tabs = Children.toArray(children).filter(isValidElement);

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("relative w-full rounded-full bg-white/[0.06] p-1", className)}
      {...props}
    >
      <div
        role="tablist"
        onFocusCapture={(event: FocusEvent<HTMLElement>) => {
          const related = event.relatedTarget as Node | null;
          if (related && event.currentTarget.contains(related)) return;
          setFocusedIndex(activeIndex);
        }}
        onKeyDown={(event) =>
          handleTabListKeyDown(event, tabs.length, setActiveIndex, setFocusedIndex)
        }
        className="flex w-full gap-1"
      >
        {tabs.map((tab, index) => (
          <FluidTabSlotContext.Provider key={tab.key ?? index} value={index}>
            {tab}
          </FluidTabSlotContext.Provider>
        ))}
      </div>
    </nav>
  );
}

function FluidTabsTab({ className, children, ...props }: ComponentProps<"button">) {
  const { activeIndex, setActiveIndex, setFocusedIndex, indicatorLayoutId } = useFluidTabs();
  const index = useContext(FluidTabSlotContext);
  if (index === null) throw new Error("FluidTabs.Tab must be a direct child of <FluidTabs.List>.");
  const isSelected = activeIndex === index;

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isSelected}
      tabIndex={isSelected ? 0 : -1}
      onClick={() => setActiveIndex(index)}
      onFocus={() => setFocusedIndex(index)}
      className={cn(
        "relative z-10 flex flex-1 items-center justify-center rounded-full px-4 py-2 text-sm font-medium outline-none transition-colors",
        "focus-visible:ring-2 focus-visible:ring-accent/60",
        isSelected ? "text-zinc-100" : "text-zinc-400 hover:text-zinc-200",
        className,
      )}
      {...props}
    >
      {isSelected ? (
        <motion.span
          layoutId={indicatorLayoutId}
          className="absolute inset-0 block rounded-full bg-white/[0.12]"
          transition={INDICATOR_SPRING}
          aria-hidden
        />
      ) : null}
      <motion.span
        className="relative z-10 inline-flex items-center justify-center gap-2"
        animate={{ scale: isSelected ? 1 : 0.98 }}
        transition={LABEL_TRANSITION}
      >
        {children}
      </motion.span>
    </button>
  );
}

export const FluidTabs = Object.assign(FluidTabsRoot, {
  List: FluidTabsList,
  Tab: FluidTabsTab,
});
