import { useState } from "react";
import { VIEW_IDS, VIEW_LABELS, type ViewId } from "./view-id.js";
import { MemoryView } from "./views/memory-view.js";
import { SessionsView } from "./views/sessions-view.js";

export function App(): JSX.Element {
  const [view, setView] = useState<ViewId>("sessions");

  return (
    <main>
      <header>
        <h1>Mega Saver</h1>
        <nav>
          {VIEW_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              {VIEW_LABELS[id]}
            </button>
          ))}
        </nav>
      </header>
      <section>{view === "sessions" ? <SessionsView /> : <MemoryView />}</section>
    </main>
  );
}
